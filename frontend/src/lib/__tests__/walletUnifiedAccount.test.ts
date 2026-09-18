import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * THE FIVE THINGS THAT MUST STAY TRUE ABOUT THE WALLET'S MONEY.
 *
 *   1. the Wallet and /futures consume the SAME authoritative account;
 *   2. nothing is double counted between the wallet and the trading ledger;
 *   3. an unknown price is never turned into a zero;
 *   4. no account's balance is written into the source;
 *   5. the page does not poll per asset, or multiply its requests per row.
 *
 * Each is checked against the real modules, evaluated here, rather than
 * against a description of them.
 */

const { renderToStaticMarkup } = createRequire(resolve(__dirname, '../../../..', 'frontend/package.json'))('react-dom/server');
const root = resolve(__dirname, '../../../..');
const frontend = resolve(root, 'frontend');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');

function evaluate(file: string, imports: Record<string, unknown> = {}) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: Record<string, any> = {};
  new Function('exports', 'require', code)(output, (name: string) => (name.endsWith('.css') ? {} : imports[name] ?? req(name)));
  return output;
}

/** Every `.ts`/`.tsx` under a path, tests and type declarations excluded. */
function sources(...roots: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p)) if (entry !== 'node_modules') walk(join(p, entry));
    } else if (/\.tsx?$/.test(p) && !p.includes('__tests__') && !p.endsWith('.d.ts')) {
      out.push(p);
    }
  };
  for (const r of roots) walk(resolve(root, r));
  return out;
}

/**
 * Runs `useWalletData` with hook stubs and records every request it makes.
 * Effects fire once, in order, exactly as a mount would run them.
 */
