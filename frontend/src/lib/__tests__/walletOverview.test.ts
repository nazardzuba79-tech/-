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
 *   4. profit by period is the server's own `periods[p]`, dash when the
 *      window is unavailable, and the P&L pill is labelled 7D;
 *   5. the accounts card reports the Cross ledger as already counted and
 *      adds nothing up itself;
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

const i18n = { useLanguage: () => ({ lang: 'ru', t: (k: string) => k }) };
const icons = new Proxy({}, { get: (_t, name) => () => React.createElement('svg', { 'data-icon': String(name) }) });
const stub = (name: string) => (props: Record<string, unknown>) =>
  React.createElement('div', { 'data-stub': name, 'data-props': JSON.stringify(Object.keys(props)) });

const PERIODS = ['7d', '30d', '90d', '1y', 'all'];

function overviewModule() {
  const { TierBadge } = evaluate(wallet + 'TierBadge.tsx', { 'lucide-react': icons, '../../lib/i18n': i18n });
  const { PerformancePeriods } = evaluate(wallet + 'PerformancePeriods.tsx', {
    '../../lib/i18n': i18n, './format': fmt, './useWalletData': { PERFORMANCE_PERIODS: PERIODS },
  });
  return evaluate(wallet + 'WalletOverview.tsx', {
    'lucide-react': icons,
    '../../lib/i18n': i18n,
    './format': fmt,
    './TierBadge': { TierBadge },
    './PerformancePeriods': { PerformancePeriods },
    './EquityChart': { EquityChart: stub('EquityChart') },
    './PortfolioAllocation': { PortfolioAllocation: stub('PortfolioAllocation') },
    './RecentActivity': { RecentActivity: stub('RecentActivity') },
    './useWalletData': { PERFORMANCE_PERIODS: PERIODS },
  });
}

const noop = () => {};
const base = {
  rows: [], performanceState: 'ok', hidden: false, onToggleHidden: noop, unavailable: false, loading: false,
  onDeposit: noop, onWithdraw: noop, onTransfer: noop, onHistory: noop, onOpenUnified: noop, onOpenFunding: noop,
};

const period = (available: boolean, absolutePnl: number | null = null, percent: number | null = null) => ({
  period: '', available, startDate: available ? '2026-09-10' : null, endDate: available ? '2026-09-17' : null,
  startEquity: null, endEquity: null, absolutePnl, percent, points: [],
});
const noHistory = { periods: Object.fromEntries(PERIODS.map((p) => [p, period(false)])), ageDays: 0, startedOn: null };

const CROSS = {
  mode: 'CROSS', collateralUsd: 1000000, totalEquityUsd: 1000250.5, availableUsd: 900000, unrealizedPnlUsd: 250.5,
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
const plain = (markup: string) => markup.replace(/[\u00a0\u202f]/g, ' ');
const html = (props: Record<string, unknown>) => plain(renderToStaticMarkup(overviewModule().WalletOverview({ ...base, ...props } as any)));

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
    // Total, funding and unified are all a server-answered 0 — a fact, not
    // an unknown — so they read $0,00 and never a dash.
    expect(out.match(/\$0,00/g)?.length).toBe(3);
    expect(out).toContain('0 BTC');
  });

  it('shows a dash for every window the account has no history for', () => {
    expect(out).toContain('data-available="false"');
    expect(out).not.toContain('data-available="true"');
    for (const p of PERIODS) expect(out).toContain(`data-period="${p}"`);
    // The 7D pill too.
    expect(out).toMatch(/wallet\.pnlSeven<\/span><span class="wallet-overview-pnl-pill num text-ink-4" data-available="false">—</);
  });

  it('keeps every card of the layout: accounts, distribution, dynamics, activity', () => {
    for (const stubbed of ['EquityChart', 'PortfolioAllocation', 'RecentActivity']) expect(out).toContain(`data-stub="${stubbed}"`);
    expect(out).toContain('wallet.accountsTitle');
    expect(out).toContain('wallet.navFunding');
    expect(out).toContain('wallet.navUnified');
    // And no Cross-only note on a plain ledger.
    expect(out).not.toContain('wallet.accountUnifiedPool');
    expect(out).not.toContain('wallet.accountCounted');
  });
});

