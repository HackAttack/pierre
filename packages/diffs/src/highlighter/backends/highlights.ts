import {
  createHighlighter,
  type Highlighter,
  type CodeToTokensOptions as HighlightsOptions,
  isSupportedLanguage,
  type Theme,
} from '@pierre/highlights';

import { tokensToHtml } from '../../utils/tokensToHtml';
import { HighlightsLiveTokenizer } from '../highlights-live';
import { HighlightsStreamTokenizer } from '../highlights-stream';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { CodeToTokensOptions, DiffsHighlighter } from '../types';

/** Highlights bundles its lexers; unsupported custom languages render as text. */
export function createHighlightsHighlighter(): DiffsHighlighter {
  let raw: Highlighter | undefined = createHighlighter();
  const themeResolver = createDiffsThemeResolver('highlights');
  const highlighter: DiffsHighlighter = {
    name: 'highlights',
    themeResolver,
    getTheme(name) {
      if (raw == null) throw new Error('Highlighter is disposed');
      const theme = themeResolver.getResolvedTheme(name);
      if (theme == null)
        throw new Error(`Theme "${name}" has not been resolved`);
      return theme;
    },
    codeToTokens(code, options) {
      if (raw == null) throw new Error('Highlighter is disposed');
      return raw.codeToTokens(code, resolveOptions(options));
    },
    codeToHtml(code, options) {
      return tokensToHtml(highlighter.codeToTokens(code, options), options);
    },
    createLiveTokenizer(options) {
      if (raw == null) throw new Error('Highlighter is disposed');
      return new HighlightsLiveTokenizer(options, resolveOptions);
    },
    createStreamTokenizer(options) {
      return new HighlightsStreamTokenizer(resolveOptions(options));
    },
    dispose() {
      raw = undefined;
    },
  };
  return highlighter;

  // Resolve backend-neutral names to the native Zed theme objects, keeping
  // only the selected theme key so callers may pass both with one undefined.
  function resolveOptions({
    theme,
    themes,
    ...options
  }: CodeToTokensOptions): HighlightsOptions {
    const lang = isSupportedLanguage(options.lang) ? options.lang : 'text';
    if (theme != null) return { ...options, lang, theme: getZedTheme(theme) };
    if (themes == null) throw new Error('A theme or themes option is required');
    const resolved: Record<string, Theme> = {};
    for (const [key, name] of Object.entries(themes))
      resolved[key] = getZedTheme(name);
    return { ...options, lang, themes: resolved };
  }

  function getZedTheme(name: string): Theme {
    const theme = highlighter.getTheme(name);
    if (theme.zed == null)
      throw new Error(`Theme "${name}" does not support Highlights`);
    return theme.zed;
  }
}