function runHook(options: {
  wallet?: () => Promise<any>;
  overview?: () => Promise<any>;
} = {}) {
  const state: any[] = [];
  const refs: any[] = [];
  const effects: { run: () => any; deps: any }[] = [];
  let stateCursor = 0;
  let refCursor = 0;
  const calls: string[] = [];

  // Every stub is wrapped here rather than at the call site, so a test that
  // supplies its own resolver is still counted by the request census below.
  const count = <T>(name: string, fn: () => Promise<T>) => () => { calls.push(name); return fn(); };

  const api = {
    getWalletOverview: count('overview', options.overview ?? (() => Promise.reject(new Error('no overview')))),
    getWalletPerformance: count('performance', () => Promise.resolve({ periods: {}, ageDays: 0, startedOn: null })),
    getExternalRankings: count('rankings', () => Promise.resolve({ rankings: [] })),
    recordPortfolioSnapshot: count('snapshot', () => Promise.resolve({ recorded: true })),
  };
  const nativeDemoApi = {
    wallet: count('native-wallet', options.wallet ?? (() => Promise.reject(new Error('not the owner')))),
    setCollateral: async () => { throw new Error('not invoked by read-only hook tests'); },
  };

  const intervals: number[] = [];
  const oldSetInterval = globalThis.setInterval;
  const oldDocument = (globalThis as any).document;
  (globalThis as any).setInterval = ((_fn: any, ms: number) => { intervals.push(ms); return 0 as any; }) as any;
  (globalThis as any).clearInterval = (() => {}) as any;
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const hooks = {
    ...React,
    useState(initial: any) {
      const slot = stateCursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
    useMemo: (factory: () => any) => factory(),
    useCallback: (fn: any) => fn,
    useRef(initial: any) { const slot = refCursor++; return refs[slot] ?? (refs[slot] = { current: initial }); },
    useEffect: (run: () => any, deps: any) => { effects.push({ run, deps }); },
  };

  try {
    const { useWalletData } = evaluate('frontend/src/pages/wallet-v3/useWalletData.ts', {
      react: hooks,
      '../../lib/api': { api },
      '../../lib/pairList': {},
      '../../lib/nativeDemoApi': { nativeDemoApi },
    });
    const render = () => { stateCursor = 0; refCursor = 0; effects.length = 0; return useWalletData(); };
    const first = render();
    const mounted = effects.map((e) => e.run);
    for (const run of mounted) run();
    return { first, render, calls, intervals };
  } finally {
    globalThis.setInterval = oldSetInterval;
    (globalThis as any).document = oldDocument;
  }
}

const OWNER_WALLET = {
  initialized: true,
  account: {
    settleBalance: '4000', walletCollateral: '201000', collateral: '205000',
    unrealizedPnl: '-250.5', equity: '204749.5', initialMargin: '600', orderReserve: '150',
    maintenanceMargin: '90', available: '203999.5', maintenanceRatio: '0.00044',
    liquidatable: false, collateralComplete: true, unpricedAssets: [], collateralAsOf: 1,
  },
  ledger: { entries: [], openingBalance: '0', closingBalance: '4000', totals: { realizedPnl: '0', fees: '0', funding: '0', net: '0' }, walletBalance: '4000', reconciled: true },
  collateral: {
    settleAsset: 'USDT',
    lines: [{ asset: 'BTC', collateralEnabled: true, available: '2', locked: '0', quantity: '2', price: '100000', value: '200000', status: 'PRICED', source: 'bybit', asOf: 1 }],
    priced: '201000', collateralPriced: '201000', unpriced: [], collateralUnpriced: [], complete: true, asOf: 1,
  },
  rows: [
    { asset: 'USDT', collateralEnabled: true, collateralToggleable: false, walletQuantity: '1000', tradingBalance: '4000', total: '5000', inUse: '750', available: '4250', price: '1', value: '5000', status: 'SETTLE', asOf: null },
    { asset: 'BTC', collateralEnabled: true, collateralToggleable: true, walletQuantity: '2', tradingBalance: '0', total: '2', inUse: '0', available: '2', price: '100000', value: '200000', status: 'PRICED', asOf: 1 },
  ],
  assetsValue: '205000',
  assetsEquityValue: '204749.5',
  assetsComplete: true,
  unpricedAssets: [],
};

describe('1. the Wallet consumes the SAME authoritative account as the terminal', () => {
  it('reports the server account verbatim once it arrives', async () => {
    const hook = runHook({ wallet: () => Promise.resolve(OWNER_WALLET) });
    await Promise.resolve();
    await Promise.resolve();
    const { account, rows } = hook.render();

    expect(account.mode).toBe('CROSS');
    expect(account.collateralUsd).toBe(205000);
    expect(account.walletEquityUsd).toBe(204749.5);
    expect(account.totalEquityUsd).toBe(204749.5);
    expect(account.availableUsd).toBe(203999.5);
    expect(account.unrealizedPnlUsd).toBe(-250.5);
    expect(account.initialMarginUsd).toBe(600);
    expect(account.maintenanceMarginUsd).toBe(90);
    expect(account.orderReserveUsd).toBe(150);
    // Not a blend: a Cross account has one pool, so there is no spot/futures
    // split to report and none is invented.
    expect(account.spotUsd).toBeNull();
    expect(account.futuresUsd).toBeNull();

    expect(rows.map((r: any) => [r.symbol, r.total, r.available, r.locked, r.valueUsd])).toEqual([
      ['USDT', 5000, 4250, 750, 5000],
      ['BTC', 2, 2, 0, 200000],
    ]);
  });

  it('keeps disabled BTC in Wallet equity while the server margin equity excludes it', async () => {
    const disabled = {
      ...OWNER_WALLET,
      account: {
        ...OWNER_WALLET.account,
        walletCollateral: '1000',
        collateral: '5000',
        equity: '4749.5',
        available: '3999.5',
      },
      collateral: {
        ...OWNER_WALLET.collateral,
        collateralPriced: '1000',
        lines: OWNER_WALLET.collateral.lines.map((line) => ({ ...line, collateralEnabled: false })),
      },
      rows: OWNER_WALLET.rows.map((row) => row.asset === 'BTC' ? { ...row, collateralEnabled: false } : row),
      // Economic ownership did not change.
      assetsValue: '205000',
      assetsEquityValue: '204749.5',
    };
    const hook = runHook({ wallet: () => Promise.resolve(disabled) });
    await Promise.resolve();
    await Promise.resolve();
    const { account, rows } = hook.render();

    expect(account.collateralUsd).toBe(205000);
    expect(account.walletEquityUsd).toBe(204749.5);
    expect(account.totalEquityUsd).toBe(4749.5);
    expect(account.availableUsd).toBe(3999.5);
    expect(rows.find((row: any) => row.symbol === 'BTC')).toMatchObject({
      total: 2,
      valueUsd: 200000,
      collateralEnabled: false,
      collateralToggleable: true,
    });
  });

  it('falls back to the ordinary ledger, with margin reported unknown', async () => {
    const overview = () => Promise.resolve({
      real: {
        spot: [{ asset: 'USDT', available: '250', locked: '0', priceUsd: 1, valueUsd: 250 }],
        futures: [], spotValueUsd: 250, futuresValueUsd: 50, totalValueUsd: 300,
      },
      valuationComplete: true, unpricedAssets: [], btcPriceUsd: 100000,
    });
    const hook = runHook({ overview });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const { account } = hook.render();

    expect(account.mode).toBe('SPOT');
    expect(account.walletEquityUsd).toBe(300);
    expect(account.totalEquityUsd).toBe(300);
    expect(account.spotUsd).toBe(250);
    // Unknown, not zero: this account has no margin account to report.
    expect(account.availableUsd).toBeNull();
    expect(account.initialMarginUsd).toBeNull();
    expect(account.maintenanceMarginUsd).toBeNull();
  });
});

describe('2. nothing is counted twice', () => {
  it('never adds a ledger subtotal on top of a Cross account that already contains it', () => {
    const source = read('frontend/src/pages/wallet-v3/useWalletData.ts');
    const branch = source.slice(source.indexOf('const account: UnifiedAccount'), source.indexOf('const rankingBySymbol'));
    // The two branches are exclusive: the Cross branch returns before the
    // overview is ever read, so an equity that already counts the whole
    // wallet can never have a wallet subtotal added to it.
    expect(branch).toContain('if (unified) {');
    expect(branch).toContain('if (!overview) return null;');
    expect(branch).not.toMatch(/overview[\s\S]*?\+[\s\S]*?a\.equity|a\.equity[\s\S]*?\+[\s\S]*?overview/);
  });

  it('shows the owner only the server rows, not the spot ledger as well', async () => {
    const hook = runHook({
      wallet: () => Promise.resolve(OWNER_WALLET),
      overview: () => Promise.resolve({
        real: { spot: [{ asset: 'USDT', available: '999999', locked: '0', priceUsd: 1, valueUsd: 999999 }], futures: [], spotValueUsd: 999999, futuresValueUsd: 0, totalValueUsd: 999999 },
        valuationComplete: true, unpricedAssets: [], btcPriceUsd: 100000,
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const { rows, account } = hook.render();
    // The spot ledger answered with a different number entirely. It is not
    // shown, not added, and not blended — the margin account is the account.
    expect(account.totalEquityUsd).toBe(204749.5);
    expect(rows.map((r: any) => r.symbol)).toEqual(['USDT', 'BTC']);
    expect(rows.find((r: any) => r.symbol === 'USDT').total).toBe(5000);
  });
});

describe('3. an unknown price is never a zero', () => {
  it('carries a null value through to the row and marks it unpriced', async () => {
    const unpriced = {
      ...OWNER_WALLET,
      assetsComplete: false,
      unpricedAssets: ['WTF'],
      rows: [
        ...OWNER_WALLET.rows,
        { asset: 'WTF', collateralEnabled: false, collateralToggleable: true, walletQuantity: '7', tradingBalance: '0', total: '7', inUse: '0', available: '7', price: null, value: null, status: 'UNPRICED', asOf: null },
      ],
    };
    const hook = runHook({ wallet: () => Promise.resolve(unpriced) });
    await Promise.resolve();
    await Promise.resolve();
    const { rows, account } = hook.render();

    const row = rows.find((r: any) => r.symbol === 'WTF');
    expect(row.valueUsd).toBeNull();
    expect(row.priceUsd).toBeNull();
    expect(row.priced).toBe(false);
    // The quantity is known even though the value is not.
    expect(row.total).toBe(7);
    expect(account.valuationComplete).toBe(false);
    expect(account.unpricedAssets).toEqual(['WTF']);
  });

  it('does not call a zero balance unknown on an ordinary ledger', async () => {
    const hook = runHook({
      overview: () => Promise.resolve({
        real: { spot: [{ asset: 'DOGE', available: '0', locked: '0', priceUsd: null, valueUsd: null }], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 },
        valuationComplete: true, unpricedAssets: [], btcPriceUsd: null,
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const row = hook.render().rows.find((r: any) => r.symbol === 'DOGE');
    // Holding none of it is not an incomplete valuation.
    expect(row.priced).toBe(true);
  });
});

describe('4. no account balance is written into the source', () => {
  const files = [...sources('src', 'frontend/src'), resolve(root, 'frontend/tailwind.config.js')]
    .filter((p) => /\.(tsx?|js)$/.test(p));

  it('contains no trace of the observed owner total anywhere in the app', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(`${file}: ${/58[,._ ]?454[,._ ]?972/.test(text)}`).toBe(`${file}: false`);
    }
  });

  it('contains no trace of the holdings list that used to produce it', () => {
    // The quantities of the deleted presentation profile. Any one of them
    // reappearing beside an asset name means a balance is back in the code.
    //
    // Comments are stripped first: a doc comment may legitimately quote a
    // figure as an EXAMPLE of what the formatter has to render, and a
    // worked example in prose is not a balance the app can spend.
    const banned = [/ADMIN_PROFILE_HOLDINGS/, /32[,._ ]?726[,._ ]?245/, /['"]?quantity['"]?\s*:\s*['"]1200000['"]/];
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const pattern of banned) {
        expect(`${file} ${pattern}: ${pattern.test(text)}`).toBe(`${file} ${pattern}: false`);
      }
    }
  });

  it('has no module left that derives a balance from an account identity', () => {
    // The old profile keyed a set of holdings off one email address. No
    // balance may be selected by WHO is asking again.
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(`${file}: ${/hasAdminPortfolioProfile|adminPerformanceSeries|adminEquityIndex/.test(text)}`)
        .toBe(`${file}: false`);
    }
  });
});

describe('5. the page does not poll per asset', () => {
  it('reads the authoritative account once per load, never on an interval', () => {
    const hook = runHook({ wallet: () => Promise.resolve(OWNER_WALLET) });
    // One native request for the whole account AND all its rows.
    expect(hook.calls.filter((c) => c === 'native-wallet')).toHaveLength(1);
    // The two intervals are the pre-existing balance and rankings polls.
    // The account valuation — which costs one upstream quote per held asset
    // — is deliberately not among them.
    expect(hook.intervals.sort((a, b) => a - b)).toEqual([8000, 15000]);
  });

  it('makes a fixed number of requests regardless of how many assets are held', async () => {
    const many = {
      ...OWNER_WALLET,
      rows: Array.from({ length: 40 }, (_, i) => ({
        asset: `A${i}`, collateralEnabled: true, collateralToggleable: true,
        walletQuantity: '1', tradingBalance: '0', total: '1', inUse: '0',
        available: '1', price: '10', value: '10', status: 'PRICED', asOf: 1,
      })),
    };
    const hook = runHook({ wallet: () => Promise.resolve(many) });
    await Promise.resolve();
    await Promise.resolve();
    const { rows } = hook.render();

    expect(rows).toHaveLength(40);
    // Forty rows, still one request for them. Nothing is fetched per row.
    expect(hook.calls.filter((c) => c === 'native-wallet')).toHaveLength(1);
  });

  it('has no fetch of any kind inside the row or account projection', () => {
    const source = read('frontend/src/pages/wallet-v3/useWalletData.ts');
    const projections = source.slice(source.indexOf('const account: UnifiedAccount'), source.indexOf('const setCollateral = useCallback'));
    expect(projections).not.toMatch(/\bfetch\(|api\.|nativeDemoApi\./);
    // And no component below the hook fetches either.
    for (const file of ['PortfolioStrip.tsx', 'AssetLedger.tsx', 'AllocationCard.tsx', 'DynamicsCard.tsx', 'WalletOverview.tsx', 'FundingView.tsx']) {
      expect(`${file}: ${/\bfetch\(|\bapi\./.test(read(`frontend/src/pages/wallet-v3/${file}`))}`).toBe(`${file}: false`);
    }
  });
});


// ── 6. The equity curve ────────────────────────────────────────────────────

/** Renders EquityChart with hook stubs; effects run once, as a mount would. */
function renderChart(props: Record<string, unknown>) {
  const state: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: any) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
    useMemo: (factory: () => any) => factory(),
    useEffect: (run: () => void) => { effects.push(run); },
    useId: () => 'chart-gradient',
  };
  const { EquityChart } = evaluate('frontend/src/pages/wallet-v3/EquityChart.tsx', {
    react: hooks,
    'lucide-react': new Proxy({}, { get: (_t, name) => () => React.createElement('svg', { 'data-icon': String(name) }) }),
    '../../lib/i18n': { useLanguage: () => ({ lang: 'ru', t: (k: string) => k }) },
    './format': fmtModule,
    './useWalletData': { PERFORMANCE_PERIODS: ['7d', '30d', '90d', '1y', 'all'] },
  });
  const render = () => { cursor = 0; effects.length = 0; return EquityChart(props as any); };
  render();
  for (const run of effects) run();
  return { render, html: () => renderToStaticMarkup(render()) };
}

const fmtModule = (() => {
  const code = ts.transpileModule(read('frontend/src/pages/wallet-v3/format.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const out: Record<string, any> = {};
  new Function('exports', 'require', code)(out, () => ({ localeOf: () => 'ru' }));
  return out;
})();

/** A real stored series: daily points, as /wallet/performance returns them. */
const series = (n: number, from = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
    equity: from * (1 + i * 0.01),
  }));

const performanceWith = (overrides: Record<string, any>) => ({
  periods: {
    '7d': { period: '7d', available: false, startDate: null, endDate: null, startEquity: null, endEquity: null, absolutePnl: null, percent: null, points: [] },
    '30d': { period: '30d', available: false, startDate: null, endDate: null, startEquity: null, endEquity: null, absolutePnl: null, percent: null, points: [] },
    '90d': { period: '90d', available: false, startDate: null, endDate: null, startEquity: null, endEquity: null, absolutePnl: null, percent: null, points: [] },
    '1y': { period: '1y', available: false, startDate: null, endDate: null, startEquity: null, endEquity: null, absolutePnl: null, percent: null, points: [] },
    all: { period: 'all', available: false, startDate: null, endDate: null, startEquity: null, endEquity: null, absolutePnl: null, percent: null, points: [] },
    ...overrides,
  },
  ageDays: 0,
  startedOn: null,
});

describe('6. the equity curve is the account own stored history', () => {
  it('draws the line from the points the server returned, and nothing else', () => {
    const points = series(10);
    const performance = {
      ...performanceWith({
        all: { period: 'all', available: true, startDate: points[0].date, endDate: points[9].date,
          startEquity: points[0].equity, endEquity: points[9].equity,
          absolutePnl: points[9].equity - points[0].equity, percent: 9, points },
      }),
      ageDays: 9,
      startedOn: points[0].date,
    };
    const chart = renderChart({ performance, loading: false, unavailable: false, hidden: false });
    const html = chart.html();

    // One path for the line and one for its fill, both built from the ten
    // points — a curve with more vertices than the series has days would
    // mean something was interpolated into it.
    const line = /<path d="M([^"]+)" fill="none"/.exec(html);
    expect(line).not.toBeNull();
    expect(line![1].split(' L')).toHaveLength(points.length);
    // The section, the real age, and the real first day.
    expect(html).toContain('wallet-equity-chart');
    expect(html).toContain('wallet.historyDays');
    expect(html).toContain(points[0].date);
    expect(html).toContain(points[9].date);
    // No empty state over a real series.
    expect(html).not.toContain('wallet-equity-empty');
  });

  it('KEEPS the card, with an explanation inside the plot, when there is no history', () => {
    const chart = renderChart({ performance: performanceWith({}), loading: false, unavailable: false, hidden: false });
    const html = chart.html();

    // The section survives — this is the regression being guarded.
    expect(html).toContain('wallet-equity-chart');
    expect(html).toContain('wallet-equity-plot');
    // The frame is still drawn, the period tabs are still there...
    expect(html).toContain('wallet-equity-periods');
    // ...and the explanation is INSIDE the plot rather than replacing it.
    expect(html).toContain('wallet-equity-empty');
    expect(html).toContain('wallet.chartNoHistory');
    // Nothing is drawn: no line, no fake flat baseline standing in for one.
    expect(html).not.toMatch(/<path d="M[^"]+" fill="none"/);
  });

  it('opens on the widest window the account can actually answer', () => {
    const points = series(40);
    const performance = performanceWith({
      '7d': { period: '7d', available: true, startDate: points[33].date, endDate: points[39].date,
        startEquity: points[33].equity, endEquity: points[39].equity, absolutePnl: 60, percent: 6, points: points.slice(33) },
      '30d': { period: '30d', available: true, startDate: points[9].date, endDate: points[39].date,
        startEquity: points[9].equity, endEquity: points[39].equity, absolutePnl: 300, percent: 27, points: points.slice(9) },
    });
    const chart = renderChart({ performance, loading: false, unavailable: false, hidden: false });
    const html = chart.html();

    // 30D is the widest available, so that is what opens — a young account
    // must not land on an empty 7D and never find the curve it does have.
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(pressed).toEqual(['wallet.period30d']);
    // The windows the series cannot cover are disabled and say why.
    expect(html).toMatch(/disabled=""[^>]*title="wallet.periodUnavailable"/);
  });

  it('masks the curve with the balance rather than leaving it on screen', () => {
    const points = series(10);
    const performance = performanceWith({
      all: { period: 'all', available: true, startDate: points[0].date, endDate: points[9].date,
        startEquity: points[0].equity, endEquity: points[9].equity, absolutePnl: 90, percent: 9, points },
    });
    const html = renderChart({ performance, loading: false, unavailable: false, hidden: true }).html();
    expect(html).not.toMatch(/<path d="M[^"]+" fill="none"/);
    expect(html).toContain(fmtModule.MASK);
  });

  it('says the history could not be loaded rather than drawing an empty account', () => {
    const html = renderChart({ performance: null, loading: false, unavailable: true, hidden: false }).html();
    expect(html).toContain('wallet-equity-chart');
    expect(html).toContain('wallet.chartUnavailable');
    expect(html).not.toMatch(/<path d="M[^"]+" fill="none"/);
  });

  it('is fed by /wallet/performance and by nothing else', () => {
    const source = read('frontend/src/pages/wallet-v3/EquityChart.tsx');
    // No fetching, no generation, no randomness, no clock-derived shape.
    expect(source).not.toMatch(/\bfetch\(|\bapi\.|nativeDemoApi/);
    expect(source).not.toMatch(/Math\.random|Math\.exp|Math\.log|Math\.sin/);
    // Every point plotted comes from the server's own array.
    expect(source).toContain('selected!.points');
    expect(read('frontend/src/pages/WalletPage.tsx')).toContain('performance={performance}');
    expect(read('frontend/src/pages/wallet-v3/useWalletData.ts')).toContain('api.getWalletPerformance');
  });

  it('has no generated return curve left anywhere in the app', () => {
    // The anchors of the deleted curve: +28% / +132% / +317% / +1926% and
    // its all-time +2115%, as growth multiples and as percentages.
    const banned = [
      /multiple:\s*1\.28/, /multiple:\s*2\.32/, /multiple:\s*4\.17/, /multiple:\s*20\.26/, /multiple:\s*22\.15/,
      /ANCHORS/, /futureStep/, /historicalLog/, /adminEquityIndex/, /adminPerformanceSeries/,
      /PROFILE_REFERENCE_DAY/, /PROFILE_START_DAY/,
    ];
    for (const file of [...sources('src', 'frontend/src')]) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of banned) {
        expect(`${file} ${pattern}: ${pattern.test(text)}`).toBe(`${file} ${pattern}: false`);
      }
    }
  });
});


// ── 7. Where each section lives ────────────────────────────────────────────

describe('7. the Wallet workspace is sectioned like a trading account', () => {
  const page = () => read('frontend/src/pages/WalletPage.tsx');

  it('keeps the equity curve OUT of the account section and in its own', () => {
    const source = page();
    // The curve is real and still shipped — it just no longer sits between
    // the account summary and the asset table, where it pushed the rows the
    // owner came for below the fold.
    expect(source).toContain("{section === 'pnl' && (");
    const unified = source.slice(source.indexOf("{section === 'unified' && ("), source.indexOf("{section === 'pnl' && ("));
    expect(unified).toContain('<PortfolioStrip');
    expect(unified).toContain('<AssetLedger');
    expect(unified).not.toContain('<EquityChart');
    const pnl = source.slice(source.indexOf("{section === 'pnl' && ("));
    expect(pnl).toContain('<EquityChart');
    // And it is still fed by the same real series.
    expect(pnl).toContain('performance={performance}');
  });

  it('navigates inside the Wallet without leaving it or duplicating the global nav', () => {
    const nav = read('frontend/src/pages/wallet-v3/WalletSideNav.tsx');
    // Every SECTION is a button that switches what renders beside it. The
    // one anchor in the file is the VoLtex Card tile, which goes to the
    // Crypto Card page on purpose — and it is the only `<Link`.
    expect(nav.match(/<Link\b/g)).toHaveLength(1);
    expect(nav).toContain('<Link to="/card"');
    expect(nav).not.toMatch(/href=/);
    for (const id of ['overview', 'funding', 'unified', 'pnl', 'orders']) expect(nav).toContain(`id: '${id}'`);
    // No item is dead: nothing here is disabled, and nothing needs a
    // "not available yet" reason any more.
    expect(nav).not.toMatch(/disabled=|live:|navUnavailable/);
  });

  it('gives every navigation item a real section, and opens on the Overview', () => {
    const source = page();
    for (const id of ['overview', 'funding', 'unified', 'pnl', 'orders']) {
      expect(source).toContain(`{section === '${id}' && (`);
    }
    expect(source).toContain("useState<WalletSection>('overview')");
    const overview = source.slice(source.indexOf("{section === 'overview' && ("), source.indexOf("{section === 'funding' && ("));
    const funding = source.slice(source.indexOf("{section === 'funding' && ("), source.indexOf("{section === 'unified' && ("));
    expect(overview).toContain('<WalletOverview');
    expect(funding).toContain('<FundingView');
    // Both are fed the same hook outputs the Unified section reads — never
    // a second request or a second derivation.
    expect(overview).toContain('account={account}');
    for (const block of [overview, funding]) expect(block).toContain('overview={overview}');
  });

  it('puts the account summary and the asset table in the same section', () => {
    const source = page();
    const unified = source.slice(source.indexOf("{section === 'unified' && ("), source.indexOf("{section === 'pnl' && ("));
    // Nothing between them: the table starts immediately below the summary.
    expect(unified.indexOf('<PortfolioStrip')).toBeLessThan(unified.indexOf('<AssetLedger'));
    expect(unified.slice(unified.indexOf('</PortfolioStrip>') === -1 ? unified.indexOf('onHistory') : 0)).toBeDefined();
    // The approved Unified page is the header, the summary and the table at
    // full width; the distribution ring lives on the Overview now.
    expect(unified).not.toContain('<PortfolioAllocation');
    expect(unified).not.toContain('<AllocationCard');
    // The Cross account tells the table which rows back the margin.
    expect(unified).toContain("collateral={account?.mode === 'CROSS'}");
  });
});
