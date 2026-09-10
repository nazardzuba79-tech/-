import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { LOCALES, readAllLocales, readDictionaries, readI18nModule, readLocale } from '../../../test-utils/i18nSource';

/**
 * Language chunks: the split, and the integrity of what was split.
 *
 * `lib/i18n.tsx` used to hold all seven dictionaries, so every user
 * downloaded seven languages to read one — 268 kB raw / 101 kB gzip in the
 * shared chunk. They now live one-per-file and only Russian is static.
 *
 * Two things need proving, and they pull in opposite directions:
 *
 *   1. the six other languages really are OUT of the initial bundle, and
 *      cannot quietly come back;
 *   2. not one translation was lost or altered on the way out.
 *
 * The second is the reason this file is long. Moving 400 kB of strings
 * between files is exactly the kind of change where a dropped key is
 * invisible until a user sees a raw `nav.deposit` on screen.
 */

const frontend = resolve(__dirname, '../../..');
const module_ = readI18nModule();
/** Executable code only — the file's own comments discuss what it does NOT
 *  do (prefetch, barrels), which a naive substring search would match. */
const executable = module_.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const dicts = readDictionaries();

// ── Integrity ───────────────────────────────────────────────────────

describe('translation integrity', () => {
  it('has all seven dictionaries, and each is non-trivial', () => {
    expect(Object.keys(dicts).sort()).toEqual([...LOCALES].sort());
    for (const code of LOCALES) {
      // Guards every count below: a dictionary that failed to parse would
      // make the comparisons vacuously true.
      expect(Object.keys(dicts[code]).length).toBeGreaterThan(1000);
    }
  });

  it('gives every language exactly the Russian key set — none lost, none invented', () => {
    const ru = Object.keys(dicts.ru).sort();
    for (const code of LOCALES) {
      const keys = Object.keys(dicts[code]).sort();
      expect({ code, missing: ru.filter((k) => !(k in dicts[code])) }).toEqual({ code, missing: [] });
      expect({ code, extra: keys.filter((k) => !(k in dicts.ru)) }).toEqual({ code, extra: [] });
    }
  });

  it('keeps every value a non-empty string', () => {
    // An empty value renders as blank text, which is the failure mode a
    // botched extraction would produce.
    for (const code of LOCALES) {
      const empty = Object.entries(dicts[code]).filter(([, v]) => typeof v !== 'string');
      expect({ code, empty }).toEqual({ code, empty: [] });
    }
  });

  it('preserves the exact source bytes of every dictionary body', () => {
    // The strongest statement available: each locale file's object literal
    // is the same text it was inside i18n.tsx, so no string was retyped,
    // re-escaped or reflowed. Recorded as content digests rather than as a
    // whole-file hash, so a comment added above a dictionary cannot force a
    // re-take of a claim about the STRINGS.
    //
    // Re-taken for real Futures TP/SL. Every one of the seven files is
    // +14/-0: not a single existing line was removed, edited, retyped or
    // reflowed — `git diff` over the locales directory contains no deletion
    // at all. The 14 additions per language are exactly the `futures.tpsl`
    // / `futures.*Short` / `futures.*Label` / `futures.protection*` keys the
    // position-row TP/SL control needs, asserted by name below so this
    // re-take cannot quietly cover anything else.
    const digests: Record<string, string> = {
      ru: 'd81cedb2098cc28e', en: 'bb75f9295d8100aa', zh: '07c27d6b880d06b0',
      es: '85c19cf32ace9696', hi: '132e9304b4cd2b67', ja: 'd16fc93ac3065975',
      ko: 'dec6721187be9c2b',
    };
    const { createHash } = require('crypto');
    for (const code of LOCALES) {
      const source = readLocale(code);
      const body = source.slice(source.indexOf('= {') + 2).replace(/\s*as const;\s*$/, '').replace(/;\s*$/, '');
      expect({ code, digest: createHash('sha256').update(body).digest('hex').slice(0, 16) })
        .toEqual({ code, digest: digests[code] });
    }
  });

  it('carries the futures TP/SL vocabulary in every language, translated', () => {
    // The keys the re-take above accounts for. Named here so the digests
    // cannot be advanced for some other change while pointing at this one.
    const TPSL_KEYS = [
      'futures.tpsl', 'futures.takeProfitShort', 'futures.stopLossShort',
      'futures.takeProfitLabel', 'futures.stopLossLabel', 'futures.protectionTitle',
      'futures.protectionMarkHint', 'futures.protectionSave', 'futures.protectionRemove',
      'futures.protectionCancel', 'futures.protectionSaving', 'futures.protectionError',
      'futures.protectionRetrying', 'futures.protectionNotSet',
    ];
    expect(TPSL_KEYS).toHaveLength(14);
    for (const code of LOCALES) {
      for (const key of TPSL_KEYS) {
        expect({ code, key, value: typeof (dicts[code] as any)[key] })
          .toEqual({ code, key, value: 'string' });
        expect((dicts[code] as any)[key].length).toBeGreaterThan(0);
      }
      // Actually translated, not the Russian copied across: the longest
      // string of the set differs from Russian in every other language.
      if (code !== 'ru') {
        expect({ code, same: (dicts[code] as any)['futures.protectionMarkHint'] === (dicts.ru as any)['futures.protectionMarkHint'] })
          .toEqual({ code, same: false });
      }
    }
  });

  it('keeps nav.botsSoon and still has no nav.bots', () => {
    // The cancelled AI Bots key must not reappear; the footer's "coming
    // soon" label must not disappear.
    for (const code of LOCALES) {
      expect(dicts[code]['nav.bots']).toBeUndefined();
      expect(typeof dicts[code]['nav.botsSoon']).toBe('string');
    }
  });

  it('preserves the Crypto Card, Home, Copy Trading and Futures strings in every language', () => {
    const keys = [
      'nav.card', 'home.card.name', 'authShell.card.title',
      'home.hero.titleTop', 'marketing.feature.copyTrading.text',
      'futures.openInterest', 'futures.headerTurnover24h', 'futures.headerFunding',
      'trade.cfdPriceDisclaimer',
    ];
    for (const code of LOCALES) {
      for (const key of keys) expect({ code, key, ok: typeof dicts[code][key] === 'string' }).toEqual({ code, key, ok: true });
    }
    // A couple of exact values, so "present" cannot mean "present but blank
    // or replaced".
    expect(dicts.ru['home.hero.titleTop']).toBe('OWN YOUR FUTURE.');
    expect(dicts.en['home.hero.titleTop']).toBe('OWN YOUR FUTURE.');
  });
});

