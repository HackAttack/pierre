import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { CodeViewDiffItem, DiffsHighlighter } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript', 'javascript'],
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

test('an edited session keeps its highlight and remains editable after remount', async () => {
  await withViewer(
    true,
    false,
    async ({ viewer, flush, clearHighlights, highlightedSources }) => {
      const editor = viewer.getEditor('first');
      if (editor == null) throw new Error('Expected the first editor');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '// edited\n',
        },
      ]);
      await flush();
      viewer.scrollTo({
        type: 'line',
        id: 'second',
        lineNumber: 30,
        side: 'additions',
        align: 'start',
        behavior: 'instant',
      });
      await flush();
      expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual(['second']);
      clearHighlights();
      viewer.scrollTo({
        type: 'item',
        id: 'first',
        align: 'start',
        behavior: 'instant',
      });
      await flush();
      expect(viewer.getEditor('first')).toBe(editor);
      expect(editor.getText()).toStartWith('// edited\n');
      expect(highlightedSources()).toEqual([]);
      expect(
        viewer.getRenderedItems()[0].element.shadowRoot?.textContent
      ).toContain('// edited');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '// resumed\n',
        },
      ]);
      await flush();
      expect(editor.getText()).toStartWith('// resumed\n// edited\n');
      expect(
        viewer.getRenderedItems()[0].element.shadowRoot?.textContent
      ).toContain('// resumed');
    }
  );
});

for (const partial of [false, true]) {
  test(`replacing a recycled file invalidates its highlights (partial: ${partial})`, async () => {
    const dom = installDom();
    const first = createItem('first', true);
    const second = createItem('second', true);
    const oldFile = {
      name: 'first.ts',
      contents: first.fileDiff.deletionLines.join(''),
    };
    const newFile = {
      name: 'renamed.js',
      contents: first.fileDiff.additionLines
        .join('')
        .replace('first_new0', 'replacement'),
    };
    const replacement = partial
      ? parsePatchFiles(
          createTwoFilesPatch(
            oldFile.name,
            newFile.name,
            oldFile.contents,
            newFile.contents
          ),
          'replacement',
          true
        )[0]?.files[0]
      : parseDiffFromFile(oldFile, newFile);
    const viewer = new CodeView({
      theme: 'pierre-dark',
      createEditor: (type, options, key) => new Editor(type, options, key),
      loadDiffFiles: () => Promise.resolve({ oldFile, newFile }),
    });
    const highlight = spyOn(highlighter, 'codeToHast');
    try {
      if (replacement == null) throw new Error('Expected replacement diff');
      expect(replacement.isPartial === true).toBe(partial);
      viewer.setup(createRoot({ height: 200 }));
      await renderItems(viewer, [first, second]);
      const editor = viewer.getEditor('first');
      if (editor == null) throw new Error('Expected the first editor');
      viewer.scrollTo({
        type: 'line',
        id: 'second',
        lineNumber: 30,
        side: 'additions',
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);
      await wait(0);
      expect(viewer.getRenderedItems().map(({ id }) => id)).toEqual(['second']);

      highlight.mockClear();
      viewer.updateItem({ ...first, fileDiff: replacement, version: 1 });
      viewer.scrollTo({
        type: 'item',
        id: 'first',
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);
      await waitFor(() => editor.getText() === newFile.contents);
      expect(editor.getText()).toBe(newFile.contents);
      expect(editor.getFile()?.name).toBe(newFile.name);
      expect(replacement.isPartial).not.toBe(true);
      expect(
        highlight.mock.calls.some(
          ([source, options]) =>
            source.includes('replacement') && options.lang === 'javascript'
        )
      ).toBe(true);
      const content =
        viewer.getRenderedItems()[0].element.shadowRoot?.textContent;
      expect(content).toContain('replacement');
      expect(content).not.toContain('first_new0');
    } finally {
      viewer.cleanUp();
      highlight.mockRestore();
      await wait(0);
      dom.cleanup();
    }
  });
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
