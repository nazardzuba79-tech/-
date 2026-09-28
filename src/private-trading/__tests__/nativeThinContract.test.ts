import { AddressInfo } from 'net';
import { collectorServer } from '../../services/marketData/live/collectorServer';
import { LiveFeed } from '../../services/marketData/live/contract';
import { PrivateTradingMarketData } from '../marketData';
import { NativeDemoService } from '../native/service';
import { deriveNativeLiveProjection } from '../native/liveProjection';
import { actor, setup, key, H } from '../native/testing/liveFixture';

// Real authenticated collector HTTP routes + venue parser + native command
// and replay. Only the upstream public venue and repository are synthetic.
describe.each(['QNTUSDT', 'AKEUSDT', 'ETHUSDT'])('%s historical entry / current valuation', symbol => {
  const network = global.fetch;
  const entry = '61.08', current = '264.51';
  let runtime: ReturnType<typeof collectorServer>;
  let market: PrivateTradingMarketData;
  let f: ReturnType<typeof setup>;
  let service: NativeDemoService;
  let paths: string[];
  let tickerOffline: boolean, quoteOffline: boolean, allStale: boolean, malformedTier: boolean;
  let marksFailure: 'http' | 'network' | undefined, tickerAge: number, tickerReads: number;
  beforeEach(async () => {
    f = setup({ price: current }); paths = [];
    tickerOffline = quoteOffline = allStale = malformedTier = false;
    marksFailure = undefined; tickerAge = 100; tickerReads = 0;
    jest.spyOn(Date, 'now').mockImplementation(f.clock.now);
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const u = new URL(String(input)), endpoint = u.pathname.split('/').pop();
      expect(u.hostname).toBe('api.bybit.com');
      const age = endpoint === 'tickers' && tickerReads++ === 0 ? tickerAge : 100;
      const at = f.clock.now() - (allStale ? 61_000 : age);
      let result: unknown;
      if (endpoint === 'instruments-info') result = { category: 'linear', list: [{
        symbol, baseCoin: symbol.slice(0, -4), quoteCoin: 'USDT', settleCoin: 'USDT',
        contractType: 'LinearPerpetual', status: 'Trading', launchTime: '1577836800000', fundingInterval: 480,
        priceFilter: { tickSize: '0.01', minPrice: '0.01', maxPrice: '1000000' },
        lotSizeFilter: { qtyStep: '0.01', minOrderQty: '0.01', maxOrderQty: '2600', maxMktOrderQty: '520', minNotionalValue: '5' },
        leverageFilter: { minLeverage: '1', maxLeverage: '75', leverageStep: '0.01' },
      }] };
      else if (endpoint === 'risk-limit') result = { category: 'linear', list:
        ['5000', '7000', '10000', '12000', '14000'].map((limit, i) => ({
          symbol, riskLimitValue: limit, maintenanceMargin: i < 4 ? '0.01' : '0.015',
          initialMargin: '0.02', isLowestRisk: i === 0 ? 1 : 0, maxLeverage: '50',
          mmDeduction: i < 4 || malformedTier ? '' : '60',
        })) };
      else if (endpoint === 'tickers') result = { category: 'linear', list: [{ symbol,
        markPrice: current, lastPrice: current, fundingRate: '0.0001', nextFundingTime: String(f.clock.now() + H),
      }] };
      else if (endpoint === 'orderbook') result = { s: symbol, b: [['264.50', '100']], a: [['264.52', '100']], ts: at, cts: at };
      else if (endpoint === 'kline') result = { category: 'linear', symbol,
        list: [[String(Math.floor(Number(u.searchParams.get('end')) / H) * H), entry, entry, entry, entry, '100']] };
      else throw new Error(`Unexpected venue endpoint ${endpoint}`);
      return new Response(JSON.stringify({ retCode: 0, time: at, result }));
    });
    const feed = new LiveFeed('thin-contract-test', f.clock.now); feed.status = 'live';
    feed.rows.set(symbol, { id: symbol, marketType: 'linear_perpetual', providerSymbol: symbol,
      markPrice: 200, lastPrice: 200, stale: false, providerEventAt: f.clock.now() - 59_000,
      receivedAt: f.clock.now() - 59_000 } as any);
    runtime = collectorServer(feed, 'synthetic-test-only', () => ({}));
    await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const request: typeof fetch = async (input, options) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path.endsWith('/marks') && marksFailure) {
        if (marksFailure === 'network') throw new TypeError('fetch failed');
        return new Response('{}', { status: 503 });
      }
      if (tickerOffline && path.includes('/ticker/')) return new Response('{}', { status: 503 });
      if (quoteOffline && path.includes('/quote/')) return new Response('{}', { status: 503 });
      return network(input, options);
    };
    market = new PrivateTradingMarketData({ collector: { url, token: 'synthetic-test-only' }, request, now: f.clock.now });
    service = new NativeDemoService(f.repo, market, f.clock.now);
    await service.initialize(actor, key());
  });
  afterEach(async () => {
    await new Promise<void>(resolve => runtime.server.close(() => resolve()));
    runtime.close(); jest.restoreAllMocks();
  });
  const open = () => service.command(actor, { kind: 'OPEN', idempotencyKey: key(), symbol,
    side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'CROSS', executionMode: 'HISTORICAL_DEMO',
    candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: Math.floor((f.clock.now() - 24 * H) / H) * H, pricePoint: 'OPEN' },
  });
  test.each([false, true])('aged marks, ticker unavailable=%s: old entry, fresh valuation, restart', async fallback => {
    tickerOffline = fallback;
    await open();
    const p = f.repo.row!.snapshot.positions[0];
    expect(p.entryPrice).toBe(entry); expect(p.markPrice).toBe(current); expect(p.status).toBe('OPEN');
    expect(paths).toContain(`/internal/v1/private-trading/ticker/${symbol}`);
    expect(paths.includes(`/internal/v1/private-trading/quote/${symbol}`)).toBe(fallback);
    Object.assign(f.repo, { live: async () => deriveNativeLiveProjection(f.repo.row!) });
    f.clock.t += 2000; // the old frame is now outside even the display lifetime
    const loaded = await new NativeDemoService(f.repo, market, f.clock.now).live(actor);
    expect(loaded.positions[0].entryPrice).toBe(entry); expect(loaded.positions[0].markPrice).toBe(current);
  });
  test.each(['http', 'network'] as const)('marks %s failure still opens using authenticated current ticker', async failure => {
    marksFailure = failure;
    await open();
    expect(f.repo.commits).toBe(1);
    expect(f.repo.row!.snapshot.positions[0]).toMatchObject({ entryPrice: entry, markPrice: current, status: 'OPEN' });
    expect(paths.filter(p => /\/(marks|ticker|quote)(\/|$)/.test(p))).toEqual([
      '/internal/v1/private-trading/marks', `/internal/v1/private-trading/ticker/${symbol}`,
    ]);
  });
  test.each([45_001, 50_000, 60_000])('ticker age %s must fall through to fresh quote before committing', async age => {
    tickerAge = age;
    await open();
    expect(f.repo.commits).toBe(1);
    expect(f.repo.row!.snapshot.positions[0]).toMatchObject({ entryPrice: entry, markPrice: current, status: 'OPEN' });
    expect(paths).toContain(`/internal/v1/private-trading/quote/${symbol}`);
  });
  test('headroom-insufficient ticker and unavailable quote never persist', async () => {
    tickerAge = 50_000; quoteOffline = true;
    const before = structuredClone(f.repo.row);
    await expect(open()).rejects.toMatchObject({ code: 'near_live_price_unavailable' });
    expect(f.repo.row).toEqual(before); expect(f.repo.commits).toBe(0);
  });
  test.each(['stale', 'unavailable', 'including-marks'])('all current sources %s: refuses without any financial persistence', async mode => {
    allStale = mode === 'stale';
    tickerOffline = quoteOffline = mode !== 'stale';
    if (mode === 'including-marks') marksFailure = 'http';
    const before = structuredClone(f.repo.row);
    await expect(open()).rejects.toMatchObject({ code: 'near_live_price_unavailable' });
    expect(f.repo.row).toEqual(before); expect(f.repo.commits).toBe(0);
  });
  test('invalid nonzero deduction still refuses at instrument, as production did before this fix', async () => {
    malformedTier = true;
    const before = structuredClone(f.repo.row);
    await expect(open()).rejects.toMatchObject({ code: 'collector_unavailable' });
    expect(paths).toEqual([`/internal/v1/private-trading/instruments/${symbol}`]);
    expect(f.repo.row).toEqual(before); expect(f.repo.commits).toBe(0);
  });
});
