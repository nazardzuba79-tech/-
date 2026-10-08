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
const depositUiKeys = ['back', 'chooseAsset', 'chooseNetwork', 'retry', 'search', 'noResults', 'networkHint',
  'yourAddress', 'changeAsset', 'changeNetwork', 'sendOnly', 'inNetwork', 'lossWarning', 'copyAddress',
  'copied', 'copyError', 'showQr', 'hideQr', 'qrLabel', 'memo', 'memoCopied', 'copyMemo',
  // Deposit window, 2026-09-29: the «Актив» field and the minimum stated before the address.
  'asset', 'minimumPeggedLine', 'minimumOtherLine', 'minimumApprox', 'minimumNote',
  'minimumLabel', 'minimumOtherValue',
  // Mobile deposit sheet, 2026-10-04: a Memo / Tag is marked as required.
  'memoRequired', 'memoHint'].map(key => `deposit.ui.${key}`);
// Mobile terminal, 2026-10-04: «Спот / Фьючерсы» switch, its two notes and the compact order-type selector.
const MOBILE_TERMINAL_KEYS = ['terminal.marketSwitch', 'terminal.noFuturesContract', 'terminal.noSpotPair', 'trade.orderType'];
const decimalRefusalKeys = ['Exponent', 'Sign', 'Separator', 'Character'].map(reason => `futures.number${reason}`);
const shortCardLabels: Record<string, string> = { ru: 'Crypto-Card', en: 'Crypto-Card', zh: 'Crypto-Card', es: 'Crypto-Card', hi: 'Crypto-Card', ja: 'Crypto-Card', ko: 'Crypto-Card' };
const KYC_PROFILE_CARD_KEYS = ['kycStepDocumentShort', 'kycStepReview', 'kycStepFilled', 'kycStepNotFilled', 'kycStepAdded', 'kycStepNotAdded',
  'kycStepNotSent', 'kycUploadTitle', 'kycUploadHint', 'kycChooseFile', 'kycReplaceFile', 'kycRemoveFile', 'kycPendingNoReupload',
  'kycRejectedHint', 'kycSubmittedData', 'kycStartCta', 'kycResubmitCta', 'kycOpenStatus', 'cardShortcutTitle'].map(key => `settings.${key}`);
const menuDescriptionKeys = ['Tools', 'Otc', 'Arbitrage', 'Learn', 'Knowledge', 'Faq', 'Glossary'].map(name => `nav.menu${name}Desc`);
// Aircraft authentication design approved 2026-10-05: eleven existing labels
// change and nine presentation labels are added. Name only those exact keys;
// password rules, errors, 2FA, legal and all other auth copy remain frozen.
const APPROVED_AUTH_DESIGN_KEYS = [
  'auth.email', 'auth.signIn', 'register.email',
  'authShell.hero.line1', 'authShell.hero.line2', 'authShell.hero.line3', 'authShell.lead',
  'authShell.overline.register', 'authShell.overline.login', 'auth.loginTitle', 'auth.loginSubtitle',
  'authShell.registerTitle', 'authShell.registerSubtitle', 'authShell.context',
  'authShell.communityCount', 'authShell.communityText', 'authShell.communityBadge',
  'authShell.cardCaption', 'authShell.supportHint', 'authShell.supportLink',
];
// PR #466: two additive auth promotional labels. Only these exact additions
// are omitted from the historical digest; existing numeric/other copy is not changed.
const AUTH_COMMUNITY_KEYS = ['authShell.communityTitle', 'authShell.communitySubtitle'];

// ── Integrity ───────────────────────────────────────────────────────

