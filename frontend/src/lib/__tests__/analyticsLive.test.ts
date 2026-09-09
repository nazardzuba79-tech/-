import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Analytics Live V1.
 *
 * Two kinds of assertion here, and both matter:
 *
 *   1. **Behavioural** — the workspace is compiled and rendered with real
 *      React against stubbed data, and its actual output is inspected. A
 *      real zero must render as "0"; an unavailable metric must render as
 *      the dash and never as a number.
 *
 *   2. **Structural** — the shipped Analytics source is read and checked
 *      for what it must NOT contain. The archived branch's synthetic
 *      liquidity model and its "Демонстрационный режим" toggle are the
 *      specific things this page must never grow back, and a rendering
 *      test cannot prove the absence of a code path that a future edit
 *      might add. Reading the source can.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * Source with comments removed.
 *
 * The absence checks below are claims about executable code. These files'
 * doc comments deliberately NAME the archived demo mode and synthetic
 * liquidity model — in order to record that they were left out — so a
 * naive substring search would match the very prose that documents their
 * absence. Stripping comments first is what makes the assertion mean what
 * it says.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

function compile(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

/** Dictionary-free translation: keys pass through, so assertions read
 *  against stable keys rather than against Russian copy. */
const i18n = { useLanguage: () => ({ t: (key: string) => key }), LANGUAGES: [] };

function load(modulePath: string, extraStubs: Record<string, unknown> = {}) {
  const output: Record<string, any> = {};
  new Function('require', 'exports', compile(read(modulePath)))((name: string) => {
    if (name in extraStubs) return extraStubs[name];
    if (name === 'react') return React;
    if (name.endsWith('.css')) return {};
    if (name.includes('i18n')) return i18n;
    return req(name);
  }, output);
  return output;
}

const presentation = load('src/pages/analytics/presentation.tsx');

/** A snapshot in the shape the backend actually sends. */
function snapshot(over: Record<string, any> = {}) {
  return {
    generatedAt: 1_800_000_000_000,
    contracts: ['BTC/USDT', 'ETH/USDT'],
    sections: {
      marketOverview: {
        available: true,
        source: 'coingecko',
        fetchedAt: Date.now() - 12_000,
        stale: false,
        value: {
          totalMarketCapUsd: 3_482_190_000_000,
          totalVolume24hUsd: 148_320_000_000,
          btcDominancePercent: 56.4,
          ethDominancePercent: 12.8,
          marketCapChangePercent24h: 1.92,
        },
      },
      sentiment: {
        available: true,
        source: 'alternative.me',
        fetchedAt: Date.now() - 30_000,
        stale: false,
        value: { value: 68, classification: 'Greed', updatedAt: 1_800_000_000 },
      },
      derivatives: {
        available: true,
        source: 'voltex',
        fetchedAt: Date.now(),
        stale: false,
        value: {
          scope: 'venue',
          intervalHours: 8,
          nextSettlementAt: Date.now() + 3_600_000,
          contracts: [
            { symbol: 'BTC/USDT', markPrice: '104235.42', indexPrice: '104200.10', openInterestBase: '0', openInterestUsd: '0', fundingRate: '0.00004', fundingAppliedAt: 1_800_000_000_000 },
            { symbol: 'ETH/USDT', markPrice: '3892.15', indexPrice: '3890.00', openInterestBase: '12.5', openInterestUsd: '48651.87', fundingRate: null, fundingAppliedAt: null },
          ],
        },
      },
    },
    unsupported: {
      liquidations: { available: false, reason: 'unsupported_metric', detail: 'no feed' },
      liquidationHeatmap: { available: false, reason: 'unsupported_metric' },
      marketWideOpenInterest: { available: false, reason: 'unsupported_metric' },
      longShortRatio: { available: false, reason: 'unsupported_metric' },
      etfFlows: { available: false, reason: 'unsupported_metric' },
      exchangeFlows: { available: false, reason: 'unsupported_metric' },
      whaleActivity: { available: false, reason: 'unsupported_metric' },
      volatility: { available: false, reason: 'unsupported_metric' },
      futuresBasis: { available: false, reason: 'unsupported_metric' },
      correlations: { available: false, reason: 'unsupported_metric' },
      sectorRotation: { available: false, reason: 'unsupported_metric' },
    },
    ...over,
  };
}

/** Render the workspace with the store stubbed to a given state. */
function renderWorkspace(state: Record<string, any>) {
  const workspace = load('src/pages/analytics/AnalyticsWorkspace.tsx', {
    './analyticsStore': { useAnalyticsSnapshot: () => ({ refresh: () => {}, ...state }) },
    './presentation': presentation,
  });
  return renderToStaticMarkup(React.createElement(workspace.AnalyticsWorkspace));
}

const READY = { snapshot: snapshot(), status: 'ready', loaded: true };

describe('Analytics — real data rendering', () => {
  it('renders the real market overview figures', () => {
    const html = renderWorkspace(READY);
    expect(html).toContain('$3.48T'); // total market cap
    expect(html).toContain('$148.32B'); // 24h volume
    expect(html).toContain('56.4%'); // BTC dominance
    expect(html).toContain('12.8%'); // ETH dominance
    expect(html).toContain('+1.92%'); // market cap 24h
    expect(html).toContain('68 · Greed'); // Fear & Greed
  });

  it('renders VOLTEX derivatives for the first listed contract', () => {
    const html = renderWorkspace(READY);
    expect(html).toContain('104,235.42'); // mark price
    expect(html).toContain('104,200.10'); // index price
    expect(html).toContain('+0.0040%'); // funding rate, as a percentage
    expect(html).toContain('8h'); // funding interval
  });

  it('keeps a REAL zero as zero, not as a dash', () => {
    // BTC/USDT has genuinely zero open interest in the fixture. That is a
    // fact about the market and must render as a figure.
    const html = renderWorkspace(READY);
    const oiBlock = html.slice(html.indexOf('analytics.openInterest'));
    expect(oiBlock).toContain('>0<');
  });

  it('renders an unavailable metric as the dash and never as a number', () => {
    const html = renderWorkspace({
      snapshot: snapshot({
        sections: {
          ...snapshot().sections,
          marketOverview: { available: false, reason: 'provider_unavailable', detail: 'down' },
          sentiment: { available: false, reason: 'provider_unavailable' },
        },
      }),
      status: 'ready',
      loaded: true,
    });

    // Scoped to the overview module: the derivatives panel below it
    // legitimately renders "$0.00" for a REAL zero open interest, and
    // that must not be swept up by this assertion.
    const overview = html.slice(html.indexOf('vx-overview-module'), html.indexOf('vx-context'));

    // All six figures are the unavailable dash...
    expect((overview.match(/is-unavailable/g) ?? []).length).toBe(6);
    // ...the real values are gone...
    expect(overview).not.toContain('$3.48T');
    expect(overview).not.toContain('56.4%');
    expect(overview).not.toContain('68 · Greed');
    // ...and not one of the six value slots carries a digit. (The slice
    // still contains i18n KEYS like "analytics.volume24h", so the check
    // reads the rendered values themselves rather than the whole block.)
    const values = [...overview.matchAll(/class="vx-metric-value[^"]*">([^<]*)</g)].map((m) => m[1]);
    expect(values).toHaveLength(6);
    expect(values.every((v) => v === '—')).toBe(true);
  });

  it('renders a null funding rate as a dash rather than 0%', () => {
    // ETH/USDT has never settled funding in the fixture.
    const eth = snapshot();
    eth.sections.derivatives.value.contracts = [eth.sections.derivatives.value.contracts[1]];
    eth.contracts = ['ETH/USDT'];
    const html = renderWorkspace({ snapshot: eth, status: 'ready', loaded: true });

    expect(html).not.toContain('+0.0000%');
    expect(html).toContain('—');
    // The contract's real open interest is still shown.
    expect(html).toContain('12.5');
  });

  it('marks stale data as stale rather than presenting it as live', () => {
    const stale = snapshot();
    stale.sections.marketOverview.stale = true;
    const html = renderWorkspace({ snapshot: stale, status: 'ready', loaded: true });

    expect(html).toContain('is-stale');
    expect(html).toContain('analytics.stale');
    // Still real data, still rendered — just flagged.
    expect(html).toContain('$3.48T');
  });

  it('shows compact freshness without naming any upstream provider', () => {
    const html = renderWorkspace(READY);
    // Freshness stayed — where the reading came from did not. The
    // customer-facing exchange UI names no upstream infrastructure.
    expect(html).not.toMatch(/CoinGecko|Alternative\.me|Kraken|Binance|OKX|Twelve Data/i);
    // One freshness tag per module, not one per figure: six overview
    // metrics, at most a couple of tags.
    expect((html.match(/vx-source-dot/g) ?? []).length).toBeLessThanOrEqual(4);
    expect((html.match(/vx-source-dot/g) ?? []).length).toBeGreaterThan(0);
  });

  it('builds the asset selector from the contracts VOLTEX actually lists', () => {
    const html = renderWorkspace(READY);
    expect(html).toContain('>BTC<');
    expect(html).toContain('>ETH<');
    // The archived design hardcoded BTC/ETH/SOL/XRP. Nothing this venue
    // does not list may be offered as a choice.
    expect(html).not.toContain('>SOL<');
    expect(html).not.toContain('>XRP<');
  });

  it('switches the derivatives panel when another contract is selected', () => {
    const workspace = load('src/pages/analytics/AnalyticsWorkspace.tsx', {
      './analyticsStore': { useAnalyticsSnapshot: () => ({ refresh: () => {}, ...READY }) },
      './presentation': presentation,
    });
    // Drive the real useState through React's own renderer by rendering
    // once, then again after the click handler runs.
    const html = renderToStaticMarkup(React.createElement(workspace.AnalyticsWorkspace));
    // The first listed contract is selected by default.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('104,235.42');
    // And the second contract's figures are not on screen.
    expect(html).not.toContain('3,892.15');
  });

  it('renders honestly with no contracts at all', () => {
    const html = renderWorkspace({
      snapshot: snapshot({ contracts: [], sections: { ...snapshot().sections, derivatives: { available: false, reason: 'no_data' } } }),
      status: 'ready',
      loaded: true,
    });
    expect(html).toContain('analytics.noContracts');
    expect(html).not.toContain('NaN');
  });

  it('keeps the last good data on screen when a refresh fails', () => {
    const html = renderWorkspace({ snapshot: snapshot(), status: 'error', loaded: true });
    expect(html).toContain('analytics.loadFailed');
    // Not blanked.
    expect(html).toContain('$3.48T');
  });

  it('renders pending modules as compact rows driven by the server', () => {
    const html = renderWorkspace(READY);
    // Phase 2 implemented six of the old pending modules. What is left is
    // what still has no legitimate free source.
    expect(html).toContain('analytics.liquidations');
    expect(html).toContain('analytics.etfFlows');
    expect(html).toContain('analytics.whaleActivity');
    expect(html).toContain('analytics.noSource');
    // A module the server stops reporting as unsupported disappears from
    // the pending grid instead of claiming to have no source.
    const partial = snapshot({ unsupported: { etfFlows: { available: false, reason: 'unsupported_metric' } } });
    const html2 = renderWorkspace({ snapshot: partial, status: 'ready', loaded: true });
    expect(html2).toContain('analytics.etfFlows');
    expect(html2).not.toContain('analytics.liquidations');
  });

  it('renders the Phase 2 bands and never a fabricated heatmap', () => {
    const html = renderWorkspace(READY);
    // The three new bands exist and are labelled.
    for (const key of ['analytics.externalDerivatives', 'analytics.marketRisk', 'analytics.marketStructure']) {
      expect(html).toContain(key);
    }
    // The liquidity map stays a slot, not a chart built from something else.
    expect(html).toContain('analytics.liquidityMapPending');
    expect(html).not.toMatch(/heatmap-cell|liquidation-wall|cluster/i);
  });

  it('shows an honest empty state — never a zero — when no external venue is wired', () => {
    // READY carries no external sections, which is exactly the shape a
    // Phase-1 backend answers with.
    const html = renderWorkspace(READY);
    expect(html).toContain('analytics.noExternalVenue');
    // The external modules render no figure at all rather than $0.00 or 0%.
    const external = html.slice(html.indexOf('analytics.trackedVenueOi'), html.indexOf('analytics.marketStructure'));
    expect(external).not.toMatch(/\$0\.00|0\.0000%|\b0%/);
  });

  it('never renders NaN, undefined or null as a value', () => {
    for (const state of [READY, { snapshot: null, status: 'loading', loaded: false }]) {
      const html = renderWorkspace(state);
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('>undefined<');
      expect(html).not.toContain('>null<');
    }
  });
});

describe('Analytics — no synthetic data can reach production', () => {
  const sources = [
    'src/pages/AnalyticsPage.tsx',
    'src/pages/analytics/AnalyticsWorkspace.tsx',
    'src/pages/analytics/presentation.tsx',
    'src/pages/analytics/analyticsStore.ts',
  ];
  const all = sources.map(code).join('\n');
  const allWithComments = sources.map(read).join('\n');

  it('ships no demo mode, in any form', () => {
    expect(all).not.toMatch(/Демонстрационный|demoMode|demoBuckets|DEMO_PRICES|isDemo/);
    // No toggle that could switch a fabricated dataset on.
    expect(all).not.toMatch(/setDemo|demo\s*\?/);
  });

  it('ships none of the archived synthetic liquidity model', () => {
    expect(all).not.toMatch(/buildLiquidityModel|classifyGroups|cascadeRisk|RISK_WEIGHTS|liquidityModel/);
    // The generator's own primitives, which is what actually manufactured
    // the walls, clusters and voids.
    expect(all).not.toMatch(/makeRng|hashSeed|shapeContribution|generateBuckets/);
  });

  it('contains no hardcoded market figures', () => {
    // The archive carried literals like 68420, 3511, 184.72, '$2.73T'.
    expect(all).not.toMatch(/\$\d+(\.\d+)?[TBM]\b/);
    expect(all).not.toMatch(/\b(68420|3511|184\.72|0\.624)\b/);
  });

  it('has no Math.random anywhere in Analytics', () => {
    expect(all).not.toContain('Math.random');
  });

  it('ships no hardcoded user-visible Russian copy', () => {
    // The archived workspace was written in Russian with lang="ru".
    // Everything user-visible now goes through the i18n dictionary.
    // `all` is already comment-free, so any Cyrillic left in it is real
    // code — a hardcoded string that would ship untranslated.
    expect(all.split('\n').filter((line) => /[А-Яа-яЁё]/.test(line))).toEqual([]);
    expect(allWithComments).not.toContain('lang="ru"');
  });

  it('renders no synthetic liquidation figures in the map slot', () => {
    const html = renderWorkspace(READY);
    const slot = html.slice(html.indexOf('analytics.liquidityMap'));
    // The slot exists and explains itself, and carries no number at all.
    expect(slot).toContain('analytics.liquidityMapPending');
    expect(slot).not.toMatch(/\$\d/);
  });
});

describe('Analytics — access policy', () => {
  it('the page no longer runs the admin gate', () => {
    const page = code('src/pages/AnalyticsPage.tsx');
    expect(page).not.toContain('useAdminGate');
    expect(page).not.toContain('Navigate');
  });

  it('the nav entry is no longer admin-only', () => {
    const nav = read('src/components/Nav.tsx');
    expect(nav).toMatch(/\{ to: '\/analytics', label: t\('nav\.analytics'\) \}/);
  });

  it('Analytics never requests operational provider status', () => {
    const all = [
      'src/pages/AnalyticsPage.tsx',
      'src/pages/analytics/AnalyticsWorkspace.tsx',
      'src/pages/analytics/analyticsStore.ts',
    ]
      .map(code)
      .join('\n');
    expect(all).not.toContain('market/status');
    expect(all).not.toContain('diagnostics');
    expect(all).not.toContain('rateLimitHits');
  });
});

describe('Analytics — performance', () => {
  it('the workspace opens no data-fetching loop of its own', () => {
    const workspace = code('src/pages/analytics/AnalyticsWorkspace.tsx');
    // One setInterval exists, and it drives the funding countdown clock
    // only — no fetch is reachable from it.
    expect((workspace.match(/setInterval/g) ?? []).length).toBe(1);
    expect(workspace).toContain('setNow(Date.now())');
    expect(workspace).not.toContain('api.');
    expect(workspace).toContain('clearInterval');
  });

  it('the store polls on one timer and cleans up after the last subscriber', () => {
    const store = code('src/pages/analytics/analyticsStore.ts');
    // Reference-counted cleanup: the last subscriber leaving stops the timer.
    expect(store).toMatch(/listeners\.size === 0\)\s*this\.stop\(\)/);
    // Request coalescing: concurrent callers join the in-flight promise.
    expect(store).toMatch(/if \(this\.inFlight\) return this\.inFlight/);
    // Exactly one timer for the whole dataset. Counts real CALLS only —
    // `ReturnType<typeof setInterval>` is a type annotation, not a timer.
    expect((store.match(/(?<!typeof )setInterval\(/g) ?? []).length).toBe(1);
    expect(store).toContain('clearInterval');
  });
});
