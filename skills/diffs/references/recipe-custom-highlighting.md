# Recipe: register custom highlighting

Register themes before a surface loads them. TextMate and Zed registrations can
use the same name so changing backends keeps the component theme option.

```ts
import {
  registerCustomLanguage,
  registerCustomTheme,
  registerCustomZedTheme,
} from '@pierre/diffs';

registerCustomLanguage(
  'my-language',
  () => import('./my-language.tmLanguage.json'),
  ['myext']
);
registerCustomTheme('my-theme', () => import('./my-textmate-theme.json'));
registerCustomZedTheme('my-theme', () => import('./my-zed-theme.json'));
```

Set `file.lang` and `options.theme` to the registered names. Custom languages
apply to Shiki; Highlights bundles its lexers and ignores custom grammars. Set
`options.preferredHighlighter` to `'highlights'` to use the Zed palette.

For a portable CSS palette:

```ts
import { registerCustomCSSVariableTheme } from '@pierre/diffs';

registerCustomCSSVariableTheme('app-palette', {
  foreground: '#eeeeee',
  background: '#101010',
  'token-keyword': '#c084fc',
  'token-string-expression': '#86efac',
});
```

This retains the `--diffs-*` variables on every backend, including defaults and
optional font styles. `createCSSVariablesTheme(options)` returns a portable
`DiffsTheme` for use with `registerCustomTheme` or application theme catalogs.
