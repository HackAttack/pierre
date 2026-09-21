import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { cleanUpResolvedLanguages } from './languages/cleanUpResolvedLanguages';
import { cleanUpResolvedThemes } from './themes/cleanUpResolvedThemes';

type CachedHighlighter = DiffsHighlighter | Promise<DiffsHighlighter>;
const highlighters = new Map<HighlighterTypes, CachedHighlighter>();

export interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

/** Load only the selected backend and create an independently disposable instance. */
export async function createHighlighter({
  preferredHighlighter = 'shiki-js',
}: {
  preferredHighlighter?: HighlighterTypes;
} = {}): Promise<DiffsHighlighter> {
  if (preferredHighlighter === 'highlights') {
    const { createHighlightsHighlighter } =
      await import('./backends/highlights');
    return createHighlightsHighlighter();
  }
  const { createShikiHighlighter } = await import('./backends/shiki');
  return createShikiHighlighter(preferredHighlighter);
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferredHighlighter = 'shiki-js',
}: HighlighterOptions): Promise<DiffsHighlighter> {
  let cached = highlighters.get(preferredHighlighter);
  if (cached == null) {
    cached = createHighlighter({ preferredHighlighter });
    highlighters.set(preferredHighlighter, cached);
  }
  let instance: DiffsHighlighter;
  try {
    instance = await cached;
  } catch (error) {
    if (highlighters.get(preferredHighlighter) === cached)
      highlighters.delete(preferredHighlighter);
    throw error;
  }
  if (highlighters.get(preferredHighlighter) === cached)
    highlighters.set(preferredHighlighter, instance);
  await Promise.all([
    instance.themeResolver.resolveThemes(themes),
    instance.loadLanguages?.(langs),
  ]);
  return instance;
}

export function isHighlighterLoaded(
  h: CachedHighlighter | undefined = highlighters.get('shiki-js')
): h is DiffsHighlighter {
  return h != null && !('then' in h);
}

interface GetHighlighterIfLoadedProps {
  theme?: DiffsThemeNames | ThemesType;
  lang?: SupportedLanguages;
  preferredHighlighter?: HighlighterTypes;
}

export function getHighlighterIfLoaded({
  theme,
  lang,
  preferredHighlighter = 'shiki-js',
}: GetHighlighterIfLoadedProps = {}): DiffsHighlighter | undefined {
  const highlighter = highlighters.get(preferredHighlighter);
  if (highlighter == null || !isHighlighterLoaded(highlighter))
    return undefined;
  if (
    theme != null &&
    !highlighter.themeResolver.hasResolvedThemes(
      typeof theme === 'string' ? [theme] : Object.values(theme)
    )
  )
    return undefined;
  if (lang != null && highlighter.hasLoadedLanguages?.([lang]) === false)
    return undefined;
  return highlighter;
}

export function isHighlighterLoading(
  h: CachedHighlighter | undefined = highlighters.get('shiki-js')
): h is Promise<DiffsHighlighter> {
  return h != null && 'then' in h;
}

export function isHighlighterNull(
  h: CachedHighlighter | undefined = highlighters.get('shiki-js')
): h is undefined {
  return h == null;
}

export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}

export async function disposeHighlighter(): Promise<void> {
  const cached = [...highlighters.values()];
  highlighters.clear();
  // Failed initialization must not prevent other backends and caches from being cleared.
  const results = await Promise.allSettled(
    cached.map(async (highlighter) => {
      let instance: DiffsHighlighter;
      try {
        instance = await highlighter;
      } catch {
        return;
      }
      instance.dispose();
    })
  );
  cleanUpResolvedLanguages();
  cleanUpResolvedThemes();
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}
