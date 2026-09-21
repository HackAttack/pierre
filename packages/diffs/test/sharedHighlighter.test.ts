import { afterEach, describe, expect, test } from 'bun:test';

import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';

const backends = ['shiki-js', 'shiki-wasm', 'highlights'] as const;

afterEach(async () => {
  await disposeHighlighter();
  RegisteredCustomLanguages.delete('highlights-custom-ignored');
});

describe('shared highlighter backend lifecycle', () => {
  test('keeps independent cached instances for each backend', async () => {
    const instances = await Promise.all(
      backends.map((preferredHighlighter) =>
        getSharedHighlighter({
          themes: ['pierre-dark'],
          langs: ['typescript'],
          preferredHighlighter,
        })
      )
    );
    expect(new Set(instances).size).toBe(3);
    for (const [index, preferredHighlighter] of backends.entries()) {
      const highlighter = instances[index];
      expect(highlighter.name).toBe(preferredHighlighter);
      expect(
        getHighlighterIfLoaded({
          theme: 'pierre-dark',
          lang: 'typescript',
          preferredHighlighter,
        })
      ).toBe(highlighter);
      expect(
        await getSharedHighlighter({
          themes: [],
          langs: [],
          preferredHighlighter,
        })
      ).toBe(highlighter);
      const tokens = highlighter.codeToTokens('const value = 1;', {
        lang: 'typescript',
        theme: 'pierre-dark',
      });
      expect(tokens.tokens[0].map((token) => token.content).join('')).toBe(
        'const value = 1;'
      );
      expect(tokens.tokens[0].some((token) => token.color != null)).toBe(true);
    }
    expect(getHighlighterIfLoaded()).toBe(instances[0]);
  });

  for (const preferredHighlighter of backends) {
    test(`${preferredHighlighter} disposes resources and creates a fresh instance`, async () => {
      const options = {
        themes: ['pierre-dark'],
        langs: ['text'],
        preferredHighlighter,
      };
      const highlighter = await getSharedHighlighter(options);
      await disposeHighlighter();
      expect(getHighlighterIfLoaded({ preferredHighlighter })).toBeUndefined();
      expect(() =>
        highlighter.codeToTokens('x', { lang: 'text', theme: 'pierre-dark' })
      ).toThrow('disposed');
      expect(await getSharedHighlighter(options)).not.toBe(highlighter);
    });
  }

  test('a cold requested backend cannot return another cached backend', async () => {
    await getSharedHighlighter({ themes: [], langs: [] });
    expect(
      getHighlighterIfLoaded({ preferredHighlighter: 'highlights' })
    ).toBeUndefined();
  });

  test('Highlights ignores custom TextMate loaders and renders unknown languages as text', async () => {
    let calls = 0;
    registerCustomLanguage('highlights-custom-ignored', () => {
      calls++;
      return Promise.reject(new Error('TextMate loader should not run'));
    });
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['highlights-custom-ignored'],
      preferredHighlighter: 'highlights',
    });
    expect(calls).toBe(0);
    const result = highlighter.codeToTokens('custom text', {
      lang: 'highlights-custom-ignored',
      theme: 'pierre-dark',
    });
    expect(
      result.tokens
        .flat()
        .map((token) => token.content)
        .join('')
    ).toBe('custom text');
  });
});
