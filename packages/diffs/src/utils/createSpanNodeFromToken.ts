import type { ThemedToken } from '../types';
import { tokenStyle } from './tokenStyle';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  element.style.cssText = tokenStyle(token);
  element.textContent = token.content;
  return element;
}