describe('translation integrity', () => {
  it('localizes the exact two-line card copy and 22+/70+ fiat/crypto counts without an investor claim', () => {
    const approvedCommunityCopy: Record<string, { title: string; subtitle: string }> = {
      ru: { title: 'Платите и снимайте наличные — 0% комиссии', subtitle: '22+ фиатных валют · 70+ криптовалют' },
      en: { title: 'Pay and withdraw cash — 0% fees', subtitle: '22+ fiat currencies · 70+ cryptocurrencies' },
      zh: { title: '支付与取现 — 手续费 0%', subtitle: '22+ 种法定货币 · 70+ 种加密货币' },
      es: { title: 'Paga y retira efectivo — 0% de comisión', subtitle: '22+ monedas fiduciarias · 70+ criptomonedas' },
      hi: { title: 'भुगतान करें और नकद निकालें — शुल्क 0%', subtitle: '22+ फ़िएट मुद्राएँ · 70+ क्रिप्टोकरेंसी' },
      ja: { title: 'お支払いと現金の引き出し — 手数料0%', subtitle: '22+ の法定通貨 · 70+種類の暗号資産' },
      ko: { title: '결제하고 현금을 인출하세요 — 수수료 0%', subtitle: '22+개 법정화폐 · 70+개 암호화폐' },
    };
    for (const code of LOCALES) {
      const sourceKeys = [...readLocale(code).matchAll(/^\s*'([^']+)':/gm)].map(match => match[1]);
      for (const key of AUTH_COMMUNITY_KEYS) {
        expect(sourceKeys.filter(sourceKey => sourceKey === key)).toHaveLength(1);
        expect(dicts[code][key]?.trim()).toBeTruthy();
        expect(dicts[code][key]).not.toMatch(/1[.,]2|million|миллион|млн|万|백만|लाख|18\+|30\+/i);
        expect(dicts[code][key]).not.toMatch(/[.!?。！？।]$/);
      }
      const feeParts = dicts[code]['authShell.communityTitle'].split(' — ');
      expect(feeParts).toHaveLength(2);
      expect(feeParts[0]).not.toMatch(/\d/);
      expect(feeParts[1]).not.toContain('VOLTEX');
      expect(feeParts[1]).toContain('0%');
      expect(dicts[code]['authShell.communityTitle'].match(/\d+%/g)).toEqual(['0%']);
      expect(dicts[code]['authShell.communityTitle']).toBe(approvedCommunityCopy[code].title);
      expect(dicts[code]['authShell.communitySubtitle']).toBe(approvedCommunityCopy[code].subtitle);
      expect(dicts[code]['authShell.communitySubtitle'].match(/\d+\+?/g)).toEqual(['22+', '70+']);
      expect(dicts[code]['authShell.communitySubtitle']).toContain(' · ');
    }
    for (const key of AUTH_COMMUNITY_KEYS) expect(new Set(LOCALES.map(code => dicts[code][key])).size).toBe(LOCALES.length);
    expect(dicts.ru['authShell.communityTitle']).toBe('Платите и снимайте наличные — 0% комиссии');
    expect(dicts.ru['authShell.communitySubtitle']).toBe('22+ фиатных валют · 70+ криптовалют');
  });
  it('clarifies that the displayed currency flags are a partial selection in all seven languages', () => {
    const approvedMoreCurrencies: Record<string, string> = {
      ru: 'и другие валюты',
      en: 'and more currencies',
      zh: '及更多货币',
      es: 'y otras monedas',
      hi: 'और अन्य मुद्राएँ',
      ja: 'その他の通貨にも対応',
      ko: '그 외 다양한 통화',
    };
    for (const code of LOCALES) {
      const sourceKeys = [...readLocale(code).matchAll(/^\s*'([^']+)':/gm)].map(match => match[1]);
      expect(sourceKeys.filter(key => key === 'authShell.moreCurrencies')).toHaveLength(1);
      expect(dicts[code]['authShell.moreCurrencies']).toBe(approvedMoreCurrencies[code]);
    }
  });
  it('provides every shared menu description in all seven languages', () => {
    for (const code of LOCALES) for (const key of menuDescriptionKeys) expect(dicts[code][key]?.trim()).toBeTruthy();
  });
  it('provides the approved auth design labels without removing validation, 2FA or legal copy', () => {
    for (const code of LOCALES) for (const key of APPROVED_AUTH_DESIGN_KEYS) expect(dicts[code][key]?.trim()).toBeTruthy();
    expect(dicts.ru['auth.email']).toBe('Электронная почта');
    expect(dicts.ru['register.email']).toBe('Электронная почта');
    expect(dicts.ru['auth.signIn']).toBe('Войти в аккаунт');
    // The unchanged auth constraints remain covered by the historical byte
    // digest below, rather than being exempted with a broad auth.* filter.
    expect(APPROVED_AUTH_DESIGN_KEYS).not.toContain('auth.twoFaHint');
    expect(APPROVED_AUTH_DESIGN_KEYS).not.toContain('register.legal.terms');
    expect(APPROVED_AUTH_DESIGN_KEYS).not.toContain('register.req.length');
  });
  it('localizes each decimal refusal in all seven languages', () => {
    for (const code of LOCALES) {
      expect(Object.keys(dicts[code]).filter(key => key.startsWith('futures.number')).sort()).toEqual([...decimalRefusalKeys].sort());
      for (const key of decimalRefusalKeys) expect(dicts[code][key].trim()).not.toBe('');
    }
    for (const key of decimalRefusalKeys) expect(new Set(LOCALES.map(code => dicts[code][key])).size).toBe(LOCALES.length);
  });
  it('localizes every added deposit UI key, preserving asset/network placeholders', () => {
    for (const code of LOCALES) {
      expect(Object.keys(dicts[code]).filter(key => key.startsWith('deposit.ui.')).sort()).toEqual([...depositUiKeys].sort());
      for (const key of depositUiKeys) expect(dicts[code][key].trim()).not.toBe('');
      for (const key of ['yourAddress', 'networkHint', 'qrLabel', 'minimumOtherValue']) expect(dicts[code][`deposit.ui.${key}`]).toContain('{asset}');
      expect(dicts[code]['deposit.ui.minimumOtherValue']).toContain('{amount}');
      expect(dicts[code]['deposit.ui.qrLabel']).toContain('{network}');
    }
    expect(dicts.ru['deposit.ui.minimumLabel']).toBe('Минимальная сумма пополнения');
  });
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
      // Auth-only exclusions above applied to trusted pre-redesign main
      // c08127baa837b5288bd0febc1ce2dc20212044aa using the same historical
      // normalization below. These are NOT fingerprints of the edited files.
      "ru": "4f4c8215ab910a41",
      "en": "34a0c9bee48a1a29",
      "zh": "24a649501eda9363",
      "es": "e3f86ceba8afd235",
      "hi": "c316b12cb92fa851",
      "ja": "6c8ed7766ec7c998",
      "ko": "7b25cde326cbbdbb"
};
    // 2026-09-26, the TradingView-style drawing panel: its tool, group,
    // section and object-toolbar names. `git diff --numstat` over the
    // locales directory reports `65 0` for every language — additions
    // only; the older `draw.*` strings are untouched and the TradingView
    // wording for five of them lives under new keys (`draw.cross`,
    // `draw.hray`, `draw.fibRetracement`, `draw.extendedLine`,
    // `draw.eraser`, plus the `draw.trendTools` group name).
    const drawingPanelKeys = [
          'draw.cross', 'draw.trendTools', 'draw.hray', 'draw.fibRetracement', 'draw.extendedLine', 'draw.eraser', 'draw.cursors', 'draw.cursorDot',
          'draw.cursorArrow', 'draw.infoline', 'draw.trendangle', 'draw.crossline', 'draw.channel', 'draw.fibGroup', 'draw.fibext', 'draw.pitchfork',
          'draw.patterns', 'draw.xabcd', 'draw.abcd', 'draw.trianglepattern', 'draw.headshoulders', 'draw.elliott', 'draw.forecast', 'draw.long',
          'draw.short', 'draw.pricerange', 'draw.daterange', 'draw.datepricerange', 'draw.shapesGroup', 'draw.highlighter', 'draw.arrow',
          'draw.arrowup', 'draw.arrowdown', 'draw.ellipse', 'draw.triangleshape', 'draw.polyline', 'draw.annotations', 'draw.note', 'draw.callout',
          'draw.pricelabel', 'draw.section.lines', 'draw.section.channels',
          'draw.section.fib', 'draw.section.pitchforks', 'draw.section.chartPatterns', 'draw.section.elliott', 'draw.section.projection',
          'draw.section.measurers', 'draw.section.brushes', 'draw.section.arrows', 'draw.section.shapes', 'draw.section.text', 'draw.objectToolbar',
          'draw.lineColor', 'draw.fillColor', 'draw.lineWidth', 'draw.lineStyle', 'draw.editText', 'draw.lockObject', 'draw.unlockObject',
          'draw.clone', 'draw.deleteObject', 'draw.dash.solid', 'draw.dash.dashed', 'draw.dash.dotted',
          // Ruler exact prices and its drag guide (owner, 2026-10-04): `git diff
          // --numstat` over the locales reports `7 0` per language, additions only.
          'draw.measureSettings', 'draw.priceFrom', 'draw.priceTo', 'draw.toCurrentPrice', 'draw.apply', 'draw.priceInvalid', 'draw.currentPrice'];
    for (const code of LOCALES) {
      for (const key of drawingPanelKeys) expect({ code, key, text: String(dicts[code][key] ?? '').trim() !== '' }).toEqual({ code, key, text: true });
    }
    // 2026-09-29, Copy Trading «Эффективность»: the period performance
    // block's labels, period names and holding-time units. `git diff
    // --numstat` over the locales directory reports `30 0` for every
    // language — additions only. ROI, P&L and USDT stay as written in every
    // language; asserted by name here so this re-take covers nothing else.
    const copyPerformanceKeys = ['title', 'windowRolling', 'windowAll', 'period.7D', 'period.30D', 'period.90D', 'period.ALL',
      'roi', 'masterPnl', 'followersPnl', 'winRate', 'maxDrawdown', 'averagePnl', 'profitFactor', 'tradesPerWeek', 'holdingTime',
      'volatility', 'sharpe', 'sortino', 'lastTrade', 'totalTrades', 'winningTrades', 'losingTrades', 'units', 'noLosingTrades',
      'noLosingDays', 'winRateNote', 'duration.days', 'duration.hours', 'duration.minutes'].map(key => `copyPerformance.${key}`);
    for (const code of LOCALES) {
      for (const key of copyPerformanceKeys) expect({ code, key, text: String(dicts[code][key] ?? '').trim() !== '' }).toEqual({ code, key, text: true });
      expect(dicts[code]['copyPerformance.roi']).toBe('ROI');
      expect(dicts[code]['copyPerformance.masterPnl']).toContain('P&L');
      expect(dicts[code]['copyPerformance.followersPnl']).toContain('P&L');
      expect(dicts[code]['copyPerformance.units']).toContain('USDT');
    }
    const previousVipCopy: Record<string, { label: string; title: string }> = {
      ru: { label: 'Super VIP', title: 'Статус Super VIP' },
      en: { label: 'Super VIP', title: 'Super VIP status' },
      es: { label: 'Super VIP', title: 'Estado Super VIP' },
      hi: { label: 'Super VIP', title: 'Super VIP स्थिति' },
      ja: { label: 'Super VIP', title: 'Super VIP ステータス' },
      ko: { label: 'Super VIP', title: 'Super VIP 등급' },
      zh: { label: 'Super VIP', title: 'Super VIP 状态' },
    };
    const approvedVipCopy: Record<string, { label: string; title: string }> = {
      ru: { label: 'Supreme VIP', title: 'Клиент Supreme VIP' },
      en: { label: 'Supreme VIP', title: 'Supreme VIP status' },
      es: { label: 'Supreme VIP', title: 'Estado Supreme VIP' },
      hi: { label: 'Supreme VIP', title: 'Supreme VIP स्थिति' },
      ja: { label: 'Supreme VIP', title: 'Supreme VIP ステータス' },
      ko: { label: 'Supreme VIP', title: 'Supreme VIP 등급' },
      zh: { label: 'Supreme VIP', title: 'Supreme VIP 状态' },
    };
    const { createHash } = require('crypto');
    for (const code of LOCALES) {
      const source = readLocale(code).split('\n').filter(line => {
        const key = line.match(/^\s*'([^']+)':/)?.[1];
        if (key && APPROVED_AUTH_DESIGN_KEYS.includes(key)) return false;
        if (key && AUTH_COMMUNITY_KEYS.includes(key)) return false;
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
        // `trade.assetNotTradingYet` and `listing.*` are the order form's
        // answer and the listing card for an upcoming listing (VOLTORA).
        // `support.form*` are the support form's result lines and address hint
        // (2026-09-26: support became a form answered by email).
        const addedSinceDigest = ['browserSleeping', 'browserSyncing', 'browserSyncError', 'browserContinue',
          'futures.positionLimits', 'futures.allMarkets', 'futures.openContract', 'futures.orderError.serverUnavailable',
          'futures.contractDetails', 'futures.contractExpiry', 'futures.contractPerpetual', 'futures.contractSettle', 'futures.contractMaxLeverage', 'futures.contractQtyStep', 'futures.contractMaxQty',
          'futures.hintValue', 'futures.hintMargin', 'futures.hintMark', 'futures.hintLiq', 'futures.hintUnrealized', 'futures.hintRealized',
          'trade.assetPurchaseUnavailable', 'trade.assetOrderTypeUnavailable',
          'markets.new', // Spot rail newest-listing sorter (2026-10-04), additive only.
          'deposit.transferCreditNote', // New manual-catalogue copy; preserve every existing dictionary byte.
          'trade.assetNotTradingYet', 'listing.untilStart', 'listing.days', 'listing.hours', 'listing.minutes', 'listing.seconds',
          'listing.initialPrice', 'listing.startTime', 'listing.newListing',
          'support.formSent', 'support.formSentHint', 'support.formFailed', 'support.formEmailHint', 'support.formCheck',
          // KYC edge (2026-09-26): the verification form's file-preparation
          // line and the edge's refusals; the existing KYC copy is unchanged.
          'settings.kycPreparingFile', 'settings.kycFileReady', 'settings.kycFileTooLarge', 'settings.kycFileType', 'settings.kycDeliveryFailed',
          // «Позиция закрыта» card after a market close (2026-10-01, owner chose variant B).
          'futures.closedTitle', 'futures.closedPrice', 'futures.closedDismiss',
          // Remembered-device sign-in (2026-10-03): additive auth/session copy.
          'settings.rememberedDevice',
          // Verification form, Profile verification action and VOLTEX Card
          // shortcut (owner bundle, 2026-10-04): `git diff --numstat` over the
          // locales reports `19 0` per language, additions only.
          ...KYC_PROFILE_CARD_KEYS,
          // Mobile terminal (2026-10-04): `git diff --numstat` over the
          // locales reports `6 0` per language, additions only.
          ...MOBILE_TERMINAL_KEYS,
          // Currency flag selection (2026-10-07): one additive label per language.
          'authShell.moreCurrencies',
          // Bybit 1:1 positions summary line (2026-10-07): `git diff --numstat` over the locales reports `3 0` per language.
          'futures.allPositions', 'futures.currentPositions', 'futures.totalPnl'];
        // `chart.settings.*` is the futures chart's settings dialog
        // (2026-09-30); every line before it is unchanged.
        if (key?.startsWith('chart.settings.')) return false;
        // The stock-only additions (19 for the review module, 56 for its
        // panel/overview UI) leave all older translations byte-identical.
        if (key?.startsWith('stocks.')) return false;
        // `otc.*` is the OTC page from the owner's OTC.zip (2026-09-30):
        // `git diff --numstat` over the locales directory reports `63 0` for
        // every language, additions only; asserted by name below.
        if (key?.startsWith('otc.')) return false;
        // `withdraw.*` is the withdrawal panel (2026-09-30): `git diff
        // --numstat` over the locales reports `31 0` per language; asserted
        // by name below. The older `wallet.withdraw*` lines are unchanged.
        if (key?.startsWith('withdraw.')) return false;
        // `academy.*`, `help.*`, `nav.academy` and `nav.help` are the Academy
        // and Help pages (2026-10-01): `git diff --numstat` over the locales
        // reports `56 0` per language, additions only. No key used either
        // prefix before them.
        if (key?.startsWith('academy.') || key?.startsWith('help.') || key === 'nav.academy' || key === 'nav.help') return false;
        // Owner-approved header destinations, added without changing existing copy.
        if (key === 'nav.tools' || key === 'nav.knowledgeCenter' || (key && menuDescriptionKeys.includes(key))) return false;
        return !key || (!decimalRefusalKeys.includes(key) && !depositUiKeys.includes(key) && !restoredEcosystemKeys.includes(key)
          && !addedSinceDigest.includes(key) && !drawingPanelKeys.includes(key) && !copyPerformanceKeys.includes(key));
      }).join('\n');
      expect(Object.keys(dicts[code]).filter(key => key.startsWith('stocks.'))).toHaveLength(19 + 56);
      expect(Object.entries(dicts[code]).filter(([key]) => key.startsWith('stocks.')).every(([, value]) => value.trim().length > 0)).toBe(true);
      expect(dicts[code]['trade.cfdUnavailable']).toBe(cfdCopyAfter[code]);
      // Added for the approved compact order-panel disclosure; older copy remains frozen.
      expect(dicts[code]['futures.positionLimits'].trim()).not.toBe('');
      expect(dicts[code]['nav.tools'].trim()).not.toBe('');
      expect(dicts[code]['nav.knowledgeCenter'].trim()).not.toBe('');
      expect(dicts[code]['settings.rememberedDevice'].trim()).not.toBe('');
      expect(dicts[code]['nav.card']).toBe(shortCardLabels[code]);
      expect(dicts[code]['wallet.superVip']).toBe(approvedVipCopy[code].label);
      expect(dicts[code]['wallet.superVipTitle']).toBe(approvedVipCopy[code].title);
      // Russian `futures.colMark` was shortened to «Цена марк.» (like «Цена
      // ликвид.») so every positions heading fits on one line at 1600; the
      // digest is taken over the original wording, restored here by name.
      const restored = source.replace("'trade.cfdUnavailable': '" + cfdCopyAfter[code] + "'", "'trade.cfdUnavailable': '" + cfdCopyBefore[code] + "'")
        // Reverse only the owner's exact short navigation label; product copy stays frozen.
        .replace("'nav.card': '" + shortCardLabels[code] + "'", "'nav.card': 'Crypto Card'")
        // Supreme VIP is the owner-approved Wallet label. Restore only those
        // two exact values for the historical dictionary digest so unrelated
        // translations remain byte-frozen.
        .replace("'wallet.superVip': '" + approvedVipCopy[code].label + "'", "'wallet.superVip': '" + previousVipCopy[code].label + "'")
        .replace("'wallet.superVipTitle': '" + approvedVipCopy[code].title + "'", "'wallet.superVipTitle': '" + previousVipCopy[code].title + "'")
        .replace(code === 'ru' ? "'futures.colMark': 'Цена марк.'" : '\u0000', "'futures.colMark': 'Цена маркировки'");
      const body = restored.slice(restored.indexOf('= {') + 2).replace(/\s*as const;\s*$/, '').replace(/;\s*$/, '');
      expect({ code, digest: createHash('sha256').update(body).digest('hex').slice(0, 16) })
        .toEqual({ code, digest: digests[code] });
    }
  });

  it('carries the OTC page copy in every language, the Russian word for word from OTC.zip', () => {
    const otcKeys = Object.keys(dicts.ru).filter(key => key.startsWith('otc.'));
    expect(otcKeys.length).toBe(63);
    for (const code of LOCALES) {
      for (const key of otcKeys) expect({ code, key, text: String(dicts[code][key] ?? '').trim() !== '' }).toEqual({ code, key, text: true });
      // The two placeholders the page fills must survive translation.
      expect(dicts[code]['otc.minFrom']).toContain('{amount}');
      expect(dicts[code]['otc.form.note']).toContain('{min}');
      expect(dicts[code]['otc.private.perDeal']).toContain('{min}');
    }
    expect(dicts.ru['otc.heroTitle']).toBe('Институциональная OTC-торговля');
    expect(dicts.ru['otc.form.submit']).toBe('Оставить заявку');
    expect(dicts.ru['otc.cash.p1Text']).toBe('Выберите страну получения из справочника — точная доступность подтверждается менеджером по заявке.');
    expect(new Set(LOCALES.map(code => dicts[code]['otc.heroTitle'])).size).toBe(LOCALES.length);
  });

  it('carries the withdrawal panel in every language, with its placeholders and the 60-minute promise', () => {
    const keys = Object.keys(dicts.ru).filter(key => key.startsWith('withdraw.'));
    expect(keys.length).toBe(31);
    for (const code of LOCALES) {
      for (const key of keys) expect({ code, key, text: String(dicts[code][key] ?? '').trim() !== '' }).toEqual({ code, key, text: true });
      expect(dicts[code]['withdraw.amountTooMuch']).toContain('{amount}');
      expect(dicts[code]['withdraw.amountTooMuch']).toContain('{asset}');
      expect(dicts[code]['withdraw.addressWrongNetwork']).toContain('{network}');
      expect(dicts[code]['withdraw.eta']).toContain('60');
      expect(dicts[code]['withdraw.doneEta']).toContain('60');
    }
    expect(dicts.ru['withdraw.eta']).toBe('Вывод может занимать до 60 минут.');
  });

  it('localizes the neutral manual-catalogue note without changing legacy deposit copy', () => {
    expect(dicts.ru['deposit.transferCreditNote']).toBe('После перевода средства будут зачислены на ваш аккаунт.');
    const values = LOCALES.map(code => dicts[code]['deposit.transferCreditNote'].trim());
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values).size).toBe(LOCALES.length);
  });

  it('localizes both explicit VTA operation refusals without changing existing copy', () => {
    expect(dicts.ru['trade.assetPurchaseUnavailable']).toBe('Покупка этого актива недоступна.');
    expect(dicts.ru['trade.assetOrderTypeUnavailable']).toBe('Этот тип ордера для данного актива недоступен.');
    for (const key of ['trade.assetPurchaseUnavailable', 'trade.assetOrderTypeUnavailable']) {
      const values = LOCALES.map(code => dicts[code][key].trim());
      expect(values.every(Boolean)).toBe(true);
      expect(new Set(values).size).toBe(LOCALES.length);
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
