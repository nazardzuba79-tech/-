import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import type { AnalyticsSnapshot as ClientSnapshot } from '../api';
import type { AnalyticsSnapshot as ServerSnapshot } from '../../../../src/services/AnalyticsDataService';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8');
const directory = 'src/pages/analytics/';
let state: any;
const getOverview = jest.fn(), getCandles = jest.fn();
const api = { getAnalyticsOverview: getOverview, getExternalCandles: getCandles };
function loader(storeStub = true) {
  const cache = new Map<string, any>();
  function load(path: string): any {
    const full = resolve(frontend, path);
    if (cache.has(full)) return cache.get(full);
    const result = {};
    cache.set(full, result);
    const compiled = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function('require', 'exports', compiled)((name: string) => {
      if (name.endsWith('.css')) return {};
      if (name.includes('i18n')) return { useLanguage: () => ({ lang: 'en', t: (key: string) => key }) };
      if (name.endsWith('/api')) return { api };
      if (name === './analyticsStore' && storeStub) return { useAnalyticsSnapshot: () => ({ ...state, refresh: jest.fn(), setAsset: jest.fn() }) };
      if (name.startsWith('.')) {
        const base = resolve(dirname(full), name);
        return load(existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts');
      }
      return req(name);
    }, result);
    return result;
  }
  return load;
}
const load = loader();
const ready = (value: any) => ({ available: true as const, value, source: 'private-provider-label', fetchedAt: Date.now(), stale: false });
const absent = () => ({ available: false as const, reason: 'provider_unavailable', detail: 'SECRET-BODY-MUST-NOT-RENDER' });
function snapshot(): ClientSnapshot {
  const no = absent();
  return {
    generatedAt: Date.now(), selectedAsset: 'BTC', trackedAssets: ['BTC', 'ETH', 'SOL', 'XRP'], contracts: ['BTC/USDT', 'ETH/USDT'], unsupported: { etfFlows: no },
    sections: {
      marketOverview: ready({ totalMarketCapUsd: 3482190000000, totalVolume24hUsd: 148320000000, btcDominancePercent: 56.4, ethDominancePercent: 12.8, marketCapChangePercent24h: 1.92 }),
      sentiment: ready({ value: 68, classification: 'Greed', updatedAt: 1800000000 }),
      derivatives: ready({ scope: 'venue', intervalHours: 8, nextSettlementAt: Date.now() + 3600000, contracts: [
        { symbol: 'BTC/USDT', markPrice: '104235.42', indexPrice: '104200.10', openInterestBase: '0', openInterestUsd: '0', fundingRate: '0.00004', fundingAppliedAt: null },
        { symbol: 'ETH/USDT', markPrice: '3892.15', indexPrice: '3890.00', openInterestBase: '12.5', openInterestUsd: '48651.87', fundingRate: null, fundingAppliedAt: null },
      ] }),
      externalOpenInterest: no, externalFunding: no, perpetualBasis: no, longShortPositioning: no, realizedVolatility: no, cryptoCorrelations: no, sectorRotation: no,
      liquidations: no, impliedVolatility: no, futuresTermStructure: no,
    },
  };
}
function render(s: ClientSnapshot | null = snapshot(), status = 'ready') {
  state = { snapshot: s, status, loaded: status !== 'loading' };
  return renderToStaticMarkup(React.createElement(load(directory + 'AnalyticsWorkspace.tsx').AnalyticsWorkspace));
}
function renderModule(file: string, component: string, s: ClientSnapshot) {
  return renderToStaticMarkup(React.createElement(load(directory + file + '.tsx')[component], { snapshot: s }));
}
function withLiquidations(eventCount = 0, complete = false) {
  const s = snapshot(), now = Date.now();
  s.sections.liquidations = ready({ baseAsset: 'BTC', connected: true, streamStartedAt: now - 3600000, lastMessageAt: now, windows: [4,12,24].map(hours => ({
    hours, from: now - hours * 3600000, to: now, coverageStartAt: now - 3600000, coverageComplete: complete, eventCount,
    longNotionalUsd: eventCount ? 1234 : 0, shortNotionalUsd: 0, totalNotionalUsd: eventCount ? 1234 : 0, largestEvent: null,
    buckets: eventCount ? [{ fromPrice: 100, toPrice: 101, longNotionalUsd: 1234, shortNotionalUsd: 0, eventCount }] : [], recent: [],
  })) });
  return s;
}

describe('approved Analytics: real contract and formatting', () => {
  it('client and server snapshots remain structurally compatible in both directions', () => {
    // Checked by ts-jest, not a runtime cast hiding an incomplete contract.
    type Value<T> = T extends {available: true; value: infer V} ? V : never;
    type NewKeys = 'liquidations' | 'impliedVolatility' | 'futuresTermStructure';
    type ClientValues = { [K in NewKeys]: Value<ClientSnapshot['sections'][K]> };
    type ServerValues = { [K in NewKeys]: Value<ServerSnapshot['sections'][K]> };
    type BothWays = ServerSnapshot extends ClientSnapshot ? ClientValues extends ServerValues ? ServerValues extends ClientValues ? true : never : never : never;
    const compatible: BothWays = true;
    expect(compatible).toBe(true);
  });
  it('renders market overview and actual VOLTEX figures', () => {
    const html = render();
    for (const value of ['$3.48T', '$148.32B', '56.4%', '12.8%', '+1.92%', '104,235.42', '104,200.10', '+0.0040%']) expect(html).toContain(value);
  });
  it('retains a genuine zero open interest', () => {
    const html = render();
    expect(html).toContain('$0.00');
    expect(html).toContain('>0<');
  });
  it('all six unavailable overview metrics are dashes', () => {
    const s = snapshot(); s.sections.marketOverview = absent(); s.sections.sentiment = absent();
    const html = render(s);
    const strip = html.slice(html.indexOf('vx-overview-module'), html.indexOf('ap-derivatives-strip'));
    expect((strip.match(/is-unavailable/g) ?? []).length).toBe(6);
    expect(strip).not.toContain('$0');
  });
  it('selects the echoed asset without leaking another contract', () => {
    const s = snapshot(); s.selectedAsset = 'ETH';
    const html = render(s);
    expect(html).toContain('3,892.15');
    expect(html).toContain('12.5');
    expect(html).not.toContain('104,235.42');
    expect(html).not.toContain('+0.0000%');
  });
  it('builds choices from the tracked assets returned by the backend', () => {
    const s = snapshot(); s.trackedAssets = ['BTC','SOL'];
    const html = render(s);
    expect(html).toContain('>SOL<'); expect(html).not.toContain('>XRP<');
  });
  it('does not invent native contracts for a tracked external asset', () => {
    const s = snapshot(); s.selectedAsset = 'SOL';
    const html = render(s);
    expect(html).not.toContain('104,235.42'); expect(html).not.toContain('3,892.15');
  });
  it('marks stale overview data and keeps its real value', () => {
    const s = snapshot(); if (s.sections.marketOverview.available) s.sections.marketOverview.stale = true;
    const html = render(s);
    expect(html).toContain('is-stale'); expect(html).toContain('analytics.stale'); expect(html).toContain('$3.48T');
  });
  it('failed refresh preserves last values with a visible error', () => {
    const html = render(snapshot(), 'error');
    expect(html).toContain('analytics.loadFailed'); expect(html).toContain('$3.48T');
  });
  it.each([null, snapshot()])('never emits malformed values for state %p', s => {
    expect(render(s)).not.toMatch(/NaN|>undefined<|>null</);
  });
  const formats = load(directory + 'presentation.tsx');
  it.each(['formatUsd', 'formatPrice', 'formatPercent', 'formatQuantity', 'formatSignedPercent', 'formatFundingRate'])('%s rejects missing/blank/invalid but retains zero', fn => {
    for (const value of [null, undefined, '', ' ', 'nonsense']) expect(formats[fn](value)).toBeNull();
    expect(formats[fn]('0')).not.toBeNull();
  });
  it('unsupported provider details never reach the user', () => {
    expect(render()).not.toMatch(/SECRET-BODY|private-provider|unsupported|coming soon|demo|Binance|Deribit|CoinGecko|OKX/i);
  });
  it('hides unimplemented capital flows and latent heatmaps', () => {
    expect(render()).not.toMatch(/analytics.etfFlows|analytics.whaleActivity|analytics.exchangeFlows|heatmap|liquidityMapPending/);
  });
});

describe('observed liquidation presentation', () => {
  it('no source is not zero', () => {
    const html = renderModule('LiquidationMap','LiquidationMap',snapshot());
    expect(html).not.toContain('$0.00'); expect(html).toContain('—');
  });
  it('a real empty observed period retains zeros and no invented bars', () => {
    const html = renderModule('LiquidationMap','LiquidationMap',withLiquidations());
    expect(html).toContain('$0.00'); expect(html).toContain('No liquidations recorded');
    expect(html).not.toContain('ap-bucket-column');
  });
  it('shows partial coverage even with no coverage-start timestamp', () => {
    const s = withLiquidations();
    if (s.sections.liquidations.available) s.sections.liquidations.value.windows.forEach(w => { w.coverageStartAt = null; });
    expect(renderModule('LiquidationMap','LiquidationMap',s)).toContain('Partial period');
  });
  it('does not label truncated observations complete', () => {
    expect(renderModule('LiquidationMap','LiquidationMap',withLiquidations(1))).toContain('data-coverage="partial"');
    expect(renderModule('LiquidationMap','LiquidationMap',withLiquidations(1,true))).not.toContain('data-coverage="partial"');
  });
  it('draws only returned buckets as executed events', () => {
    const html = renderModule('LiquidationMap','LiquidationMap',withLiquidations(1));
    expect((html.match(/class="ap-bucket-column"/g) ?? []).length).toBe(1);
    expect(html).toContain('$1.23K'); expect(html).not.toMatch(/heatmap|latent|wall/i);
  });
  it('exposes 4h/12h/24h selection and defaults to approved 12h view', () => {
    const html = renderModule('LiquidationMap','LiquidationMap',withLiquidations());
    for(const h of [4,12,24]) expect(html).toContain('>' + h + 'h<');
    expect(html).toContain('aria-pressed="true">12h');
  });
  it('coverage is bounded and has no false 100% fallback', () => {
    const { coverage } = load(directory + 'approvedData.ts');
    expect(coverage({from:0,to:100,coverageStartAt:null})).toBe(0);
    expect(coverage({from:0,to:100,coverageStartAt:80})).toBe(20);
    expect(coverage({from:0,to:100,coverageStartAt:-50})).toBe(100);
  });
});

describe('derivatives and market context', () => {
  it('OI amount units stay USD when the contract reports USD', () => {
    const s = snapshot();
    s.sections.futuresTermStructure = ready({ baseAsset: 'BTC', referencePrice:100, points:[
      {instrument:'BTC-TEST',expiryAt:1800000000000,markPrice:102,referencePrice:100,basisPercent:2,annualizedBasisPercent:4,openInterest:1000000,openInterestUnit:'USD'},
      {instrument:'BTC-LINEAR-TEST',expiryAt:1801000000000,markPrice:102,referencePrice:100,basisPercent:2,annualizedBasisPercent:4,openInterest:12.5,openInterestUnit:'BASE'},
    ] });
    const html = renderModule('MarketContextPanels','FuturesTermStructure',s);
    expect(html).toContain('$1.00M'); expect(html).not.toContain('1,000,000 BTC'); expect(html).toContain('12.5 BTC');
  });
  it.each(['SOL','XRP'])('%s unavailable IV and curve never become zero', asset => {
    const s = snapshot(); s.selectedAsset = asset;
    for (const component of ['ImpliedVolatility','FuturesTermStructure']) {
      const html = renderModule('MarketContextPanels',component,s);
      expect(html).toContain('—'); expect(html).not.toMatch(/0.00%|\$0/);
    }
  });
  it('renders IV values and null range values separately', () => {
    const s = snapshot(); s.sections.impliedVolatility = ready({baseAsset:'BTC',current:42.5,open24h:null,high24h:null,low24h:null,change24hPercent:0,resolutionSeconds:60,points:3});
    const html = renderModule('MarketContextPanels','ImpliedVolatility',s);
    expect(html).toContain('42.50%'); expect(html).toContain('+0.00%'); expect(html).toContain('—');
  });
  it('preserves real zero correlation and negative correlation', () => {
    const s = snapshot(); s.sections.cryptoCorrelations = ready({assets:['BTC','ETH','SOL'],interval:'1h',lookbackHours:720,method:'pearson_log_returns',pairs:[{a:'BTC',b:'ETH',correlation:0,samples:500},{a:'BTC',b:'SOL',correlation:-0.5,samples:500}]});
    const html = renderModule('MarketContextPanels','CorrelationMatrix',s);
    expect(html).toContain('>0.00<'); expect(html).toContain('>-0.50<'); expect(html).toContain('>—<');
  });
  it('shows funding in percent with each real interval', () => {
    const s = snapshot(); s.sections.externalFunding = ready({baseAsset:'BTC',venues:[{venue:'binance',contract:'BTCUSDT',fundingRate:0.0001,intervalHours:8,nextFundingTime:null,fetchedAt:Date.now(),stale:false}]});
    const html = renderModule('DerivativesPanels','FundingRates',s);
    expect(html).toContain('+0.0100%'); expect(html).toContain('8h'); expect(html).not.toContain('binance');
  });
  it('scales a constant real price series as a flat line', () => {
    const { lineCoordinates } = load(directory + 'approvedData.ts');
    expect(lineCoordinates([5,5,5]).map((p: number[]) => p[1])).toEqual([95,95,95]);
  });
  it('unavailable account ratios do not draw a 100% short bar', () => {
    const s = snapshot(); s.sections.longShortPositioning = ready({baseAsset:'BTC',ratios:[{kind:'global_account',venue:'binance',contract:'BTCUSDT',longAccount:null,shortAccount:null,period:'5m'}]});
    const html = renderModule('DerivativesPanels','LongShortRatio',s);
    expect(html).toContain('data-available="false"'); expect(html).not.toContain('<i style=');
  });
});

describe('architecture and preserved scope', () => {
  const files = readdirSync(resolve(frontend,directory)).filter(p => /\.(tsx?|css)$/.test(p));
  const sources = files.map(p => read(directory+p)).join('\n');
  it('does not ship the archive data generator or unsafe snapshot casts', () => {
    expect(sources).not.toMatch(/from ['"].*\/data\/|Math.random|buildLiquidityModel|makeRng|as unknown as LiveSections/);
  });
  it('provider requests stay server-side', () => {
    expect(sources).not.toMatch(/fetch\s*\(|new WebSocket|https:\/\/.*(binance|deribit)/i);
  });
  it('retains archive palette and maximum content width under a scoped stylesheet', () => {
    const css = read(directory+'analytics.css');
    for(const value of ['#f3f4f5','#c08a18','#e3e4e7','#101215','1560px']) expect(css).toContain(value);
    expect(css.split('\n').filter(line => line.includes('{') && !line.startsWith('.vx-analytics') && !line.startsWith('@media'))).toEqual([]);
  });
  it('keeps existing route/auth shell and operational data out of the workspace', () => {
    const page = read('src/pages/AnalyticsPage.tsx');
    expect(page).toContain('<Nav'); expect(page).toContain('<Footer');
    expect(read(directory+'AnalyticsWorkspace.tsx')).not.toMatch(/diagnostics|market\/status|requireAdmin|Navigate/);
  });
});

describe('shared store: polling and asset races', () => {
  let store: any;
  beforeEach(() => { jest.useFakeTimers(); getOverview.mockReset(); store = loader(false)(directory+'analyticsStore.ts').analyticsStore; });
  afterEach(() => { store._resetForTests(); jest.useRealTimers(); });
  it('one request and one timer for multiple subscribers, stopped on final unsubscribe', async () => {
    getOverview.mockResolvedValue(snapshot());
    const a = store.subscribe(jest.fn()), b = store.subscribe(jest.fn());
    await store.refresh();
    expect(getOverview).toHaveBeenCalledTimes(1); expect(store._timerCount).toBe(1);
    a(); expect(store._timerCount).toBe(1); b(); expect(store._timerCount).toBe(0);
  });
  it('queues the latest asset when selection changes during an in-flight request', async () => {
    let finish: (s: ClientSnapshot) => void = () => {};
    getOverview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({...snapshot(),selectedAsset:'SOL'});
    const listener = jest.fn(), unsubscribe = store.subscribe(listener);
    const pending = store.refresh();
    store.setAsset('ETH'); store.setAsset('SOL');
    finish(snapshot()); await pending; await Promise.resolve(); await Promise.resolve();
    expect(getOverview.mock.calls.map(call => call[0])).toEqual([undefined,'SOL']);
    expect(listener.mock.calls.some(call => call[0].snapshot?.selectedAsset === 'BTC')).toBe(false);
    expect(store.getState().snapshot.selectedAsset).toBe('SOL');
    unsubscribe();
  });
  it('refresh failure preserves previous snapshot and exposes error', async () => {
    getOverview.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline'));
    const stop = store.subscribe(jest.fn()); await store.refresh(); const previous = store.getState().snapshot;
    await store.refresh(); expect(store.getState().status).toBe('error'); expect(store.getState().snapshot).toBe(previous); stop();
  });
});
