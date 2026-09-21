import {
  createCssVariablesTheme,
  createHighlighterCore,
  type CodeToTokensOptions as ShikiCodeToTokensOptions,
} from 'shiki/core';

import { tokensToHtml } from '../../utils/tokensToHtml';
import { attachResolvedLanguages } from '../languages/attachResolvedLanguages';
import { RegisteredCustomLanguages } from '../languages/constants';
import { resolveLanguages } from '../languages/resolveLanguages';
import { ShikiLiveTokenizer } from '../shiki-live';
import { ShikiStreamTokenizer } from '../shiki-stream';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { CodeToTokensOptions, DiffsHighlighter } from '../types';
import { attachedShikiLanguages, shikiInternals } from './shiki-internals';

/** Adapt Shiki while keeping its engines, grammars and tokenizers lazy. */
export async function createShikiHighlighter(
  name: 'shiki-js' | 'shiki-wasm'
): Promise<DiffsHighlighter> {
  const engine =
    name === 'shiki-wasm'
      ? (await import('shiki/engine/oniguruma')).createOnigurumaEngine(
          import('shiki/wasm')
        )
      : (await import('shiki/engine/javascript')).createJavaScriptRegexEngine();
  const raw = await createHighlighterCore({
    themes: [],
    langs: [],
    engine,
  });
  const themeResolver = createDiffsThemeResolver(name);
  // Names already passed to raw.loadThemeSync, so the per-render theme check
  // avoids the array Shiki allocates and scans for getLoadedThemes().
  const loadedThemes = new Set<string>();
  const attachedLanguages = new Set(['text', 'ansi']);
  let disposed = false;
  const highlighter: DiffsHighlighter = {
    name,
    themeResolver,
    getTheme(themeName) {
      if (disposed) throw new Error('Highlighter is disposed');
      const theme = themeResolver.getResolvedTheme(themeName);
      if (theme == null)
        throw new Error(`Theme "${themeName}" has not been resolved`);
      if (!loadedThemes.has(themeName)) {
        const textmate =
          theme.textmate ??
          (theme.cssVariables != null
            ? createCssVariablesTheme(theme.cssVariables)
            : undefined);
        if (textmate == null)
          throw new Error(`Theme "${themeName}" does not support Shiki`);
        raw.loadThemeSync(textmate);
        loadedThemes.add(themeName);
      }
      return theme;
    },
    codeToTokens(code, options) {
      return raw.codeToTokens(code, resolveOptions(options));
    },
    codeToHtml(code, options) {
      return tokensToHtml(highlighter.codeToTokens(code, options), options);
    },
    createLiveTokenizer(options) {
      highlighter.getTheme(options.theme);
      return new ShikiLiveTokenizer(raw, options, highlighter.loadLanguages);
    },
    createStreamTokenizer(options) {
      return new ShikiStreamTokenizer(raw, resolveOptions(options));
    },
    async loadLanguages(languages) {
      if (disposed) throw new Error('Highlighter is disposed');
      const missing = languages.filter(
        (language) => !attachedLanguages.has(language)
      );
      attachResolvedLanguages(await resolveLanguages(missing), highlighter);
    },
    hasLoadedLanguages(languages) {
      if (disposed) return false;
      const loaded = raw.getLoadedLanguages();
      return languages.every(
        (lang) =>
          lang === 'text' ||
          lang === 'ansi' ||
          (RegisteredCustomLanguages.has(lang)
            ? attachedLanguages.has(lang)
            : loaded.includes(lang))
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loadedThemes.clear();
      raw.dispose();
      shikiInternals.delete(highlighter);
      attachedShikiLanguages.delete(highlighter);
    },
  };
  shikiInternals.set(highlighter, raw);
  attachedShikiLanguages.set(highlighter, attachedLanguages);
  return highlighter;

  // Synchronize pre-resolved worker themes before synchronous tokenization and
  // keep only the selected theme key. Callers may pass both keys with one set
  // to undefined; Shiki checks for a `themes` key before `theme` and would
  // then read entries from undefined.
  function resolveOptions({
    theme,
    themes,
    ...options
  }: CodeToTokensOptions): ShikiCodeToTokensOptions {
    if (disposed) throw new Error('Highlighter is disposed');
    if (theme != null) {
      highlighter.getTheme(theme);
      return { ...options, theme };
    }
    if (themes == null) throw new Error('A theme or themes option is required');
    for (const name of Object.values(themes)) highlighter.getTheme(name);
    return { ...options, themes };
  }
}
