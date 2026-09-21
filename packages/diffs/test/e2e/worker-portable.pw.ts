import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

test.describe('portable worker', () => {
  for (const highlighter of ['shiki-js', 'shiki-wasm', 'highlights'] as const) {
    test(`loads only ${highlighter} and renders through a module worker`, async ({
      context,
      page,
    }) => {
      const portablePath = '/dist/worker/worker-portable.js';
      const workerFiles = new Map<string, number>();
      // Serve emitted bytes unchanged: Vite would otherwise resolve bare
      // imports and hide a broken standalone worker bundle.
      await context.route(
        (url) =>
          url.pathname === portablePath ||
          url.pathname.startsWith('/dist/worker/portable/'),
        async (route) => {
          const { pathname } = new URL(route.request().url());
          const body = await readFile(
            resolve(import.meta.dirname, '../..', pathname.slice(1))
          );
          workerFiles.set(basename(pathname), body.byteLength);
          await route.fulfill({ contentType: 'text/javascript', body });
        }
      );
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(
        `/test/e2e/fixtures/worker-portable.html?highlighter=${highlighter}`
      );
      await page.waitForFunction(
        () => window.__workerPortableReady === true,
        undefined,
        { timeout: 20_000 }
      );

      expect(
        await page.evaluate(() => window.__workerPortableError)
      ).toBeUndefined();
      expect(
        await page.evaluate(() => window.__workerPortableInitialized)
      ).toBe(true);
      // Syntax highlighting splits the first line into several token spans.
      expect(
        await page.locator('[data-content] [data-char]').count()
      ).toBeGreaterThan(1);
      expect(workerFiles.get('worker-portable.js')).toBeLessThan(200_000);
      const chunks = [...workerFiles.keys()].filter(
        (name) => name !== 'worker-portable.js'
      );
      expect(chunks.some((name) => /^shiki-/.test(name))).toBe(
        highlighter !== 'highlights'
      );
      expect(chunks.some((name) => /^highlights-/.test(name))).toBe(
        highlighter === 'highlights'
      );
      expect(chunks.some((name) => /^engine-javascript-/.test(name))).toBe(
        highlighter === 'shiki-js'
      );
      expect(chunks.some((name) => /^engine-oniguruma-/.test(name))).toBe(
        highlighter === 'shiki-wasm'
      );
      expect(
        chunks.filter((name) => /^(langs|themes|loader)-/.test(name))
      ).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
});
