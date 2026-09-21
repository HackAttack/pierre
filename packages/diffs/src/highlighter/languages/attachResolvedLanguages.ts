import type { DiffsHighlighter } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import {
  attachedShikiLanguages,
  shikiInternals,
} from '../backends/shiki-internals';
import { AttachedLanguages, ResolvedLanguages } from './constants';

export function attachResolvedLanguages(
  resolvedLanguages: ResolvedLanguage | ResolvedLanguage[],
  highlighter: DiffsHighlighter
): void {
  if (highlighter.name === 'highlights') return;
  const raw = shikiInternals.get(highlighter);
  const attached = attachedShikiLanguages.get(highlighter);
  if (raw == null || attached == null)
    throw new Error('Highlighter is disposed');
  for (const resolvedLang of Array.isArray(resolvedLanguages)
    ? resolvedLanguages
    : [resolvedLanguages]) {
    if (attached.has(resolvedLang.name)) continue;
    let lang = ResolvedLanguages.get(resolvedLang.name);
    if (lang == null) {
      lang = resolvedLang;
      ResolvedLanguages.set(resolvedLang.name, lang);
    }
    const grammar = lang.data.find(
      (grammar) =>
        grammar.name === lang.name ||
        grammar.aliases?.includes(lang.name) === true
    );
    if (grammar == null) {
      throw new Error(
        `attachResolvedLanguages: No returned grammar declares "${lang.name}" as its name or an alias.`
      );
    }
    raw.loadLanguageSync(lang.data);
    try {
      raw.getLanguage(lang.name);
    } catch {
      throw new Error(
        `attachResolvedLanguages: "${grammar.name}" is already loaded without alias "${lang.name}". Load the alias first or give the grammar a unique name.`
      );
    }
    AttachedLanguages.add(lang.name);
    attached.add(lang.name);
  }
}
