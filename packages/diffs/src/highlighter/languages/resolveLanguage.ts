import type { BundledLanguage } from 'shiki';

import type { SupportedLanguages } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import type { ResolvedLanguage } from '../../worker';
import {
  RegisteredCustomLanguages,
  ResolvedLanguages,
  ResolvingLanguages,
} from './constants';

export async function resolveLanguage(
  lang: Exclude<SupportedLanguages, 'text' | 'ansi'>
): Promise<ResolvedLanguage> {
  if (isWorkerContext()) {
    throw new Error(
      `resolveLanguage("${lang}") cannot be called from a worker context. Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.`
    );
  }
  const pending = ResolvingLanguages.get(lang);
  if (pending != null) return pending;
  const resolver = (async () => {
    let loader = RegisteredCustomLanguages.get(lang);
    if (loader == null) {
      const { bundledLanguages } = await import('shiki/langs');
      if (Object.prototype.hasOwnProperty.call(bundledLanguages, lang))
        loader = bundledLanguages[lang as BundledLanguage];
    }
    if (loader == null)
      throw new Error(
        `resolveLanguage: "${lang}" not found in bundled or custom languages`
      );
    const { default: data } = await loader();
    const resolvedLang = { name: lang, data };
    if (!ResolvedLanguages.has(lang)) ResolvedLanguages.set(lang, resolvedLang);
    return resolvedLang;
  })();
  ResolvingLanguages.set(lang, resolver);
  try {
    return await resolver;
  } finally {
    if (ResolvingLanguages.get(lang) === resolver)
      ResolvingLanguages.delete(lang);
  }
}
