import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { RU } from './i18n/locales/ru';
import type { Key } from './i18n/locales/keys';

export type { Key };

export type Lang = 'ru' | 'en' | 'zh' | 'es' | 'hi' | 'ja' | 'ko';

const LANG_KEY = 'exchange_lang';

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'ES' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

// BCP-47 locale tag for Intl/toLocaleString calls — kept in one place so
// every date/number formatting call site doesn't repeat its own ternary.
export function localeOf(lang: Lang): string {
  return lang === 'ru'
    ? 'ru-RU'
    : lang === 'zh'
    ? 'zh-CN'
    : lang === 'es'
    ? 'es-ES'
    : lang === 'hi'
    ? 'hi-IN'
    : lang === 'ja'
    ? 'ja-JP'
    : lang === 'ko'
    ? 'ko-KR'
    : 'en-US';
}

// Flat key -> string dictionaries. Russian is the default language; English
// and Chinese are the alternatives — no other language is supported
// anywhere in the UI (including the KYC country list, see countries.ts).

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'ru' || stored === 'en' || stored === 'zh' || stored === 'es' || stored === 'hi' || stored === 'ja' || stored === 'ko') return stored;
  } catch {
    // localStorage unavailable — fall through to the default
  }
  return 'ru';
}

/**
 * On-demand dictionaries.
 *
 * A static path per language, so Vite emits one chunk per locale and the
 * six a given user does not read never enter the initial bundle. There is
 * deliberately NO barrel module here: one `import * as locales` would put
 * all seven back in the entry chunk and silently undo the split, which is
 * why `i18nLanguageChunks.test.ts` asserts no such file exists.
 *
 * Nothing is prefetched. Warming the other six after load would move the
 * bytes rather than save them.
 */
const LOADERS: Record<Exclude<Lang, 'ru'>, () => Promise<Record<Key, string>>> = {
  en: () => import('./i18n/locales/en').then((m) => m.EN),
  zh: () => import('./i18n/locales/zh').then((m) => m.ZH),
  es: () => import('./i18n/locales/es').then((m) => m.ES),
  hi: () => import('./i18n/locales/hi').then((m) => m.HI),
  ja: () => import('./i18n/locales/ja').then((m) => m.JA),
  ko: () => import('./i18n/locales/ko').then((m) => m.KO),
};

/**
 * Dictionaries already in memory, seeded with Russian.
 *
 * Module scope rather than component state on purpose: a language the user
 * has visited once stays loaded for the life of the tab, so switching back
 * and forth costs no further request — and the browser's own module cache
 * means even a hard switch after a reload is usually free.
 */
const loaded: Partial<Record<Lang, Record<Key, string>>> = { ru: RU };

export function isLanguageLoaded(lang: Lang): boolean {
  return loaded[lang] !== undefined;
}

async function loadDictionary(lang: Lang): Promise<Record<Key, string>> {
  const cached = loaded[lang];
  if (cached) return cached;
  const dictionary = await LOADERS[lang as Exclude<Lang, 'ru'>]();
  loaded[lang] = dictionary;
  return dictionary;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * The language provider.
 *
 * `lang` and `dict` are ONE piece of state, changed together. That is the
 * whole design: a returning Korean user must never see the app painted in
 * Russian and then swapped, and a mid-session switch must never show
 * translation keys while the new dictionary is in flight. Because the two
 * always move together there is no render in which they disagree.
 *
 * While the FIRST dictionary is loading — only possible for a returning
 * non-Russian user — children are not rendered at all. Rendering them
 * against Russian would be the wrong-language flash; rendering them
 * against keys would show `nav.deposit` on screen; rendering an empty
 * string would be a blank page that then reflows. The hold is the app's
 * own background at full height, so the first real paint lands on a ground
 * of exactly the same colour with nothing to shift.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const initial = getInitialLang();
  const [state, setState] = useState<{ lang: Lang; dict: Record<Key, string> | null }>(() => ({
    lang: initial,
    dict: loaded[initial] ?? null,
  }));

  /**
   * Which language request is the current one.
   *
   * Dictionaries arrive over the network, so two of them can be in flight at
   * once — pick EN, change your mind, pick JA — and they can finish in
   * either order. Without this, whichever request finished LAST would win,
   * which is not the same thing as the language the user chose last: a slow
   * EN landing after a fast JA would silently repaint the app in English
   * while `exchange_lang` still said Japanese.
   *
   * Every intent to change language — the initial read included — claims the
   * next number, and only the holder of the current number may commit. A
   * stale result is dropped, not merged.
   *
   * A ref rather than state on purpose: claiming a number must take effect
   * for the very next promise callback, without waiting for a re-render.
   */
  const request = useRef(0);

  useEffect(() => {
    if (state.dict) return;
    const id = ++request.current;
    loadDictionary(state.lang)
      .then((dict) => {
        if (request.current === id) setState({ lang: state.lang, dict });
      })
      .catch(() => {
        // The stored language's chunk could not be fetched. Falling back to
        // Russian is a degraded state, not a lie: `lang` becomes 'ru' too,
        // so the switcher shows RU and the user can pick again. The stored
        // preference is deliberately NOT overwritten — a later reload, on a
        // working connection, still gets the language they chose.
        //
        // Guarded too: if the user has already picked something else while
        // this was failing, that choice stands and this must not undo it.
        if (request.current === id) setState({ lang: 'ru', dict: RU });
      });
  }, [state.dict, state.lang]);

  function setLang(next: Lang) {
    // Claimed BEFORE anything else, so an in-flight load started earlier is
    // stale from this moment — including when the language picked now is
    // already cached and commits synchronously below.
    const id = ++request.current;
    // Persist immediately: the preference is the user's choice and survives
    // even if the dictionary fetch then fails.
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // ignore — language just won't persist across reloads
    }
    const cached = loaded[next];
    if (cached) {
      setState({ lang: next, dict: cached });
      return;
    }
    void loadDictionary(next)
      .then((dict) => {
        // `loadDictionary` has already put the dictionary in the cache by
        // now, so even a superseded request leaves the app faster: picking
        // that language later costs no second request. It just may not
        // change what is on screen.
        if (request.current === id) setState({ lang: next, dict });
      })
      // A failed switch leaves the last valid language on screen, untouched.
      // Nothing flashes, nothing empties, and the switcher still works.
      .catch(() => {});
  }

  function t(key: Key, params?: Record<string, string | number>): string {
    let text = state.dict?.[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replace(`{${name}}`, String(value));
      }
    }
    return text;
  }

  if (!state.dict) {
    return <div aria-busy="true" style={{ minHeight: '100vh', width: '100%', background: 'var(--bg)' }} />;
  }

  return <LanguageContext.Provider value={{ lang: state.lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
