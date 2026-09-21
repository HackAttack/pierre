import { afterAll, describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import { JSDOM } from 'jsdom';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  FileRenderer,
  getSharedHighlighter,
  parseDiffFromFile,
  renderFileWithHighlighter,
} from '../src';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import {
  createInitializingManager,
  installAnimationFramePolyfill,
} from './workerPoolHarness';

afterAll(disposeHighlighter);

const file = {
  name: 'example.ts',
  contents: 'const answer = "🚀";\r\n\r\nanswer;\n',
};
const modified = {
  ...file,
  contents: file.contents.replace('answer', 'result'),
};

describe('backend rendering', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    test(`${preferredHighlighter} preserves nested decorations across tokens`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const code = 'const answer = 42;';
      const decorations = [
        { start: 0, end: code.length, properties: { class: 'outer' } },
        { start: 6, end: 17, properties: { class: 'inner' } },
        { start: 15, end: 17, properties: { class: 'number' } },
      ];
      for (const ordered of [decorations, decorations.toReversed()]) {
        const fragment = JSDOM.fragment(
          highlighter.codeToHtml(code, {
            lang: 'typescript',
            theme: 'pierre-dark',
            decorations: ordered,
          })
        );
        expect(fragment.querySelectorAll('.outer')).toHaveLength(1);
        expect(fragment.querySelectorAll('.inner')).toHaveLength(1);
        expect(fragment.querySelectorAll('.number')).toHaveLength(1);
        expect(fragment.querySelector('.outer')?.textContent).toBe(code);
        expect(fragment.querySelector('.outer .inner')?.textContent).toBe(
          'answer = 42'
        );
        expect(fragment.querySelector('.inner .number')?.textContent).toBe(
          '42'
        );
      }
    });

    test(`${preferredHighlighter} renders files, diffs and SSR`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark', 'pierre-light'],
        langs: ['typescript'],
      });
      const highlighted = renderFileWithHighlighter(file, highlighter, {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        tokenizeMaxLineLength: 1000,
        useTokenTransformer: true,
      });
      const html = toHtml(highlighted.code);
      expect(highlighted.code).toHaveLength(4);
      expect(html).toContain('data-char="0"');
      expect(html).toContain('<br>');
      expect(html).toContain('--diffs-token-dark:');
      expect(html).toContain('--diffs-token-light:');
      const options = {
        preferredHighlighter,
        theme: 'pierre-dark',
        useTokenTransformer: true,
      };
      const [plain, diff] = await Promise.all([
        preloadFile({ file, options }),
        preloadFileDiff({
          fileDiff: parseDiffFromFile(file, modified),
          options,
        }),
      ]);
      expect(plain.prerenderedHTML).toContain('🚀');
      expect(diff.prerenderedHTML).toContain('data-diff-span');
      expect(diff.prerenderedHTML).toContain('result');
    });

    test(`${preferredHighlighter} serializes backend themes for workers`, async () => {
      const restore = installAnimationFramePolyfill();
      const { initialization, manager, worker } = createInitializingManager({
        preferredHighlighter,
        theme: 'pierre-dark',
        langs: ['typescript'],
      });
      try {
        const request = await worker.waitForInitializeRequest();
        expect(request.preferredHighlighter).toBe(preferredHighlighter);
        expect(request.resolvedThemes[0].name).toBe('pierre-dark');
        if (preferredHighlighter === 'highlights')
          expect(request.resolvedLanguages).toEqual([]);
        worker.respond({
          type: 'success',
          requestType: 'initialize',
          id: request.id,
          sentAt: Date.now(),
        });
        await initialization;
        expect(manager.getPreferredHighlighter()).toBe(preferredHighlighter);
      } finally {
        manager.terminate();
        restore();
      }
    });
  }

  test('renderers can change backend after their first render', async () => {
    const options = {
      theme: 'pierre-dark',
      preferredHighlighter: 'shiki-js',
    } as const;
    const fileRenderer = new FileRenderer(options);
    const diffRenderer = new DiffHunksRenderer(options);
    const diff = parseDiffFromFile(file, modified);
    try {
      await fileRenderer.asyncRender(file);
      await diffRenderer.asyncRender(diff);
      fileRenderer.setOptions({
        ...options,
        preferredHighlighter: 'highlights',
      });
      diffRenderer.setOptions({
        ...options,
        preferredHighlighter: 'highlights',
      });
      expect(await fileRenderer.asyncRender(file)).toBeDefined();
      expect(await diffRenderer.asyncRender(diff)).toBeDefined();
      expect((await fileRenderer.initializeHighlighter()).name).toBe(
        'highlights'
      );
      expect((await diffRenderer.initializeHighlighter()).name).toBe(
        'highlights'
      );
    } finally {
      fileRenderer.cleanUp();
      diffRenderer.cleanUp();
    }
  });
});
