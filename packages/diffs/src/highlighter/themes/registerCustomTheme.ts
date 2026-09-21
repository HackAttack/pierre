import { type CustomThemeLoader, customThemes } from './themeResolver';

export type { CustomThemeLoader } from './themeResolver';

/** Register a TextMate, Highlights (Zed), or portable Diffs theme loader. */
export function registerCustomTheme(
  themeName: string,
  loader: CustomThemeLoader
): void {
  if (customThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  customThemes.set(themeName, loader);
}
