import type { HighlighterCore } from 'shiki/core';

import type { DiffsHighlighter } from '../types';

/** Raw Shiki state stays private to the backend and grammar attachment helpers. */
export const shikiInternals: WeakMap<DiffsHighlighter, HighlighterCore> =
  new WeakMap();

export const attachedShikiLanguages: WeakMap<
  DiffsHighlighter,
  Set<string>
> = new WeakMap();
