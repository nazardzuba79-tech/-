// Integration baseline: fresh main ac2d583 + approved archive f1836a7 + Pro 0a76da5.
// Financial behavior is independently covered by nativeHistoricalCurrent, nativeLiveProjection,
// calculatorMath, nativeQuoteReadOnly and mounted Futures Pro/order/close-all tests.
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
// Restored verbatim from the owner-approved institutional prestige scene.
// Only these named additions are excluded from the older body fingerprint;
// the separate assertion below rejects any missing, duplicate or extra key.
// Only reverse this exact, tested wording correction for the older fingerprint.
const cfdCopyBefore: Record<string,string> = {"en":"CFD prices are coming soon.","ru":"Цены CFD скоро появятся.","es":"Los precios de CFD estarán disponibles pronto.","hi":"CFD कीमतें जल्द ही उपलब्ध होंगी।","ja":"CFD価格は近日公開予定です。","ko":"CFD 가격은 곧 제공될 예정입니다.","zh":"CFD 价格即将上线。"};
const cfdCopyAfter: Record<string,string> = {"en":"CFD trading temporarily unavailable.","ru":"Торговля CFD временно недоступна.","es":"La negociación de CFD no está disponible temporalmente.","hi":"CFD ट्रेडिंग अस्थायी रूप से अनुपलब्ध है।","ja":"CFD取引は一時的に利用できません。","ko":"CFD 거래를 일시적으로 이용할 수 없습니다.","zh":"CFD 交易暂不可用。"};
const restoredEcosystemKeys = [
  'label', 'globalMarkets', 'equities', 'derivatives', 'capitalMarkets',
  'title', 'subtitle', 'pause', 'resume', 'nasdaq', 'nyse', 'cme',
  'jpmorgan', 'goldman', 'morganstanley',
].map(key => `home.ecosystem.${key}`);

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
    // Advanced again by the TP/SL review follow-up: still +16/-0 per file
    // against main, with no deletion anywhere in the locales directory. The
    // two extra keys per language are `futures.protectionTriggering` and
    // `futures.protectionNoMarkPrice` — the honest words for a trigger that
    // is executing and for a missing mark price — both asserted by name
    // below.
    // Advanced again for the CFD chart's TradingView failure fallback:
    // +3/-0 per file against main, and `git diff --numstat` over the
    // locales directory reports `3  0` for all seven — no deletion
    // anywhere. The three keys per language are
    // `trade.cfdChartUnavailable`, `trade.cfdChartUnavailableHint` and
    // `trade.cfdChartRetry`, the words the chart area uses when
    // TradingView's CDN cannot be reached; asserted by name below, in
    // seven distinct translations, so this re-take cannot quietly cover
    // anything else.
    // Advanced again for the Futures terminal's calculator and order ticket:
    // `git diff --numstat` over the locales directory reports `82  0` for
    // every one of the seven — 82 additions, NOT ONE DELETION anywhere, so
    // no existing string was retyped, re-escaped or reflowed. The 82 lines
    // per language are 62 `calc.*` keys (the read-only calculator's own
    // words), 19 `futures.*` keys and one section comment. The futures keys
    // are the order ticket's fee/maximum-position/entry
    // rows, TP/SL at order entry, Close All and its confirmation, and the
    // connection/fee status strip. Both groups are asserted by name below,
    // so this re-take cannot quietly cover anything else.
    const digests: Record<string, string> = {
      // Owner-approved BELOW_MINIMUM label now explicitly says manual processing.
      // Re-taken for two added keys, 'trade.chartLoadFailed' and
      // 'trade.chartRetry': the futures chart no longer answers a failed
      // candle load with a silent blank canvas, so it needs words and a retry
      // button. Both are asserted by name below, in every locale, so this
      // re-take cannot quietly carry anything else with it.
      // Re-taken 2026-09-22 for «Закрытие по лимиту» (the limit-close
      // dialog «Лимитный» opens) and the reduce-only side gating: fifteen
      // `futures.limitClose*` / `futures.reduceOnlyNo*` keys per language
      // (eighteen lines in Russian, which also carries a section comment),
      // then again the same day for the five `futures.orderError.*`
      // sentences the owner's AKEUSDT refusal needed (a near-live price the
      // server could not refresh, a busy lane, a reducing order on the wrong
      // position, an execution-mode mismatch, a duplicate). `git diff
      // --numstat` over the locales directory reports `5 0` for every
      // language — additions only, not one deletion, so no existing string
      // was retyped.
      "ru": "cee79381e7e8c726",
      "en": "f817d8dc7e0e9de1",
      "zh": "9b8a64f07b8782a3",
      "es": "4c1795cbfe0fa10c",
      "hi": "28856d15d5bc8944",
      "ja": "9af89252233dbf08",
      "ko": "b9720e7a2161a1e4"
};
    const { createHash } = require('crypto');
    for (const code of LOCALES) {
      const source = readLocale(code).split('\n').filter(line => {
        const key = line.match(/^\s*'([^']+)':/)?.[1];
        // Keys ADDED since the digests were taken are excluded by name
        // rather than by re-taking seven digests — that is what keeps the
        // guard meaningful: every OTHER byte of every dictionary still has
        // to match. `futures.openContract` is the label on the contract
        // name in an open position, which now opens that contract.
        // `futures.orderError.serverUnavailable` names a command the host
        // answered for a restarting API (a code-less 502/503/504).
        // `futures.hint*` are the six title hints on the positions table's
        // abbreviated headings (2026-09-24: the owner asked what «Стоим.»
        // is; the heading itself stays one line, the hint is a title).
        const addedSinceDigest = ['futures.allMarkets', 'futures.openContract', 'futures.orderError.serverUnavailable',
          'futures.contractDetails', 'futures.contractExpiry', 'futures.contractPerpetual', 'futures.contractSettle', 'futures.contractMaxLeverage', 'futures.contractQtyStep', 'futures.contractMaxQty',
          'futures.hintValue', 'futures.hintMargin', 'futures.hintMark', 'futures.hintLiq', 'futures.hintUnrealized', 'futures.hintRealized'];
        return !key || (!restoredEcosystemKeys.includes(key) && !addedSinceDigest.includes(key));
      }).join('\n');
      expect(dicts[code]['trade.cfdUnavailable']).toBe(cfdCopyAfter[code]);
      // Russian `futures.colMark` was shortened to «Цена марк.» (like «Цена
      // ликвид.») so every positions heading fits on one line at 1600; the
      // digest is taken over the original wording, restored here by name.
      const restored = source.replace("'trade.cfdUnavailable': '" + cfdCopyAfter[code] + "'", "'trade.cfdUnavailable': '" + cfdCopyBefore[code] + "'")
        .replace(code === 'ru' ? "'futures.colMark': 'Цена марк.'" : '\u0000', "'futures.colMark': 'Цена маркировки'");
      const body = restored.slice(restored.indexOf('= {') + 2).replace(/\s*as const;\s*$/, '').replace(/;\s*$/, '');
      expect({ code, digest: createHash('sha256').update(body).digest('hex').slice(0, 16) })
        .toEqual({ code, digest: digests[code] });
    }
  });

  it('adds exactly the approved institutional vocabulary without changing older dictionary bytes', () => {
    for (const code of LOCALES) {
      const keys = [...readLocale(code).matchAll(/^\s*'(home\.ecosystem\.[^']+)':/gm)].map(match => match[1]);
      expect({ code, keys: keys.sort() }).toEqual({ code, keys: [...restoredEcosystemKeys].sort() });
      for (const key of restoredEcosystemKeys) expect(dicts[code][key].trim()).not.toBe('');
    }
  });

  it('carries the six positions-heading hints in every language, translated', () => {
    for (const key of ['futures.hintValue', 'futures.hintMargin', 'futures.hintMark', 'futures.hintLiq', 'futures.hintUnrealized', 'futures.hintRealized']) {
      const lines = LOCALES.map((code) => {
        const line = readLocale(code).split('\n').find((l) => l.includes(`'${key}':`));
        expect({ code, key, line }).not.toEqual({ code, key, line: undefined });
        return line!.slice(line!.indexOf(':') + 1).trim();
      });
      expect({ key, distinct: new Set(lines).size }).toEqual({ key, distinct: LOCALES.length });
    }
  });

  it('carries the CFD chart-unavailable vocabulary in every language, translated', () => {
    // The keys the latest re-take accounts for. Named here so the digests
    // above cannot be advanced for something else, and asserted distinct so
    // no locale is quietly serving another language's string as its own.
    for (const key of ['trade.cfdChartUnavailable', 'trade.cfdChartUnavailableHint', 'trade.cfdChartRetry']) {
      const lines = LOCALES.map((code) => {
        const line = readLocale(code).split('\n').find((l) => l.includes(`'${key}':`));
        expect(line).toBeDefined();
        return line!.slice(line!.indexOf(':') + 1).trim();
      });
      expect(new Set(lines).size).toBe(LOCALES.length);
    }
  });

  it('carries the Futures terminal vocabulary the digests were re-taken for', () => {
    // What the re-take above accounts for, named so it cannot be advanced
    // for something else while pointing at this change.
    //
    // Two shapes are checked differently on purpose. PROSE — a sentence a
    // trader reads — has to be seven different strings, or one language is
    // serving another's copy. TERMS are allowed to coincide: `Maker` and
    // `Taker` are the same loanword in English and Spanish, and pretending
    // otherwise would mean inventing a Spanish word nobody uses.
    const FUTURES_PROSE = [
      'futures.tpslReduceOnlyOff', 'futures.tpslArmed', 'futures.tpslNotArmed',
      'futures.tpslArmFailed', 'futures.closeAllTitle', 'futures.closeAllBody',
      'futures.closeAllDone', 'futures.closeAllPartial',
    ];
    const FUTURES_TERMS = [
      'futures.estFees', 'futures.maxPosition', 'futures.approxEntry',
      'futures.tpslAtEntry', 'futures.closeAll', 'futures.closeAllConfirm',
      'futures.closeAllRunning', 'futures.statusLive', 'futures.statusOffline',
      'futures.feeMaker', 'futures.feeTaker',
    ];
    expect(FUTURES_PROSE.length + FUTURES_TERMS.length).toBe(19);
    for (const code of LOCALES) {
      for (const key of [...FUTURES_PROSE, ...FUTURES_TERMS]) {
        expect({ code, key, value: typeof (dicts[code] as any)[key] })
          .toEqual({ code, key, value: 'string' });
        expect((dicts[code] as any)[key].trim().length).toBeGreaterThan(0);
      }
    }
    for (const key of FUTURES_PROSE) {
      const lines = LOCALES.map((code) => (dicts[code] as any)[key]);
      expect({ key, distinct: new Set(lines).size }).toEqual({ key, distinct: LOCALES.length });
    }
  });

  it('gives the chart failure its own words and its own button, in every language', () => {
    // The futures chart used to answer a failed candle load with a blank
    // canvas and nothing else. These two keys are what replaced that, so they
    // have to exist and be genuinely translated everywhere — an untranslated
    // retry button is a dead end for anyone not reading Russian.
    const CHART_ERROR = ['trade.chartLoadFailed', 'trade.chartRetry'];
    for (const code of LOCALES) {
      for (const key of CHART_ERROR) {
        expect({ code, key, value: typeof (dicts[code] as any)[key] })
          .toEqual({ code, key, value: 'string' });
        expect((dicts[code] as any)[key].trim().length).toBeGreaterThan(0);
      }
    }
    // Distinct per language: the message is prose, so seven identical strings
    // would mean six of them were never translated.
    const messages = LOCALES.map((code) => (dicts[code] as any)['trade.chartLoadFailed']);
    expect(new Set(messages).size).toBe(LOCALES.length);
  });

  it('carries the read-only calculator vocabulary in all seven languages', () => {
    // 62 keys is a lot to name one by one; what matters is that every
    // language carries the SAME 62 and that none of them is Russian left
    // in place. The calculator is the surface a trader does arithmetic on,
    // so an untranslated label there is a wrong answer waiting to happen.
    const calcKeys = (code: string) =>
      Object.keys(dicts[code as never]).filter((k) => k.startsWith('calc.')).sort();
    const reference = calcKeys('ru');
    expect(reference).toHaveLength(62);
    for (const code of LOCALES) {
      expect({ code, keys: calcKeys(code) }).toEqual({ code, keys: reference });
    }
    // Every non-Russian locale differs from Russian on a clear majority of
    // them. A handful of shared tokens (`PnL`, `ROI`) is expected; a file
    // that matches Russian nearly everywhere has not been translated.
    for (const code of LOCALES.filter((c) => c !== 'ru')) {
      const differing = reference.filter(
        (key) => (dicts[code] as any)[key] !== (dicts.ru as any)[key],
      ).length;
      expect({ code, atLeast: differing > reference.length / 2 }).toEqual({ code, atLeast: true });
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
      // The review follow-up's two states.
      'futures.protectionTriggering', 'futures.protectionNoMarkPrice',
    ];
    expect(TPSL_KEYS).toHaveLength(16);
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

// ── Contract details under the order ticket ──────────────────────────

describe('contract details keys', () => {
  const keys = [
    'futures.contractDetails', 'futures.contractExpiry', 'futures.contractPerpetual', 'futures.contractSettle',
    'futures.contractMaxLeverage', 'futures.contractQtyStep', 'futures.contractMaxQty',
  ];

  it('are present in every language, each a distinct, non-empty phrase', () => {
    for (const code of LOCALES) {
      const values = keys.map(key => dicts[code][key]);
      expect({ code, missing: keys.filter((key, i) => typeof values[i] !== 'string' || values[i].trim() === '') }).toEqual({ code, missing: [] });
      expect({ code, distinct: new Set(values).size }).toEqual({ code, distinct: keys.length });
    }
  });
});
