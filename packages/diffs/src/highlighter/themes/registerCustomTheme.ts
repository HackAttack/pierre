import { type CustomThemeLoader, customThemes } from './themeResolver';

export type { CustomThemeLoader } from './themeResolver';

/** Register a lazy theme loader for Shiki (TextMate) or Highlights (Zed). */
export function registerCustomTheme(
  themeName: string,
  loader: CustomThemeLoader,
  type: 'textmate' | 'zed' = 'textmate'
): void {
  const themes = customThemes.get(themeName) ?? {};
  if (themes[type] !== undefined) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name and type already registered',
      themeName,
      type
    );
    return;
  }
  themes[type] = loader;
  customThemes.set(themeName, themes);
}
