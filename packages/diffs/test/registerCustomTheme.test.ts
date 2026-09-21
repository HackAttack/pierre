import type { Theme, ThemeFamily } from '@pierre/highlights';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { createHighlighter } from '../src/highlighter/shared_highlighter';
import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { resolveTheme } from '../src/highlighter/themes/resolveTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';

const names: string[] = [];
const zed: Theme = {
  name: 'Friendly Zed Name',
  appearance: 'dark',
  style: {
    'editor.foreground': '#ddeeff',
    'editor.background': '#112233',
    syntax: { keyword: '#ff0000' },
  },
};
const family: ThemeFamily = {
  name: 'Friendly Zed Family',
  themes: [
    zed,
    {
      name: 'Second Zed Theme',
      appearance: 'light',
      style: { foreground: '#000000', background: '#ffffff' },
    },
  ],
};

afterEach(() => {
  for (const name of names.splice(0)) customThemes.delete(name);
  cleanUpResolvedThemes();
});

describe('registerCustomTheme with Highlights themes', () => {
  for (const defaultExport of [false, true]) {
    test(`lazily resolves and tokenizes a ${defaultExport ? 'default-exported' : 'direct'} Zed theme`, async () => {
      const name = `generic-zed-${defaultExport ? 'module' : 'direct'}`;
      names.push(name);
      const loader = mock(() =>
        Promise.resolve(defaultExport ? { default: zed } : zed)
      );
      registerCustomTheme(name, loader);
      expect(loader).not.toHaveBeenCalled();

      const highlighter = await createHighlighter({
        preferredHighlighter: 'highlights',
      });
      try {
        const theme = await resolveTheme(name, 'highlights');
        expect(theme.name).toBe(name);
        expect(theme.zed?.name).toBe(name);
        expect(theme.type).toBe('dark');
        expect(theme.fg).toBe('#ddeeff');
        expect(theme.bg).toBe('#112233');
        expect(theme.textmate).toBeUndefined();
        expect(zed.name).toBe('Friendly Zed Name');
        expect(await resolveTheme(name, 'highlights')).toBe(theme);
        expect(loader).toHaveBeenCalledTimes(1);

        const result = highlighter.codeToTokens('const answer = 42;', {
          lang: 'javascript',
          theme: name,
        });
        expect(result.fg).toBe(theme.fg);
        expect(result.bg).toBe(theme.bg);
        expect(
          result.tokens.flat().find((token) => token.content.includes('const'))
            ?.color
        ).toBe('#ff0000');
      } finally {
        highlighter.dispose();
      }
    });

    test(`uses the first member of a ${defaultExport ? 'default-exported' : 'direct'} Zed theme family`, async () => {
      const name = `generic-zed-family-${defaultExport ? 'module' : 'direct'}`;
      names.push(name);
      registerCustomTheme(name, () =>
        Promise.resolve(defaultExport ? { default: family } : family)
      );

      const theme = await resolveTheme(name, 'highlights');
      expect(theme.name).toBe(name);
      expect(theme.zed?.name).toBe(name);
      expect(theme.type).toBe('dark');
      expect(theme.fg).toBe('#ddeeff');
      expect(theme.bg).toBe('#112233');
      expect(theme.zed?.style.syntax?.keyword).toBe('#ff0000');
    });
  }

  test('rejects an empty Zed theme family with an actionable error', () => {
    const name = 'generic-zed-empty-family';
    names.push(name);
    registerCustomTheme(name, () => Promise.resolve({ themes: [] }));

    expect(resolveTheme(name, 'highlights')).rejects.toThrow(
      /empty|at least one/i
    );
  });

  for (const backend of ['shiki-js', 'shiki-wasm'] as const) {
    test(`rejects Zed themes and families on ${backend} with an actionable error`, () => {
      for (const [kind, theme] of [
        ['theme', zed],
        ['family', family],
      ] as const) {
        const name = `generic-zed-${kind}-${backend}`;
        names.push(name);
        registerCustomTheme(name, () => Promise.resolve(theme));

        expect(resolveTheme(name, backend)).rejects.toThrow(
          /TextMate.*Shiki|Shiki.*TextMate/
        );
      }
    });
  }

  test('keeps the first registration when another format uses the same name', async () => {
    const name = 'generic-zed-duplicate';
    names.push(name);
    const loader = mock(() => Promise.resolve(zed));
    const duplicate = mock(() => Promise.resolve({ name, tokenColors: [] }));
    const error = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      registerCustomTheme(name, loader);
      registerCustomTheme(name, duplicate);

      const theme = await resolveTheme(name, 'highlights');
      expect(theme.name).toBe(name);
      expect(theme.zed?.name).toBe(name);
      expect(theme.fg).toBe('#ddeeff');
      expect(theme.bg).toBe('#112233');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(duplicate).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'SharedHighlight.registerCustomTheme: theme name already registered',
        name
      );
    } finally {
      error.mockRestore();
    }
  });
});
