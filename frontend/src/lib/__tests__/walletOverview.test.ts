import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * THE OVERVIEW: the approved design, for every account, on that account's
 * own figures.
 *
 *   1. the Super VIP mark belongs to the owner's Cross account and to no
 *      other — an ordinary ledger gets no tier badge at all;
 *   2. an empty ordinary account renders the same layout with real zeros
 *      where the server said zero and dashes where it said nothing;
 *   3. a page with no answer yet shows no dollar figure anywhere;
 *   4. the two accounts are two ledgers: the headline is their sum and
 *      nothing else is added up on the page;
 *   5. profit by period is the server's own `periods[p]`, dash when the
 *      window is unavailable, and the P&L pill is labelled 7D;
 *   6. every new label exists in all seven locales.
 */

const root = resolve(__dirname, '../../../..');
const frontend = resolve(root, 'frontend');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const wallet = 'frontend/src/pages/wallet-v3/';

function evaluate(file: string, imports: Record<string, unknown> = {}) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) => (name.endsWith('.css') ? {} : imports[name] ?? req(name)));
  return output;
}

const fmt = (() => {
  const code = ts.transpileModule(read(wallet + 'format.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const out: Record<string, any> = {};
  new Function('exports', 'require', code)(out, () => ({ localeOf: () => 'ru' }));
  return out;
})();

const i18n = { useLanguage: () => ({ lang: 'ru', t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${Object.values(p).join(',')})` : k) }) };
const icons = new Proxy({}, { get: (_t, name) => () => React.createElement('svg', { 'data-icon': String(name) }) });
const stub = (name: string) => (props: Record<string, unknown>) =>
  React.createElement('div', { 'data-stub': name, 'data-props': JSON.stringify(props, (_k, v) => (typeof v === 'function' ? undefined : v)) });

const PERIODS = ['7d', '30d', '90d', '1y', 'all'];
const noop = () => {};

/** Hooks that run synchronously, so the card's effects fire as a mount would. */
function hooks() {
  const state: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  const h = {
    ...React,
    useState(initial: any) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
    useMemo: (factory: () => any) => factory(),
    useEffect: (run: () => void) => { effects.push(run); },
    useId: () => 'gradient',
  };
  return { h, reset: () => { cursor = 0; effects.length = 0; }, effects };
}

function overviewModule() {
  const { TierBadge } = evaluate(wallet + 'TierBadge.tsx', { 'lucide-react': icons, '../../lib/i18n': i18n });
  return evaluate(wallet + 'WalletOverview.tsx', {
    react: { ...React, useState: (i: any) => [i, noop], useMemo: (f: () => any) => f() },
    'lucide-react': icons,
    '../../lib/i18n': i18n,
    './format': fmt,
    './TierBadge': { TierBadge },
    './AllocationCard': { AllocationCard: stub('AllocationCard') },
    './DynamicsCard': { DynamicsCard: stub('DynamicsCard') },
    './RecentActivity': { RecentActivity: stub('RecentActivity') },
    '../../components/CryptoIcon': { CryptoIcon: () => React.createElement('i') },
  });
}

const base = {
  rows: [], performanceState: 'ok', hidden: false, onToggleHidden: noop, unavailable: false, loading: false,
  onDeposit: noop, onWithdraw: noop, onTransfer: noop, onHistory: noop, onOpenUnified: noop, onOpenFunding: noop, onOpenPnl: noop,
};
const period = (available: boolean, absolutePnl: number | null = null, percent: number | null = null) => ({
  period: '', available, startDate: available ? '2026-09-10' : null, endDate: available ? '2026-09-17' : null,
  startEquity: null, endEquity: null, absolutePnl, percent, points: available ? [{ date: '2026-09-10', equity: 1 }, { date: '2026-09-17', equity: 2 }] : [],
});
const noHistory = { periods: Object.fromEntries(PERIODS.map((p) => [p, period(false)])), ageDays: 0, startedOn: null };

const CROSS = {
  mode: 'CROSS', collateralUsd: 1000000, walletEquityUsd: 1000250.5, totalEquityUsd: 1000250.5, availableUsd: 900000, unrealizedPnlUsd: 250.5,
  initialMarginUsd: 356.89, maintenanceMarginUsd: 66.81, orderReserveUsd: 0, initialMarginRatio: 0.0005,
  maintenanceMarginRatio: 0.00006, spotUsd: null, futuresUsd: null, valuationComplete: true, unpricedAssets: [], settleAsset: 'USDT',
};
const EMPTY_SPOT = {
  mode: 'SPOT', collateralUsd: 0, totalEquityUsd: 0, availableUsd: null, unrealizedPnlUsd: null, initialMarginUsd: null,
  maintenanceMarginUsd: null, orderReserveUsd: null, initialMarginRatio: null, maintenanceMarginRatio: null,
  spotUsd: 0, futuresUsd: 0, valuationComplete: true, unpricedAssets: [], settleAsset: 'USDT',
};
const EMPTY_OVERVIEW = { real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 }, valuationComplete: true, unpricedAssets: [], btcPriceUsd: 100000 };

/** The locale groups thousands with a narrow no-break space; the assertions read it as a plain one. */
const plain = (markup: string) => markup.replace(/[  ]/g, ' ');
const html = (props: Record<string, unknown>) => plain(renderToStaticMarkup(overviewModule().WalletOverview({ ...base, ...props } as any)));
const headline = (out: string) => /class="num wallet-overview-amount">([^<]*)</.exec(out)![1];

describe('1. the Super VIP mark', () => {
  it('is on the owner Cross account, with its crown', () => {
    const out = html({ account: CROSS, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 10.0025 });
    expect(out).toContain('data-tier="super-vip"');
    expect(out).toContain('wallet.superVip');
    expect(out).toContain('data-icon="CrownIcon"');
  });

  it('is on NO other account — an ordinary ledger has no tier and gets no badge', () => {
    const spot = html({ account: EMPTY_SPOT, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 0 });
    expect(spot).not.toContain('data-tier=');
    expect(spot).not.toContain('wallet.superVip');
    const unknown = html({ account: null, overview: null, performance: null, btcEquivalent: null });
    expect(unknown).not.toContain('data-tier=');
  });

  it('is decided by the account mode alone — no user, e-mail or role is read', () => {
    const source = read(wallet + 'TierBadge.tsx');
    expect(source).toContain("mode !== 'CROSS') return null");
    expect(source).not.toMatch(/email|role|isAdmin|userId|localStorage/i);
  });
});

describe('2. an empty ordinary account gets the same design, with nothing in it', () => {
  const out = html({ account: EMPTY_SPOT, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 0 });

  it('renders the real zeros the server answered, as zeros', () => {
    // The headline, funding and unified are all a server-answered 0 — a
    // fact, not an unknown — so they read as 0,00 and never as a dash.
    expect(headline(out)).toBe('0,00');
    expect(out.match(/\$0,00/g)?.length).toBe(2);
    expect(out).toContain('≈ 0 BTC');
  });

  it('shows a dash for the 7D pill when the account has no history', () => {
    expect(out).toMatch(/wallet\.pnlSeven<\/span><span class="wallet-pill num text-ink-4" data-available="false">—</);
  });

  it('keeps every card of the layout: accounts, distribution, dynamics, activity', () => {
    for (const stubbed of ['AllocationCard', 'DynamicsCard', 'RecentActivity']) expect(out).toContain(`data-stub="${stubbed}"`);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('wallet.tabAccount');
    expect(out).toContain('wallet.navFunding');
    expect(out).toContain('wallet.navUnified');
  });
});

describe('3. no answer yet means no figure', () => {
  it('renders dashes and no dollar amount before the account resolves', () => {
    const out = html({ account: null, overview: null, performance: null, btcEquivalent: null });
    expect(out).not.toMatch(/\$\d/);
    expect(headline(out)).toBe('—');
    expect(out).toContain('≈ — BTC');
  });

  it('renders dashes, not zeros, when the ledger failed and no account answered', () => {
    const out = html({ account: EMPTY_SPOT, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 0, unavailable: true });
    expect(out).not.toContain('0,00');
    expect(headline(out)).toBe('—');
  });
});

describe('4. two accounts, two ledgers', () => {
  const overview = { ...EMPTY_OVERVIEW, real: { ...EMPTY_OVERVIEW.real, spotValueUsd: 230701, totalValueUsd: 230701 } };

  it('lists each account with the server’s own figure and sums them once, in the headline', () => {
    const out = html({ account: CROSS, overview, performance: noHistory, btcEquivalent: 10.002505 });
    expect(out).toContain('$230 701,00');
    expect(out).toContain('$1 000 250,50');
    expect(headline(out)).toBe('1 230 951,50');
    // The BTC mark is the one the hook divided the equity by, so the
    // Overview cannot disagree with the Unified section: 1 000 250,5 / 10,002505 = 100 000.
    expect(out).toContain('≈ 12,309515 BTC');
    expect(out).toContain('≈ 10,002505 BTC');
    expect(out).toContain('≈ 2,30701 BTC');
  });

  it('adds nothing else: the account rows and the ring get the server figures unchanged', () => {
    const out = html({ account: CROSS, overview, performance: noHistory, btcEquivalent: 10.0025 });
    const ring = /data-stub="AllocationCard" data-props="([^"]*)"/.exec(out)![1].replace(/&quot;/g, '"');
    expect(JSON.parse(ring).accounts).toEqual([
      { label: 'wallet.navUnified', valueUsd: 1000250.5 },
      { label: 'wallet.navFunding', valueUsd: 230701 },
    ]);
    const source = read(wallet + 'WalletOverview.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // One sum, of the two ledgers, and no P&L or ratio arithmetic anywhere.
    expect(source.split('(fundingUsd ?? 0) + (unifiedUsd ?? 0)')).toHaveLength(2);
    expect(source).not.toMatch(/absolutePnl\s*[-+*/]|percent\s*[-+*/]|\bfetch\(|\bapi\./);
  });

  it('the Asset tab lists every holding with the account it sits in, never merged', () => {
    const rows = [{ symbol: 'USDT', name: 'Tether', total: 5, walletBalance: 5, available: 5, locked: 0, priceUsd: 1, changePercent24h: 0, valueUsd: 5, spendable: false, priced: true }];
    const withSpot = { ...overview, real: { ...overview.real, spot: [{ asset: 'USDT', available: '230701', locked: '0', priceUsd: 1, valueUsd: 230701 }] } };
    const mod = overviewModule();
    // Force the Asset tab open.
    const withTab = evaluate(wallet + 'WalletOverview.tsx', {
      react: { ...React, useState: (i: any) => [i === 'account' ? 'asset' : i, noop], useMemo: (f: () => any) => f() },
      'lucide-react': icons, '../../lib/i18n': i18n, './format': fmt,
      './TierBadge': mod.TierBadge ? { TierBadge: mod.TierBadge } : { TierBadge: () => null },
      './AllocationCard': { AllocationCard: stub('AllocationCard') }, './DynamicsCard': { DynamicsCard: stub('DynamicsCard') },
      './RecentActivity': { RecentActivity: stub('RecentActivity') }, '../../components/CryptoIcon': { CryptoIcon: () => React.createElement('i') },
    });
    const out = plain(renderToStaticMarkup(withTab.WalletOverview({ ...base, account: CROSS, overview: withSpot, rows, performance: noHistory, btcEquivalent: 10 } as any)));
    expect(out.match(/data-symbol="USDT"/g)).toHaveLength(2);
    expect(out).toContain('wallet.navUnified');
    expect(out).toContain('wallet.navFunding');
    expect(out).toContain('≈ 230 701,00 USD');
    expect(out).toContain('≈ 5,00 USD');
    expect(out).not.toContain('230 706');
  });

  it('masks every figure behind the eye toggle', () => {
    const out = html({ account: CROSS, overview, performance: noHistory, btcEquivalent: 10, hidden: true });
    expect(out).not.toMatch(/\$\d|\d BTC/);
    expect(out).toContain(fmt.MASK);
  });
});

describe('5. profit by period is the server’s own answer', () => {
  function dynamics(performance: any, extra: Record<string, unknown> = {}) {
    const hk = hooks();
    const { DynamicsCard } = evaluate(wallet + 'DynamicsCard.tsx', {
      react: hk.h, 'lucide-react': icons, '../../lib/i18n': i18n, './format': fmt, './useWalletData': { PERFORMANCE_PERIODS: PERIODS },
    });
    const props = { performance, loading: false, unavailable: false, hidden: false, ...extra };
    const render = () => { hk.reset(); return DynamicsCard(props as any); };
    render();
    for (const run of hk.effects) run();
    return plain(renderToStaticMarkup(render()));
  }

  it('prints absolutePnl and percent per window, dashes for windows the history cannot cover', () => {
    const performance = {
      periods: { '7d': period(true, 1248.1, 0.05), '30d': period(true, -3200, -0.31), '90d': period(false), '1y': period(false), all: period(true, 25000.25, 2.5) },
      ageDays: 200, startedOn: '2026-03-01',
    };
    const out = dynamics(performance);
    expect(out).toContain('+$1 248,10');
    expect(out).toContain('+0,05%');
    expect(out).toContain('-$3 200,00');
    expect(out).toContain('-0,31%');
    expect(out).toContain('+$25 000,25');
    expect(out).toContain('+2,50%');
    expect(out).toContain('data-period="90d" data-available="false"');
    expect(out.match(/class="wallet-period-row"/g)).toHaveLength(4);
    // Opens on 7D — the first window the account can answer — and draws it.
    expect(out).toContain('data-period="7d" data-available="true" aria-pressed="true"');
    expect(out).toContain('stroke="var(--w-gold)"');
    expect(out).toContain('10.09 — 17.09.2026');
    expect(out).toContain('wallet.updatedOn(2026-09-17)');
  });

  it('keeps its card, all dashes, for an account with no history — nothing is drawn', () => {
    const out = dynamics(noHistory);
    expect(out.match(/data-available="false"/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).not.toContain('<path d="M');
    expect(out).toContain('wallet.chartNoHistory');
    expect(out).not.toMatch(/[+-]\$\d/);
  });

  it('labels the headline pill 7D and never calls anything "today"', () => {
    const performance = { ...noHistory, periods: { ...noHistory.periods, '7d': period(true, 1248.1, 0.05) } };
    const out = html({ account: CROSS, overview: EMPTY_OVERVIEW, performance, btcEquivalent: 10 });
    expect(out).toContain('wallet.pnlSeven');
    expect(out).toMatch(/data-available="true">\+\$1 248,10 · \+0,05%</);
    for (const file of ['WalletOverview.tsx', 'DynamicsCard.tsx', 'AllocationCard.tsx', 'FundingView.tsx']) {
      const code = read(wallet + file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(`${file}: ${/today|сегодня/i.test(code)}`).toBe(`${file}: false`);
      expect(`${file}: ${/\bfetch\(|\bapi\./.test(code)}`).toBe(`${file}: false`);
    }
  });
});

describe('6. the labels exist in every locale', () => {
  const keys = [
    'wallet.brandTagline', 'wallet.navAnalysis', 'wallet.cardLinkTitle', 'wallet.overviewTitle', 'wallet.pnlSeven',
    'wallet.accountsTitle', 'wallet.recentActivity', 'wallet.allActivity', 'wallet.noActivity', 'wallet.superVip', 'wallet.superVipTitle',
    'wallet.fundingSubtitle', 'wallet.openDetails', 'wallet.depositShort', 'wallet.borrow', 'wallet.borrowUnavailable', 'wallet.tabAccount',
    'wallet.tabAsset', 'wallet.allocationSub', 'wallet.dynamicsSub', 'wallet.profitForPeriod', 'wallet.periodAllShort', 'wallet.updatedOn',
    'wallet.valuationFull', 'wallet.valuationFullShort', 'wallet.hideSmallUsd', 'wallet.colCurrency', 'wallet.colAsCollateral',
    'wallet.collateralLocked', 'wallet.colAction', 'wallet.unrealizedPnlLong', 'wallet.assetsCount',
  ];
  it.each(['ru', 'en', 'es', 'hi', 'ja', 'ko', 'zh'])('%s', (lang) => {
    const dictionary = read(`frontend/src/lib/i18n/locales/${lang}.ts`);
    for (const key of keys) expect(`${lang} ${key}: ${dictionary.includes(`'${key}':`)}`).toBe(`${lang} ${key}: true`);
  });

  it('names the sections as the owner asked: Unified Trading, P&L Analysis, Orders — the rest in Russian', () => {
    const ru = read('frontend/src/lib/i18n/locales/ru.ts');
    expect(ru).toContain("'wallet.navUnified': 'Unified Trading'");
    expect(ru).toContain("'wallet.navPnl': 'P&L Analysis'");
    expect(ru).toContain("'wallet.navOrders': 'Orders'");
    expect(ru).toContain("'wallet.navOverview': 'Обзор'");
    expect(ru).toContain("'wallet.navFunding': 'Финансирование'");
    expect(ru).toContain("'wallet.equityChart': 'Динамика активов'");
    expect(ru).toContain("'wallet.depositShort': 'Внести'");
  });
});

describe('7. the funding view', () => {
  function fundingHtml(props: Record<string, unknown>) {
    const { FundingView } = evaluate(wallet + 'FundingView.tsx', {
      'lucide-react': icons, '../../lib/i18n': i18n, './format': fmt,
      './ui': { EmptyState: stub('EmptyState') }, '../../components/CryptoIcon': { CryptoIcon: () => React.createElement('i') },
    });
    return plain(renderToStaticMarkup(FundingView({ hidden: false, unavailable: false, loading: false, onDeposit: noop, onWithdraw: noop, onTransfer: noop, ...props } as any)));
  }

  it('is empty — a deposit action and nothing else — for an account with nothing', () => {
    const out = fundingHtml({ overview: EMPTY_OVERVIEW });
    expect(out).toContain('data-stub="EmptyState"');
    expect(out).toContain('$0,00');
    expect(out).not.toContain('<table');
  });

  it('lists the spot ledger rows with the server valuation, dash for an unpriced one', () => {
    const overview = {
      ...EMPTY_OVERVIEW,
      real: {
        ...EMPTY_OVERVIEW.real,
        spot: [
          { asset: 'USDT', available: '230701', locked: '0', priceUsd: 1, valueUsd: 230701 },
          { asset: 'EUR', available: '792547', locked: '0', priceUsd: null, valueUsd: null },
          { asset: 'XRP', available: '0', locked: '0', priceUsd: 1.2, valueUsd: 0 },
        ],
        spotValueUsd: 230701,
      },
    };
    const out = fundingHtml({ overview });
    expect(out).toContain('data-asset="USDT"');
    expect(out).toContain('data-asset="EUR"');
    expect(out).not.toContain('data-asset="XRP"');
    expect(out).toContain('$230 701,00');
    expect(out).toMatch(/data-asset="EUR"[\s\S]*?—<\/td>/);
  });
});

describe('8. the workspace chrome: gauges, full bleed, and the theme switch', () => {
  const css = () => read(wallet + 'wallet.css');

  it('draws the IM/MM gauge — the rule whose loss turned them into blank labels', () => {
    // REGRESSION GUARD. `.wallet-im-bar` renders as a bare span: without a
    // height and a track colour it is invisible, and IM/MM read as dead
    // text beside a gap. That is exactly how they shipped once.
    const source = css();
    const rule = source.slice(source.indexOf('.vx-wallet .wallet-im-bar {'), source.indexOf('.vx-wallet .wallet-margin-pct'));
    expect(rule).toMatch(/height:\s*\d+px/);
    expect(rule).toMatch(/background:\s*var\(--w-panel-3\)/);
    // The fill is the server's ratio; a zero still shows where it starts.
    expect(rule).toContain(".vx-wallet .wallet-im-bar[data-empty='true']::before");
    expect(rule).toMatch(/\.wallet-im-bar > span \{[^}]*background: var\(--w-pos\)/s);
  });

  it('says whether a zero margin is "nothing committed" or "unknown"', () => {
    const source = read(wallet + 'PortfolioStrip.tsx');
    // Idle is decided by the SERVER's own figures — no margin in use on an
    // account that has equity — never by guessing at position counts.
    expect(source).toContain("account!.initialMarginUsd === 0 && (account!.totalEquityUsd ?? 0) > 0");
    expect(source).toContain("t('wallet.noOpenPositions')");
    expect(source).toContain('to="/futures"');
  });

  it('is full bleed: no page heading, no centred column', () => {
    const page = read('frontend/src/pages/WalletPage.tsx');
    // The rail's wordmark is the title now, so the duplicate heading is gone.
    expect(page).not.toMatch(/<h1/);
    expect(page).not.toContain('max-w-[1560px]');
    expect(page).not.toContain('mx-auto');
    expect(page).toContain('<div className="wallet-content min-w-0">');
    const nav = read(wallet + 'WalletSideNav.tsx');
    expect(nav).toContain('<div className="wallet-brand">');
    expect(nav).not.toContain('wallet-brand hidden');
    expect(css()).toMatch(/\.vx-wallet \.wallet-workspace \{\s*[^}]*padding: 0;/);
  });

  it('themes both roots from one stored choice, and never sniffs the OS', () => {
    const hook = read(wallet + 'useWalletTheme.ts');
    const code = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // A reader who put the ledger in dark gets it dark next visit, whatever
    // their laptop is doing — so the preference is stored, not inferred.
    // (The comment above the hook explains that; the CODE must not read it.)
    expect(code).not.toContain('prefers-color-scheme');
    expect(code).toContain('localStorage.setItem');
    expect(code).toContain('root.removeAttribute(ATTRIBUTE)');
    const source = css();
    // One attribute reaches the page AND the portalled dialogs.
    expect(source).toContain(".vx-wallet:where([data-wallet-theme='dark'] *)");
    expect(source).toContain(".vx-wallet-modal-root:where([data-wallet-theme='dark'] *)");
    // The dark block comes after the light one, or it would never win.
    expect(source.indexOf("[data-wallet-theme='dark']")).toBeGreaterThan(source.indexOf('--w-base: #f5f7fa'));
    // It retunes tokens only — no component rule is duplicated for dark.
    const dark = source.slice(source.indexOf(".vx-wallet:where([data-wallet-theme='dark'] *)"));
    const block = dark.slice(0, dark.indexOf('}'));
    for (const token of ['--w-base', '--w-panel', '--w-ink', '--w-hair', '--w-gold', '--w-pos', '--w-neg']) {
      expect(`dark ${token}: ${block.includes(token)}`).toBe(`dark ${token}: true`);
    }
  });

  it.each(['ru', 'en', 'es', 'hi', 'ja', 'ko', 'zh'])('%s names the theme switch and the idle state', (lang) => {
    const dictionary = read(`frontend/src/lib/i18n/locales/${lang}.ts`);
    for (const key of ['wallet.themeDark', 'wallet.themeLight', 'wallet.themeToggle', 'wallet.noOpenPositions']) {
      expect(`${lang} ${key}: ${dictionary.includes(`'${key}':`)}`).toBe(`${lang} ${key}: true`);
    }
  });
});
