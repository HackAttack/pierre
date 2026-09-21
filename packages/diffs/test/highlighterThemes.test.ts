import { afterAll, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { customTextMateThemes } from '../src/highlighter/themes/themeResolver';
import type { DiffsTheme } from '../src/highlighter/themes/types';

afterAll(disposeHighlighter);

describe('highlights themes', () => {
  test('exposes editor overlay colors under the keys the editor reads', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark', 'andromeeda'],
      langs: [],
    });
    const pierre = highlighter.getTheme('pierre-dark');
    const pierreColors = pierre.colors ?? {};
    const player = pierre.zed?.style.players?.[0];
    expect(player?.cursor).toBeDefined();
    expect(player?.cursor).toBe(pierreColors['editorCursor.foreground']);
    expect(player?.selection).toBe(pierreColors['editor.selectionBackground']);
    expect(pierreColors['editor.lineHighlightBackground']).toBe(
      pierreColors['editor.active_line.background']
    );
    expect(pierreColors['gitDecoration.addedResourceForeground']).toBe(
      pierreColors.created
    );
    const andromeeda = highlighter.getTheme('andromeeda').colors ?? {};
    expect(andromeeda['search.match_background']).toBeDefined();
    expect(andromeeda['editor.findMatchBackground']).toBe(
      andromeeda['search.match_background']
    );
    expect(andromeeda['editor.findMatchHighlightBackground']).toBe(
      andromeeda['search.match_background']
    );
    expect(andromeeda['editorBracketMatch.background']).toBe(
      andromeeda['editor.document_highlight.bracket_background']
    );
    expect(andromeeda['editorError.foreground']).toBe(andromeeda.error);
    expect(andromeeda['editorHint.foreground']).toBe(andromeeda.hint);
  });

  test('prefers a portable custom theme over a bundled theme of the same name', async () => {
    const name = 'andromeeda';
    const custom: DiffsTheme = {
      name,
      type: 'light',
      fg: '#111111',
      bg: '#eeeeee',
      colors: {},
      zed: {
        name,
        appearance: 'light',
        style: {
          'editor.foreground': '#111111',
          'editor.background': '#eeeeee',
        },
      },
    };
    registerCustomTheme(name, () => Promise.resolve(custom));
    try {
      cleanUpResolvedThemes('highlights');
      const highlighter = await getSharedHighlighter({
        preferredHighlighter: 'highlights',
        themes: [name],
        langs: [],
      });
      const theme = highlighter.getTheme(name);
      expect(theme.type).toBe('light');
      expect(theme.fg).toBe('#111111');
      expect(theme.zed?.style['editor.background']).toBe('#eeeeee');
    } finally {
      customTextMateThemes.delete(name);
      cleanUpResolvedThemes('highlights');
    }
  });
});
