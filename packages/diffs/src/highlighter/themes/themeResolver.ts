import type { Theme as ZedTheme } from '@pierre/highlights';
import {
  createThemeResolver,
  type ThemeLoader,
  type ThemeResolver,
} from '@pierre/theming';
import type { ThemeRegistration } from 'shiki';

import type { HighlighterTypes } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import type { DiffsTheme } from './types';

export type CustomThemeLoader = ThemeLoader<ThemeRegistration | DiffsTheme>;
export type CustomZedThemeLoader = ThemeLoader<ZedTheme>;

export const customTextMateThemes: Map<string, CustomThemeLoader> = new Map();
export const customZedThemes: Map<string, CustomZedThemeLoader> = new Map();
const resolvers = new Map<HighlighterTypes, ThemeResolver<DiffsTheme>>();

// Map Zed colors to the VS Code keys used by editor and diff overlays.
const ZED_COLOR_ALIASES: readonly (readonly [
  target: string,
  ...sources: string[],
])[] = [
  ['editor.lineHighlightBackground', 'editor.active_line.background'],
  ['editor.selectionBackground', 'element.selected'],
  ['editor.findMatchBackground', 'search.match_background'],
  ['editor.findMatchHighlightBackground', 'search.match_background'],
  [
    'editorBracketMatch.background',
    'editor.document_highlight.bracket_background',
  ],
  ['editorError.foreground', 'error'],
  ['editorWarning.foreground', 'warning'],
  ['editorInfo.foreground', 'info'],
  ['editorHint.foreground', 'hint'],
  ['gitDecoration.addedResourceForeground', 'created', 'terminal.ansi.green'],
  ['gitDecoration.deletedResourceForeground', 'deleted', 'terminal.ansi.red'],
  [
    'gitDecoration.modifiedResourceForeground',
    'modified',
    'terminal.ansi.blue',
  ],
];

// Build the shared theme shape from a Zed theme: copy its flat colors, then
// fill the VS Code keys the surfaces read from their Zed equivalents.
function createHighlightsTheme(name: string, raw: ZedTheme): DiffsTheme {
  const zed = { ...raw, name };
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(zed.style)) {
    if (typeof value === 'string') colors[key] = value;
  }
  // Zed keeps the local user's caret and selection in the first player slot.
  const player = zed.style.players?.[0];
  if (player?.cursor !== undefined)
    colors['editorCursor.foreground'] ??= player.cursor;
  if (player?.selection !== undefined)
    colors['editor.selectionBackground'] ??= player.selection;
  for (const [target, ...sources] of ZED_COLOR_ALIASES) {
    if (colors[target] !== undefined) continue;
    const source = sources.find((key) => colors[key] !== undefined);
    if (source !== undefined) colors[target] = colors[source];
  }
  const type = zed.appearance === 'light' ? 'light' : 'dark';
  return {
    name,
    type,
    colors,
    zed,
    fg:
      colors['editor.foreground'] ??
      colors.text ??
      colors.foreground ??
      (type === 'light' ? '#333333' : '#bbbbbb'),
    bg:
      colors['editor.background'] ??
      colors.background ??
      (type === 'light' ? '#ffffff' : '#1e1e1e'),
  };
}

/** Keep caches separate because the same name can have TextMate and Zed palettes. */
export function createDiffsThemeResolver(
  backend: HighlighterTypes
): ThemeResolver<DiffsTheme> {
  let resolver = resolvers.get(backend);
  if (resolver !== undefined) return resolver;
  resolver = createThemeResolver<DiffsTheme>({
    fallbackLoader: async (name) => {
      if (isWorkerContext()) {
        throw new Error(
          `Theme "${name}" cannot be resolved from a worker context. Themes must be pre-resolved on the main thread and passed to the worker via the resolvedThemes parameter.`
        );
      }
      if (backend === 'highlights') {
        // Custom registrations win over bundled themes, as they do for Shiki:
        // an explicit Zed registration first, then a portable theme that
        // carries a Zed palette, then the bundled catalog.
        const zedLoader = customZedThemes.get(name);
        const portableLoader = customTextMateThemes.get(name);
        let zed: ZedTheme | undefined;
        if (zedLoader !== undefined) {
          const loaded = await zedLoader();
          zed = 'default' in loaded ? loaded.default : loaded;
        } else if (portableLoader !== undefined) {
          const loaded = await portableLoader();
          const theme = 'default' in loaded ? loaded.default : loaded;
          if ('zed' in theme && theme.zed !== undefined) return theme;
        }
        if (zed === undefined) {
          const { themes: bundledHighlightsThemes } =
            await import('@pierre/highlights/themes/loader');
          const loader = bundledHighlightsThemes[name];
          if (loader !== undefined) {
            const loaded = await loader();
            zed = 'default' in loaded ? loaded.default : loaded;
          }
        }
        if (zed !== undefined) return createHighlightsTheme(name, zed);
        if (portableLoader !== undefined) {
          throw new Error(
            `Theme "${name}" is a TextMate theme; register a Zed theme with registerCustomZedTheme for Highlights.`
          );
        }
      } else {
        const loader = customTextMateThemes.get(name);
        const { normalizeTheme, createCssVariablesTheme } =
          await import('shiki/core');
        let loaded: ThemeRegistration | DiffsTheme;
        if (loader !== undefined) {
          const result = await loader();
          loaded = 'default' in result ? result.default : result;
        } else {
          const { themes } = await import('@pierre/theming/themes');
          const descriptor = themes.getTheme(name);
          if (descriptor === undefined)
            throw new Error(`No valid theme loader registered for "${name}"`);
          const result = await descriptor.load();
          loaded = 'default' in result ? result.default : result;
        }
        if ('cssVariables' in loaded && loaded.cssVariables !== undefined) {
          return {
            ...loaded,
            textmate: normalizeTheme(
              createCssVariablesTheme(loaded.cssVariables)
            ),
          };
        }
        const textmate = normalizeTheme(
          'textmate' in loaded && loaded.textmate !== undefined
            ? loaded.textmate
            : loaded
        );
        return {
          name: textmate.name,
          type: textmate.type,
          fg: textmate.fg,
          bg: textmate.bg,
          colors: textmate.colors,
          textmate,
        };
      }
      throw new Error(`No valid theme loader registered for "${name}"`);
    },
    normalizeTheme: (theme, name) => {
      if (theme.name !== name)
        throw new Error(
          `resolvedTheme: themeName: ${name} does not match theme.name: ${theme.name}`
        );
      return theme;
    },
  });
  resolvers.set(backend, resolver);
  return resolver;
}
