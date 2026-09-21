import {
  customTextMateThemes,
  type CustomThemeLoader,
  type CustomZedThemeLoader,
  customZedThemes,
} from './themeResolver';

export type { CustomThemeLoader, CustomZedThemeLoader } from './themeResolver';

/** Register a TextMate theme for Shiki or a portable Diffs theme for both backends. */
export function registerCustomTheme(
  themeName: string,
  loader: CustomThemeLoader
): void {
  if (customTextMateThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  customTextMateThemes.set(themeName, loader);
}

export const registerCustomTextMateTheme: typeof registerCustomTheme =
  registerCustomTheme;

/** A Zed registration may share its name with a separate TextMate registration. */
export function registerCustomZedTheme(
  themeName: string,
  loader: CustomZedThemeLoader
): void {
  if (customZedThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomZedTheme: theme name already registered',
      themeName
    );
    return;
  }
  customZedThemes.set(themeName, loader);
}
