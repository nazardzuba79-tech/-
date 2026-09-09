import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Reading the translation dictionaries from a test.
 *
 * The seven dictionaries used to live inside `lib/i18n.tsx`, so a test that
 * wanted to check every language read that one file and counted matches.
 * They now live one-per-file under `lib/i18n/locales/` so the six a user
 * does not read stay out of the initial bundle.
 *
 * This helper exists so that change did not weaken a single assertion: a
 * test that counted seven occurrences in one file still counts seven, and
 * now does so across seven files it names explicitly — which is a stronger
 * statement, because a language silently dropped from the set would make
 * the read itself fail rather than quietly lower a count.
 */

const lib = resolve(__dirname, '../src/lib');

/** Every supported language, in the order LANGUAGES declares them. */
export const LOCALES = ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'] as const;
export type LocaleCode = (typeof LOCALES)[number];

/** One locale's raw source. */
export function readLocale(code: LocaleCode): string {
  return readFileSync(resolve(lib, `i18n/locales/${code}.ts`), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * All seven dictionaries concatenated, in language order.
 *
 * The drop-in replacement for the old `read('lib/i18n.tsx')` in tests that
 * were counting per-language occurrences of a key.
 */
export function readAllLocales(): string {
  return LOCALES.map(readLocale).join('\n');
}

/** The i18n module itself — loader, LANGUAGES, localeOf, the provider. */
export function readI18nModule(): string {
  return readFileSync(resolve(lib, 'i18n.tsx'), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The dictionaries as real objects, keyed by language.
 *
 * Each locale file is a plain `export const X = { ... }`, so the object
 * literal is evaluated directly rather than by loading the module graph —
 * no bundler, no dynamic import, no React.
 */
export function readDictionaries(): Record<LocaleCode, Record<string, string>> {
  const out = {} as Record<LocaleCode, Record<string, string>>;
  for (const code of LOCALES) {
    const source = readLocale(code);
    const start = source.indexOf('= {');
    const body = source.slice(start + 2).replace(/\s*as const;\s*$/, '').replace(/;\s*$/, '');
    // eslint-disable-next-line no-new-func
    out[code] = new Function(`return (${body});`)() as Record<string, string>;
  }
  return out;
}
