import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { CodeViewDiffItem, DiffsHighlighter } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { createRoot, installDom, wait, waitFor } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

// Each item is taller than the viewport plus overscan, so folding the first
// exposes the second and unfolding it forces the second through real cleanup.
function createItem(id: string, edit: boolean): CodeViewDiffItem<undefined> {
  return {
    id,
    type: 'diff',
    edit,
    version: 0,
    fileDiff: parseDiffFromFile(
      {
        name: `${id}.ts`,
        cacheKey: `${id}:old`,
        contents: Array.from(
          { length: 60 },
          (_, line) => `export const ${id}_old${line} = "before";\n`
        ).join(''),
      },
      {
        name: `${id}.ts`,
        cacheKey: `${id}:new`,
        contents: Array.from(
          { length: 80 },
          (_, line) => `export const ${id}_new${line} = "after";\n`
        ).join(''),
      }
    ),
  };
}

interface HighlightHarness {
  viewer: CodeView;
  items: CodeViewDiffItem<undefined>[];
  flush(): Promise<void>;
  highlightedSources(): string[];
  clearHighlights(): void;
}

// Precompute genuine worker output before observing Shiki, so the recorded
// calls belong only to local rendering, not our in-process worker substitute.
async function withViewer(
  edit: boolean,
  useTokenTransformer: boolean,
  run: (harness: HighlightHarness) => Promise<void>
): Promise<void> {
  const dom = installDom();
  let disposeViewer: (() => void) | undefined;
  let terminateManager: (() => void) | undefined;
  let restoreHighlight: (() => void) | undefined;
  try {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer,
    });
    terminateManager = () => manager.terminate();
    const items = [createItem('first', edit), createItem('second', edit)];
    const options = manager.getDiffRenderOptions();
    const results = new Map(
      items.map(({ fileDiff }) => [
        fileDiff.name,
        renderDiffWithHighlighter(fileDiff, highlighter, options),
      ])
    );
    const postMessage = worker.postMessage.bind(worker);
    worker.postMessage = (request) => {
      postMessage(request);
      if (request.type !== 'diff') return;
      const result = results.get(request.diff.name);
      if (result == null) throw new Error('Unexpected diff requested');
      queueMicrotask(() => {
        if (worker.terminated) return;
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: structuredClone(result),
          options,
          sentAt: Date.now(),
        });
      });
    };

    const highlight = spyOn(highlighter, 'codeToHast');
    restoreHighlight = () => highlight.mockRestore();
    const viewer = new CodeView(
      {
        theme: 'pierre-dark',
        stickyHeaders: true,
        createEditor: (type, editorOptions, key) =>
          new Editor(type, editorOptions, key),
      },
      manager
    );
    disposeViewer = () => viewer.cleanUp();

    // Wait for highlighted rows, rather than a fixed delay, before measuring
    // the next action. This also prevents an empty render from passing reuse.
    async function flush(): Promise<void> {
      viewer.render(true);
      await wait(0);
      const isReady = () => {
        const rendered = viewer.getRenderedItems();
        return (
          rendered.length > 0 &&
          rendered.every(
            ({ item, element }) =>
              item.collapsed === true ||
              element.shadowRoot?.querySelector(
                '[data-line] [style*="color:"]'
              ) != null
          )
        );
      };
      await waitFor(isReady);
      expect(isReady()).toBe(true);
    }

    viewer.setup(createRoot({ height: 200 }));
    viewer.setItems(items);
    await flush();
    expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual(['first']);
    await run({
      viewer,
      items,
      flush,
      // Plain placeholder ASTs also call codeToHast with lang: 'text'; they
      // do not run the TypeScript grammar and are not the expensive work.
      highlightedSources: () =>
        highlight.mock.calls
          .filter(([, renderOptions]) => renderOptions.lang !== 'text')
          .map(([source]) => source.split('\n')[0]),
      clearHighlights: () => highlight.mockClear(),
    });
  } finally {
    disposeViewer?.();
    terminateManager?.();
    restoreHighlight?.();
    await wait(0);
    dom.cleanup();
  }
}

function expectedSources(id: string, edit: boolean): string[] {
  return edit
    ? [
        `export const ${id}_old0 = "before";`,
        `export const ${id}_new0 = "after";`,
      ]
    : [];
}

for (const useTokenTransformer of [false, true]) {
  describe(`CodeView highlight reuse (pool transformer: ${useTokenTransformer})`, () => {
    for (const edit of [false, true]) {
      test(`repeated fold reuses the neighbor's highlight (edit: ${edit})`, async () => {
        await withViewer(edit, useTokenTransformer, async (harness) => {
          const { viewer, items, flush, highlightedSources, clearHighlights } =
            harness;
          // First mounts remain allowed to highlight synchronously. Record
          // both sides to distinguish that work from the later regression.
          expect(highlightedSources()).toEqual(expectedSources('first', edit));
          clearHighlights();
          viewer.setItems([
            { ...items[0], collapsed: true, version: 1 },
            items[1],
          ]);
          await flush();
          expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
            'first',
            'second',
          ]);
          expect(highlightedSources()).toEqual(expectedSources('second', edit));

          clearHighlights();
          viewer.setItems([
            { ...items[0], collapsed: false, version: 2 },
            items[1],
          ]);
          await flush();
          expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
            'first',
          ]);
          expect(highlightedSources()).toEqual([]);

          viewer.setItems([
            { ...items[0], collapsed: true, version: 3 },
            items[1],
          ]);
          await flush();
          expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
            'first',
            'second',
          ]);
          expect(highlightedSources()).toEqual([]);
        });
      });

      test(`scroll-back reuses the first item's highlight (edit: ${edit})`, async () => {
        await withViewer(edit, useTokenTransformer, async (harness) => {
          const { viewer, flush, highlightedSources, clearHighlights } =
            harness;
          expect(highlightedSources()).toEqual(expectedSources('first', edit));
          clearHighlights();
          // Move beyond overscan so the first item is actually recycled.
          viewer.scrollTo({
            type: 'line',
            id: 'second',
            lineNumber: 30,
            side: 'additions',
            align: 'start',
            behavior: 'instant',
          });
          await flush();
          expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
            'second',
          ]);
          expect(highlightedSources()).toEqual(expectedSources('second', edit));

          clearHighlights();
          viewer.scrollTo({
            type: 'item',
            id: 'first',
            align: 'start',
            behavior: 'instant',
          });
          await flush();
          expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual([
            'first',
          ]);
          expect(highlightedSources()).toEqual([]);
        });
      });
    }
  });
}
