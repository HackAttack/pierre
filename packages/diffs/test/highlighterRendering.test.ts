import { afterAll, describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';

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
