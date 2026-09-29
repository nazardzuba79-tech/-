import { RU } from '../src/lib/i18n/locales/ru';
import { EN } from '../src/lib/i18n/locales/en';
import { ZH } from '../src/lib/i18n/locales/zh';
import { ES } from '../src/lib/i18n/locales/es';
import { HI } from '../src/lib/i18n/locales/hi';
import { JA } from '../src/lib/i18n/locales/ja';
import { KO } from '../src/lib/i18n/locales/ko';

/**
 * `useLanguage()` over a REAL dictionary, for the source-evaluating harnesses
 * that render Copy Trading components without mounting the app's
 * `LanguageProvider`. The strings are the shipped ones, and placeholders are
 * substituted exactly as `lib/i18n.tsx` does it — every occurrence, by
 * split/join — so a harness reads what a viewer would read.
 */
export const DICTIONARIES = { ru: RU, en: EN, zh: ZH, es: ES, hi: HI, ja: JA, ko: KO } as Record<string, Record<string, string>>;
export type StubLanguage = keyof typeof DICTIONARIES;

export function translator(dictionary: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>): string => {
    let text = dictionary[key] ?? key;
    if (params) for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    return text;
  };
}

/** A module standing in for `lib/i18n` inside a harness. */
export function languageModule(lang: string = 'ru') {
  const t = translator(DICTIONARIES[lang]);
  return { useLanguage: () => ({ lang, setLang: () => {}, t }) };
}
