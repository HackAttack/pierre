import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';

import type { CodeToHtmlOptions, TokensResult } from '../types';
import { renderTokenLines } from './renderTokenLines';

/** Serialize highlighted tokens without loading a backend's HTML renderer. */
export function tokensToHtml(
  result: TokensResult,
  options: CodeToHtmlOptions
): string {
  const code: Element = {
    type: 'element',
    tagName: 'code',
    properties: {},
    children: [],
  };
  const lines = renderTokenLines(result.tokens, {
    decorations: options.decorations,
    mergeWhitespaces: options.mergeWhitespaces,
  });
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) code.children.push({ type: 'text', value: '\n' });
    code.children.push(lines[i]);
  }
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {
          class: 'diffs',
          style:
            result.rootStyle === false
              ? undefined
              : (result.rootStyle ??
                [
                  result.fg != null ? `color:${result.fg}` : '',
                  result.bg != null ? `background-color:${result.bg}` : '',
                ]
                  .filter(Boolean)
                  .join(';')),
          tabIndex: 0,
        },
        children: [code],
      },
    ],
  };
  return toHtml(root);
}