describe('3. no answer yet means no figure', () => {
  it('renders dashes and no dollar amount before the account resolves', () => {
    const out = html({ account: null, overview: null, performance: null, btcEquivalent: null });
    expect(out).not.toMatch(/\$\d/);
    expect(out).toContain('— BTC');
    expect((out.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(3 + 1 + 5 * 2);
  });

  it('renders dashes, not zeros, when the ledger failed and no account answered', () => {
    const out = html({ account: EMPTY_SPOT, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 0, unavailable: true });
    expect(out).not.toContain('$0,00');
  });
});

describe('4. profit by period is the server’s own answer', () => {
  it('prints absolutePnl and percent per window and labels the pill 7D', () => {
    const performance = {
      periods: {
        '7d': period(true, 1248.1, 0.05), '30d': period(true, -3200, -0.31), '90d': period(false), '1y': period(false), all: period(true, 25000.25, 2.5),
      },
      ageDays: 200, startedOn: '2026-03-01',
    };
    const out = html({ account: CROSS, overview: EMPTY_OVERVIEW, performance, btcEquivalent: 10 });
    expect(out).toContain('+$1 248,10');
    expect(out).toContain('+0,05%');
    expect(out).toContain('-$3 200,00');
    expect(out).toContain('-0,31%');
    expect(out).toContain('+$25 000,25');
    expect(out).toContain('+2,50%');
    expect(out).toContain('data-period="90d" data-available="false"');
    expect(out).toContain('data-period="1y" data-available="false"');
    // The headline pill is the 7D window, said in its label, USD + percent.
    expect(out).toContain('wallet.pnlSeven');
    expect(out).toMatch(/data-available="true">\+\$1 248,10 · \+0,05%</);
    // Nothing rendered calls anything "today" (the comments explain why not).
    const code = read(wallet + 'WalletOverview.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/today|сегодня/i);
  });

  it('computes no P&L of its own', () => {
    for (const file of ['WalletOverview.tsx', 'PerformancePeriods.tsx', 'TierBadge.tsx', 'FundingView.tsx']) {
      const source = read(wallet + file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(`${file}: ${/absolutePnl\s*[-+*/]|percent\s*[-+*/]|totalEquityUsd\s*[-+*/]|spotValueUsd\s*[-+*/]/.test(source)}`).toBe(`${file}: false`);
      expect(`${file}: ${/\bfetch\(|\bapi\./.test(source)}`).toBe(`${file}: false`);
    }
  });
});

describe('5. the accounts card on a Cross account', () => {
  it('reports the funding ledger as already counted and never sums the two', () => {
    const overview = { ...EMPTY_OVERVIEW, real: { ...EMPTY_OVERVIEW.real, spotValueUsd: 230701, totalValueUsd: 230701 } };
    const out = html({ account: CROSS, overview, performance: noHistory, btcEquivalent: 10 });
    expect(out).toContain('$230 701,00');
    expect(out).toContain('$1 000 250,50');
    expect(out).toContain('wallet.accountCounted');
    expect(out).toContain('wallet.accountUnifiedPool');
    // The headline is the account's equity, exactly — not equity + funding.
    expect(out).not.toContain('$1 230 951,50');
  });

  it('masks every figure behind the eye toggle', () => {
    const out = html({ account: CROSS, overview: EMPTY_OVERVIEW, performance: noHistory, btcEquivalent: 10, hidden: true });
    expect(out).not.toMatch(/\$\d/);
    expect(out).toContain(fmt.MASK);
  });
});

describe('6. the labels exist in every locale', () => {
  const keys = [
    'wallet.brandTagline', 'wallet.navAnalysis', 'wallet.cardLinkTitle', 'wallet.overviewTitle', 'wallet.pnlSeven',
    'wallet.accountsTitle', 'wallet.accountCounted', 'wallet.accountUnifiedPool', 'wallet.periodsTitle',
    'wallet.recentActivity', 'wallet.allActivity', 'wallet.noActivity', 'wallet.superVip', 'wallet.superVipTitle',
    'wallet.fundingSubtitle', 'wallet.openDetails',
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
  });
});

describe('7. the funding view', () => {
  function fundingHtml(props: Record<string, unknown>) {
    const { FundingView } = evaluate(wallet + 'FundingView.tsx', {
      'lucide-react': icons,
      '../../lib/i18n': i18n,
      './format': fmt,
      './ui': { EmptyState: stub('EmptyState') },
      '../../components/CryptoIcon': { CryptoIcon: () => React.createElement('i') },
    });
    return plain(renderToStaticMarkup(FundingView({ hidden: false, unavailable: false, loading: false, onDeposit: noop, onWithdraw: noop, onTransfer: noop, ...props } as any)));
  }

  it('is empty — a deposit action and nothing else — for an account with nothing', () => {
    const out = fundingHtml({ account: EMPTY_SPOT, overview: EMPTY_OVERVIEW });
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
    const out = fundingHtml({ account: CROSS, overview });
    expect(out).toContain('data-asset="USDT"');
    expect(out).toContain('data-asset="EUR"');
    expect(out).not.toContain('data-asset="XRP"');
    expect(out).toContain('$230 701,00');
    expect(out).toMatch(/data-asset="EUR"[\s\S]*?—<\/td>/);
    expect(out).toContain('wallet.accountUnifiedPool');
  });
});