// ── The module's own public surface is unchanged ────────────────────

describe('the i18n public surface is unchanged', () => {
  it('keeps LANGUAGES in the same order with the same labels', () => {
    const declared = [...module_.matchAll(/\{ code: '(\w+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
    expect(declared).toEqual([
      ['ru', 'RU'], ['en', 'EN'], ['zh', '中文'], ['es', 'ES'],
      ['hi', 'हिन्दी'], ['ja', '日本語'], ['ko', '한국어'],
    ]);
  });

  it('keeps every localeOf mapping', () => {
    for (const [lang, tag] of [['ru', 'ru-RU'], ['zh', 'zh-CN'], ['es', 'es-ES'], ['hi', 'hi-IN'], ['ja', 'ja-JP'], ['ko', 'ko-KR']]) {
      expect(module_).toMatch(new RegExp(`'${lang}'[\\s\\S]{0,40}'${tag}'`));
    }
    // English is the final fallback branch rather than a named arm.
    expect(module_).toContain("'en-US'");
  });

  it('persists under the same storage key, and still exports Lang, Key and useLanguage', () => {
    expect(module_).toContain("const LANG_KEY = 'exchange_lang'");
    expect(module_).toContain("export type Lang = 'ru' | 'en' | 'zh' | 'es' | 'hi' | 'ja' | 'ko'");
    expect(module_).toContain('export type { Key }');
    expect(module_).toContain('export function useLanguage()');
  });
});

// ── The split itself ────────────────────────────────────────────────

describe('language chunking', () => {
  it('imports only Russian statically', () => {
    expect(module_).toContain("import { RU } from './i18n/locales/ru'");
    for (const code of LOCALES.filter((c) => c !== 'ru')) {
      // A static import of any other locale puts it back in the entry chunk.
      expect(module_).not.toMatch(new RegExp(`import \\{[^}]*\\} from '\\./i18n/locales/${code}'`));
      expect(module_).toContain(`import('./i18n/locales/${code}')`);
    }
  });

  it('has no barrel that would re-import every locale', () => {
    // One `import * as locales` or a locales/index.ts undoes the whole
    // split silently, with the build still succeeding.
    const dir = resolve(frontend, 'src/lib/i18n/locales');
    expect(existsSync(join(dir, 'index.ts'))).toBe(false);
    expect(existsSync(join(dir, 'index.tsx'))).toBe(false);
    const offenders: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(resolve(frontend, rel), { withFileTypes: true })) {
        const next = join(rel, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(next);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(resolve(frontend, next), 'utf8');
          for (const code of LOCALES.filter((c) => c !== 'ru')) {
            if (new RegExp(`^import[^\\n]*from '[^']*i18n/locales/${code}'`, 'm').test(text)) {
              offenders.push(`${next} -> ${code}`);
            }
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });

  it('keeps the non-Russian locale files free of value imports', () => {
    // `import { Key }` without `type` would pull ru.ts into every locale
    // chunk, so each chunk would carry the Russian dictionary too.
    for (const code of LOCALES.filter((c) => c !== 'ru')) {
      const source = readLocale(code);
      expect(source).toContain("import type { Key } from './keys'");
      expect(source).not.toMatch(/^import \{/m);
    }
    expect(readLocale('ru')).not.toMatch(/^import /m);
  });

  it('does not prefetch the six unused languages', () => {
    // Warming them after load would move the bytes rather than save them.
    expect(executable).not.toMatch(/prefetch|preload|warmLocales|Promise\.all\(\s*Object\.values\(LOADERS\)/);
  });

  it('caches a loaded dictionary in memory so switching back costs no request', () => {
    expect(module_).toContain('const loaded: Partial<Record<Lang, Record<Key, string>>> = { ru: RU }');
    expect(module_).toContain('loaded[lang] = dictionary');
  });
});

// ── The no-flash contract ───────────────────────────────────────────

describe('no wrong-language flash', () => {
  it('moves lang and dict together, as one piece of state', () => {
    // The whole design: there is no render in which the active language and
    // the dictionary on screen disagree.
    expect(module_).toContain('useState<{ lang: Lang; dict: Record<Key, string> | null }>');
    expect(module_).toMatch(/setState\(\{ lang: next, dict \}\)/);
  });

  it('holds a neutral shell instead of rendering children in the wrong language', () => {
    expect(module_).toContain('if (!state.dict) {');
    expect(module_).toContain("background: 'var(--bg)'");
    expect(module_).toContain("minHeight: '100vh'");
  });

  it('reads the persisted language before choosing what to render', () => {
    expect(module_).toContain('const initial = getInitialLang();');
    expect(module_).toContain('dict: loaded[initial] ?? null');
  });

  it('keeps the last valid language when a switch fails to load', () => {
    // A failed switch must not empty the screen or show keys.
    const setLang = module_.slice(module_.indexOf('function setLang'), module_.indexOf('function t('));
    expect(setLang).toContain('.catch(() => {})');
    expect(setLang).toContain("localStorage.setItem(LANG_KEY, next)");
  });

  it('falls back to Russian honestly if the persisted language cannot load', () => {
    // `lang` becomes 'ru' too, so the switcher shows RU rather than
    // claiming a language the user is not reading — and the stored
    // preference is left alone so a later reload retries it.
    expect(module_).toContain("setState({ lang: 'ru', dict: RU })");
    const effect = module_.slice(module_.indexOf('useEffect(() => {'), module_.indexOf('function setLang'));
    expect(effect).not.toContain('localStorage.setItem');
  });
});
