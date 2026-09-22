import requestApp from 'supertest';
import { collectorServer } from '../../services/marketData/live/collectorServer';
import { LiveFeed } from '../../services/marketData/live/contract';
import { assertPrivateFreshQuote, CollectorPrivateTradingSource, PrivateTradingMarketData, PrivateInstrument,
  PrivateFreshQuote, PRIVATE_QUOTE_MAX_AGE_MS, PRIVATE_MARKS_MAX, liveMarks } from '../marketData';
import type { LiveTicker } from '../../services/marketData/bybit/types';

const NOW = Date.UTC(2026, 8, 14, 12);
const HOUR = 3_600_000;
const response = (body: unknown) => ({ ok: true, json: async () => body } as Response);
const instrument = (): PrivateInstrument => ({
  provider: 'bybit', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT',
  contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: NOW,
  fundingIntervalMinutes: 480, filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001',
    minOrderQty: '0.001', maxOrderQty: '100', maxMarketOrderQty: '10', minNotionalValue: '5' },
  leverage: { min: '1', max: '100', step: '0.01' }, riskTiers: [{ riskLimitValue: '1000000', maintenanceMarginRate: '0.005',
    initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }],
  parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'bybit-current-test',
});
const quote = (): PrivateFreshQuote => ({ provider: 'bybit', symbol: 'BTCUSDT',
  bids: [{ price: '99.9', quantity: '2' }, { price: '99.8', quantity: '1.123456789123456789' }],
  asks: [{ price: '100', quantity: '0.5' }, { price: '100.1', quantity: '3' }], markPrice: '99.95', lastPrice: '100',
  fundingRate: '0.0001', nextFundingTime: NOW + 4 * HOUR, providerTimestamp: NOW - 100, bookGeneratedAt: NOW - 50,
  markProviderTimestamp: NOW - 50, fetchedAt: NOW });
const api = (request: jest.Mock, now: () => number = () => NOW) => new PrivateTradingMarketData({ collector: {
  url: 'https://collector.example', token: 'private-test-token' }, request, now });
const candle = (timestamp: number) => ({ timestamp, open: '100', high: '105', low: '95', close: '101' });

describe('private selected-contract transport', () => {
  test.each(['', 'http://public.example', 'https://user:pass@collector.example', 'https://collector.example/sub',
    'https://collector.example/?other=1', 'https://collector.example/#fragment'])('rejects collector credential leakage: %s', url => {
    const request = jest.fn();
    expect(() => new PrivateTradingMarketData({ collector: { url, token: 'test' }, request })).toThrow('collector_unconfigured');
    expect(request).not.toHaveBeenCalled();
  });
  test('requires nonempty server collector token', () => {
    expect(() => new PrivateTradingMarketData({ collector: { url: 'https://collector.example', token: ' ' } })).toThrow();
  });
  test('uses only authenticated exact-symbol collector path, no public/cache fallback', async () => {
    const request = jest.fn().mockResolvedValueOnce(response(quote())).mockRejectedValueOnce(new Error('offline'));
    const service = api(request);
    const value = await service.freshQuote('BTC-USDT');
    expect(value.bids[1].quantity).toBe('1.123456789123456789');
    expect(request).toHaveBeenCalledWith('https://collector.example/internal/v1/private-trading/quote/BTCUSDT',
      expect.objectContaining({ headers: { Authorization: 'Bearer private-test-token' }, redirect: 'error', signal: expect.any(AbortSignal) }));
    await expect(service.freshQuote('BTCUSDT')).rejects.toThrow('offline');
    expect(request.mock.calls.every(([url]) => String(url).startsWith('https://collector.example/internal/v1/private-trading/'))).toBe(true);
  });
  test('a frame row past the command headroom is re-read from the ticker route first; a collector without it falls back to the live quote', async () => {
    const path = (request: jest.Mock) => request.mock.calls.map(([url]) => new URL(String(url)).pathname);
    const frame = (age: number) => response({ status: 'live', fetchedAt: NOW, marks: [{ symbol: 'AKEUSDT', markPrice: '0.05', lastPrice: '0.05', markProviderTimestamp: NOW - age, receivedAt: NOW - age, fetchedAt: NOW }] });
    const ticker = { symbol: 'AKEUSDT', markPrice: '0.0527148', lastPrice: '0.052718', markProviderTimestamp: NOW - 200, receivedAt: NOW, fetchedAt: NOW };
    // Fifty seconds old: still a valuation price, but short of the 15 s commit headroom a command needs.
    const withTicker = jest.fn(async (url: string) => url.includes('/marks?') ? frame(50_000) : url.includes('/ticker/AKEUSDT') ? response(ticker) : ({ ok: false, status: 404 } as Response));
    expect((await api(withTicker).historicalDemoPrices(['AKEUSDT'], undefined, 0)).get('AKEUSDT')!.markPrice).toBe('0.05');
    expect((await api(withTicker).historicalDemoPrices(['AKEUSDT'], undefined, 15_000)).get('AKEUSDT')).toEqual(ticker);
    expect(path(withTicker)).toEqual(['/internal/v1/private-trading/marks', '/internal/v1/private-trading/marks', '/internal/v1/private-trading/ticker/AKEUSDT']);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A collector built before the ticker route answers 404: the live-book quote is still tried, as before.
      const q = { ...quote(), symbol: 'AKEUSDT' };
      const withoutTicker = jest.fn(async (url: string) => url.includes('/marks?') ? frame(50_000) : url.includes('/quote/AKEUSDT') ? response(q) : ({ ok: false, status: 404 } as Response));
      expect((await api(withoutTicker).historicalDemoPrices(['AKEUSDT'], undefined, 15_000)).get('AKEUSDT')).toEqual({ symbol: 'AKEUSDT', markPrice: q.markPrice, lastPrice: q.lastPrice,
        markProviderTimestamp: Math.min(q.markProviderTimestamp, q.providerTimestamp), receivedAt: q.fetchedAt, fetchedAt: q.fetchedAt });
      expect(path(withoutTicker)).toEqual(['/internal/v1/private-trading/marks', '/internal/v1/private-trading/ticker/AKEUSDT', '/internal/v1/private-trading/quote/AKEUSDT']);
      expect(warn).not.toHaveBeenCalled();
      // Neither read answering leaves the symbol unpriced, with both reasons on record for the logs.
      const neither = jest.fn(async (url: string) => url.includes('/marks?') ? frame(50_000) : ({ ok: false, status: 503 } as Response));
      expect((await api(neither).historicalDemoPrices(['AKEUSDT'], undefined, 15_000)).has('AKEUSDT')).toBe(false);
      expect(warn).toHaveBeenCalledWith('[private-trading] near-live price unavailable', 'AKEUSDT', 'collector_unavailable then collector_unavailable');
    } finally { warn.mockRestore(); }
  });
  test.each(['BTCUSD', 'BTCUSDC', '../BTCUSDT', 'BTCUSDT?x=1', 'BTCUSDT#x', 'BTC USDT'])('rejects nonperpetual and injection symbols %s', async value => {
    const request = jest.fn(); await expect(api(request).freshQuote(value)).rejects.toThrow('invalid_symbol'); expect(request).not.toHaveBeenCalled();
  });
  test('cancellation reaches collector request and releases no cached fallback', async () => {
    const controller = new AbortController(); controller.abort(); const request = jest.fn();
    await expect(api(request).freshQuote('BTCUSDT', controller.signal)).rejects.toThrow('request_cancelled'); expect(request).not.toHaveBeenCalled();
  });
  test('wrong instrument identity/status/freshness cannot become executable', async () => {
    for (const change of [{ symbol: 'ETHUSDT' }, { status: 'PreLaunch' }, { fetchedAt: NOW - 66_000 }, { settleAsset: 'USDC' }]) {
      await expect(api(jest.fn().mockResolvedValue(response({ ...instrument(), ...change }))).instrument('BTCUSDT')).rejects.toThrow();
    }
  });
});

describe('quote is rechecked at final financial write', () => {
  test('fresh exact bid/ask depth is eligible, expired snapshot fails without modification', () => {
    const value = quote(); expect(assertPrivateFreshQuote(value, 'BTC-USDT', NOW)).toEqual(value);
    expect(() => assertPrivateFreshQuote(value, 'BTCUSDT', NOW + PRIVATE_QUOTE_MAX_AGE_MS)).toThrow('quote_stale');
    expect(value.fetchedAt).toBe(NOW);
  });
  test.each(['providerTimestamp', 'bookGeneratedAt', 'markProviderTimestamp', 'fetchedAt'] as const)('rejects stale or future %s', field => {
    expect(() => assertPrivateFreshQuote({ ...quote(), [field]: NOW - 5_001 }, 'BTCUSDT', NOW)).toThrow('quote_stale');
    expect(() => assertPrivateFreshQuote({ ...quote(), [field]: NOW + 1_001 }, 'BTCUSDT', NOW)).toThrow('quote_stale');
  });
  test.each([null, '', '0', '-1', 'NaN', 'Infinity', '1e6', 123])('rejects malformed mark %s', value => {
    expect(() => assertPrivateFreshQuote({ ...quote(), markPrice: value }, 'BTCUSDT', NOW)).toThrow();
  });
  test('rejects missing sides, crossing, duplicate, unordered and nonpositive depth', () => {
    const changes = [{ asks: [] }, { bids: [] }, { bids: [{ price: '100', quantity: '1' }] },
      { asks: [{ price: '100', quantity: '1' }, { price: '100', quantity: '2' }] },
      { bids: [{ price: '99', quantity: '1' }, { price: '99.8', quantity: '1' }] },
      { asks: [{ price: '100', quantity: '0' }] }, { symbol: 'ETHUSDT' }];
    for (const change of changes) expect(() => assertPrivateFreshQuote({ ...quote(), ...change }, 'BTCUSDT', NOW)).toThrow();
  });
});

describe('collector public venue adapter', () => {
  const publicInstrument = () => ({ retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', settleCoin: 'USDT',
    status: 'Trading', contractType: 'LinearPerpetual', launchTime: String(Date.UTC(2020, 0, 1)), fundingInterval: 480,
    priceFilter: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000' },
    lotSizeFilter: { minOrderQty: '0.001', qtyStep: '0.001', maxOrderQty: '100', maxMktOrderQty: '10', minNotionalValue: '5' },
    leverageFilter: { minLeverage: '1', maxLeverage: '100', leverageStep: '0.01' } }] } });
  const risk = () => ({ retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', riskLimitValue: '1000000', maintenanceMargin: 0.005,
    initialMargin: 0.01, mmDeduction: '0', maxLeverage: '100' }], nextPageCursor: '' } });
  test('loads actual contract filters and versioned current tiers; metadata cache does not alter raw decimals', async () => {
    const request = jest.fn().mockResolvedValueOnce(response(publicInstrument())).mockResolvedValueOnce(response(risk()));
    const service = new CollectorPrivateTradingSource(request, () => NOW);
    const value = await service.instrument('BTCUSDT');
    expect(value.filters.qtyStep).toBe('0.001'); expect(value.riskTiers[0].maintenanceMarginRate).toBe('0.005');
    expect(value.parameterModel).toBe('CURRENT_INSTRUMENT_PARAMETERS'); expect(value.parameterVersion).toMatch(/^bybit-current-[a-f0-9]+$/);
    value.filters.qtyStep = '999'; expect((await service.instrument('BTCUSDT')).filters.qtyStep).toBe('0.001'); expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([url, init]) => new URL(url).hostname === 'api.bybit.com' && !init.headers && init.redirect === 'error')).toBe(true);
  });
  test('missing market lot limits are rejected instead of defaulting to BTC values', async () => {
    const payload = publicInstrument(); delete (payload.result.list[0].lotSizeFilter as any).maxMktOrderQty;
    const service = new CollectorPrivateTradingSource(jest.fn().mockResolvedValueOnce(response(payload)).mockResolvedValueOnce(response(risk())), () => NOW);
    await expect(service.instrument('BTCUSDT')).rejects.toThrow();
  });
  test('accepts the documented live BTC lowest-tier empty deduction without changing higher-tier economics', async () => {
    const tiers = { retCode: 0, result: { category: 'linear', nextPageCursor: '', list: [
      { symbol: 'BTCUSDT', riskLimitValue: '300000', maintenanceMargin: '0.0033', initialMargin: '0.0066', isLowestRisk: 1, maxLeverage: '150.00', mmDeduction: '' },
      { symbol: 'BTCUSDT', riskLimitValue: '2000000', maintenanceMargin: '0.005', initialMargin: '0.01', isLowestRisk: 0, maxLeverage: '100.00', mmDeduction: '510' },
    ] } };
    const service = new CollectorPrivateTradingSource(jest.fn().mockResolvedValueOnce(response(publicInstrument())).mockResolvedValueOnce(response(tiers)), () => NOW);
    const value = await service.instrument('BTCUSDT');
    expect(value.riskTiers.map(t => t.maintenanceDeduction)).toEqual(['0', '510']);
    expect(value.riskTiers.map(t => t.maintenanceMarginRate)).toEqual(['0.0033', '0.005']);
  });
  test.each([undefined, null, '', 'NaN'])('does not turn missing or malformed unflagged tier deduction %s into zero', async deduction => {
    const payload = risk(); (payload.result.list[0] as any).mmDeduction = deduction;
    const service = new CollectorPrivateTradingSource(jest.fn().mockResolvedValueOnce(response(publicInstrument())).mockResolvedValueOnce(response(payload)), () => NOW);
    await expect(service.instrument('BTCUSDT')).rejects.toThrow('market_data_invalid');
  });
  test('does not accept blank higher-tier deduction even if upstream lowest flag is malformed', async () => {
    const payload = risk(); payload.result.list.push({ ...payload.result.list[0], riskLimitValue: '2000000', mmDeduction: '', isLowestRisk: 1 } as any);
    const service = new CollectorPrivateTradingSource(jest.fn().mockResolvedValueOnce(response(publicInstrument())).mockResolvedValueOnce(response(payload)), () => NOW);
    await expect(service.instrument('BTCUSDT')).rejects.toThrow('market_data_invalid');
  });
  test('risk cursor cycles and wrong-product rows fail bounded', async () => {
    const payload = risk(); payload.result.nextPageCursor = 'same';
    const request = jest.fn().mockResolvedValueOnce(response(publicInstrument())).mockResolvedValue(response(payload));
    await expect(new CollectorPrivateTradingSource(request, () => NOW).instrument('BTCUSDT')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
  test('selected fresh source uses engine timestamp and simultaneous ticker mark, never catalogue ticker', async () => {
    const value = quote(); const request = jest.fn(async (url: string) => response(url.includes('/orderbook?') ? {
      retCode: 0, result: { s: 'BTCUSDT', b: value.bids.map(l => [l.price, l.quantity]), a: value.asks.map(l => [l.price, l.quantity]), ts: NOW, cts: NOW - 100 },
    } : { retCode: 0, time: NOW, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', markPrice: '99.95', lastPrice: '100', fundingRate: '0.0001', nextFundingTime: String(NOW + HOUR) }] } }));
    const result = await new CollectorPrivateTradingSource(request as typeof fetch, () => NOW).freshQuote('BTCUSDT');
    expect(result.providerTimestamp).toBe(NOW - 100); expect(result.markProviderTimestamp).toBe(NOW);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls.every(([url]) => new URL(url).searchParams.get('symbol') === 'BTCUSDT')).toBe(true);
  });
  test('one ticker read prices the sampled demo without a book: mark, last and the venue time', async () => {
    const venue = (time: number) => jest.fn(async (_url: string) => response({ retCode: 0, time, result: { category: 'linear', list: [{ symbol: 'AKEUSDT', markPrice: '0.0527148', lastPrice: '0.052718' }] } }));
    const request = venue(NOW - 300);
    expect(await new CollectorPrivateTradingSource(request as typeof fetch, () => NOW).ticker('AKEUSDT')).toEqual({ symbol: 'AKEUSDT', markPrice: '0.0527148', lastPrice: '0.052718', markProviderTimestamp: NOW - 300, receivedAt: NOW, fetchedAt: NOW });
    expect(request).toHaveBeenCalledTimes(1);
    const url = new URL(String(request.mock.calls[0][0])); expect(url.pathname).toBe('/v5/market/tickers'); expect(url.searchParams.get('symbol')).toBe('AKEUSDT');
    // A ticker the venue stamped beyond the 60 s sampled-demo contract is refused, not aged through.
    await expect(new CollectorPrivateTradingSource(venue(NOW - 61_000) as typeof fetch, () => NOW).ticker('AKEUSDT')).rejects.toThrow('near_live_price_stale');
    await expect(new CollectorPrivateTradingSource(venue(NOW) as typeof fetch, () => NOW).ticker('BTCUSDT')).rejects.toThrow('market_data_invalid');
  });
  test('normalizes reverse venue candles and excludes out-of-range records', async () => {
    const start = NOW - 2 * HOUR;
    const request = jest.fn().mockResolvedValue(response({ retCode: 0, result: { category: 'linear', symbol: 'BTCUSDT', list: [[String(start), '100', '105', '95', '101']] } }));
    const source = new CollectorPrivateTradingSource(request, () => NOW);
    expect((await source.candles('BTCUSDT', 'mark', 60, start, start + HOUR - 1)).candles).toEqual([candle(start)]);
    await expect(source.candles('BTCUSDT', 'trade', 60, start + HOUR, NOW - 1)).rejects.toThrow();
  });
});

describe('bounded historical replay input', () => {
  const historicalRequest = (mutate?: (kind: string, rows: any[]) => any[]) => jest.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.includes('/instruments/')) return response(instrument());
    const start = Number(url.searchParams.get('startTime')), end = Number(url.searchParams.get('endTime'));
    if (url.pathname.includes('/funding/')) {
      const events = []; for (let ts = Math.ceil(start / (8 * HOUR)) * 8 * HOUR; ts <= end; ts += 8 * HOUR) events.push({ timestamp: ts, rate: '-0.0001' });
      return response({ symbol: 'BTCUSDT', fetchedAt: NOW, events: mutate ? mutate('funding', events) : events });
    }
    const interval = Number(url.searchParams.get('intervalMinutes')) * 60_000;
    const rows = []; for (let ts = start; ts <= end; ts += interval) rows.push(candle(ts));
    return response({ symbol: 'BTCUSDT', fetchedAt: NOW, candles: (mutate ? mutate(url.searchParams.get('kind')!, rows) : rows).reverse() });
  });
  test('replays full aligned path with separate mark history and exact funding-time mark open', async () => {
    const start = Date.UTC(2026, 8, 13, 7), end = start + 2 * HOUR, request = historicalRequest();
    const result = await api(request).history({ symbol: 'BTCUSDT', startTime: start, endTime: end, intervalMinutes: 60 });
    expect(result.complete).toBe(true); expect(result.tradeCandles).toEqual([candle(start), candle(start + HOUR)]);
    expect(result.markCandles).toHaveLength(2); expect(result.fundingEvents).toEqual([{ timestamp: start + HOUR, rate: '-0.0001', markPrice: '100' }]);
    expect(result.expectedFundingTimestamps).toEqual([start + HOUR]); expect(result.fundingScheduleModel).toBe('CURRENT_INTERVAL_GRID_V1');
  });
  test('pagination includes more than 1000 candles without dropping first page or extending range', async () => {
    const start = Date.UTC(2026, 8, 10, 1), end = start + 1001 * 60_000, request = historicalRequest(), progress = jest.fn();
    const result = await api(request).history({ symbol: 'BTCUSDT', startTime: start, endTime: end, onProgress: progress });
    expect(result.tradeCandles).toHaveLength(1001); expect(result.markCandles).toHaveLength(1001); expect(result.complete).toBe(true);
    expect(request.mock.calls.filter(([url]) => url.includes('/candles/'))).toHaveLength(4); expect(progress).toHaveBeenCalledWith({ stage: 'trade', pages: 2, rows: 1001 });
  });
  test.each(['trade', 'mark', 'funding'])('missing %s history is incomplete, never invented', async missing => {
    const start = Date.UTC(2026, 8, 13, 7);
    const result = await api(historicalRequest((kind, rows) => kind === missing ? [] : rows)).history({ symbol: 'BTCUSDT', startTime: start, endTime: start + 2 * HOUR, intervalMinutes: 60 });
    expect(result.complete).toBe(false); expect(result.issues).toContain(`${missing}_history_gap`);
    if (missing === 'mark') expect(result.fundingEvents).toHaveLength(0);
  });
  test('duplicate OHLC timestamps and internally malformed candles are rejected', async () => {
    const start = Date.UTC(2026, 8, 13, 1);
    for (const modify of [(rows: any[]) => [...rows, rows[0]], (rows: any[]) => [{ ...rows[0], high: '90' }]]) {
      await expect(api(historicalRequest((kind, rows) => kind === 'trade' ? modify(rows) : rows)).history({ symbol: 'BTCUSDT', startTime: start, endTime: start + HOUR, intervalMinutes: 60 })).rejects.toThrow();
    }
  });
  test('history before contract launch is rejected before candle requests', async () => {
    const value = instrument(); value.launchTime = NOW - HOUR;
    const request = jest.fn().mockResolvedValue(response(value));
    await expect(api(request).history({ symbol: 'BTCUSDT', startTime: NOW - 2 * HOUR, endTime: NOW - HOUR, intervalMinutes: 60 })).rejects.toThrow('contract_not_launched');
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('future, unaligned, oversized or unsupported range never triggers network requests', async () => {
    const request = jest.fn(), service = api(request);
    for (const patch of [{ startTime: NOW - HOUR + 1 }, { endTime: NOW + HOUR }, { startTime: NOW - 100 * 24 * HOUR }, { intervalMinutes: 7 }]) {
      await expect(service.history({ symbol: 'BTCUSDT', startTime: NOW - HOUR, endTime: NOW, ...patch } as any)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  test('cancellation stops pagination and permits subsequent history job', async () => {
    const controller = new AbortController(), request = historicalRequest(), service = api(request), start = NOW - 2 * HOUR;
    await expect(service.history({ symbol: 'BTCUSDT', startTime: start, endTime: NOW - HOUR, intervalMinutes: 60,
      signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow('request_cancelled');
    expect(request.mock.calls.filter(([url]) => url.includes('/candles/'))).toHaveLength(1);
    await expect(service.history({ symbol: 'BTCUSDT', startTime: start, endTime: NOW - HOUR, intervalMinutes: 60 })).resolves.toMatchObject({ complete: true });
  });
  test('only one expensive replay request runs at a time', async () => {
    let release!: (value: unknown) => void;
    const request = jest.fn().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const service = api(request), first = service.history({ symbol: 'BTCUSDT', startTime: NOW - HOUR, endTime: NOW, intervalMinutes: 60 });
    await expect(service.history({ symbol: 'BTCUSDT', startTime: NOW - HOUR, endTime: NOW, intervalMinutes: 60 })).rejects.toThrow('history_busy');
    release(response({})); await expect(first).rejects.toThrow();
  });
  test('standalone settled funding obtains historical marks and preserves negative rates', async () => {
    const start = Date.UTC(2026, 8, 13, 7), end = start + 2 * HOUR;
    const result = await api(historicalRequest()).funding('BTCUSDT', start, end);
    expect(result).toMatchObject({ complete: true, events: [{ timestamp: start + HOUR, rate: '-0.0001', markPrice: '100' }] });
  });
});

test('all collector private-data endpoints require token, reject invalid ranges, and send no-store', async () => {
  const runtime = collectorServer(new LiveFeed('private-test'), 'test-token', () => ({}));
  const get = jest.spyOn(CollectorPrivateTradingSource.prototype, 'instrument').mockResolvedValue(instrument());
  try {
    for (const endpoint of ['instruments', 'quote', 'ticker', 'candles', 'funding']) {
      await requestApp(runtime.app).get(`/internal/v1/private-trading/${endpoint}/BTCUSDT`).expect(401);
    }
    expect(get).not.toHaveBeenCalled();
    const result = await requestApp(runtime.app).get('/internal/v1/private-trading/instruments/BTCUSDT').set('Authorization', 'Bearer test-token').expect(200);
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.body.symbol).toBe('BTCUSDT');
    const ticker = jest.spyOn(CollectorPrivateTradingSource.prototype, 'ticker').mockResolvedValue({ symbol: 'BTCUSDT', markPrice: '99.95', lastPrice: '100', markProviderTimestamp: NOW, receivedAt: NOW, fetchedAt: NOW });
    try {
      const priced = await requestApp(runtime.app).get('/internal/v1/private-trading/ticker/BTCUSDT').set('Authorization', 'Bearer test-token').expect(200);
      expect(priced.body).toMatchObject({ symbol: 'BTCUSDT', markPrice: '99.95', lastPrice: '100' }); expect(ticker).toHaveBeenCalledWith('BTCUSDT', expect.any(AbortSignal));
    } finally { ticker.mockRestore(); }
    await requestApp(runtime.app).get('/internal/v1/private-trading/candles/BTCUSDT?kind=bad').set('Authorization', 'Bearer test-token').expect(400);
    await requestApp(runtime.app).get('/internal/v1/private-trading/funding/BTCUSDT?startTime=0&endTime=1').set('Authorization', 'Bearer test-token').expect(400);
  } finally { get.mockRestore(); runtime.close(); }
});

describe('marks of many contracts from the collector live frame', () => {
  const row = (over: Partial<LiveTicker> & { providerSymbol: string }): LiveTicker => ({
    id: `linear_perpetual:${over.providerSymbol}`, pair: `${over.providerSymbol.replace(/USDT$/, '')}/USDT`, symbol: over.providerSymbol, provider: 'bybit',
    marketType: 'linear_perpetual', baseAsset: over.providerSymbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT',
    lastPrice: 100, bidPrice: 99.9, askPrice: 100.1, high24h: 101, low24h: 99, volume24h: 1, quoteVolume24h: 100, changePercent24h: 0,
    indexPrice: 100, markPrice: 99.95, fundingRate: 0.0001, openInterest: 1, openInterestValue: 100, fundingIntervalMinutes: 480,
    providerEventAt: NOW - 120, sequence: 1, receivedAt: NOW - 100, fetchedAt: NOW - 100, stale: false, ...over,
  } as LiveTicker);
  test('liveMarks answers only current linear rows of the requested contracts, with exact decimals and the venue event time', () => {
    const rows = [
      row({ providerSymbol: 'BTCUSDT', markPrice: 50000.1, lastPrice: 50000.2 }),
      row({ providerSymbol: 'ETHUSDT', providerEventAt: null }),                              // falls back to the collector's receive time
      row({ providerSymbol: 'SOLUSDT', stale: true }),                                        // held as stale: absent, never served as current
      row({ providerSymbol: 'XRPUSDT', markPrice: null }),                                    // no mark: absent
      row({ providerSymbol: 'DOGEUSDT' }),                                                    // not requested
      { ...row({ providerSymbol: 'BTCUSDT', markPrice: 1 }), marketType: 'spot', id: 'spot:BTCUSDT' } as LiveTicker, // another market type, same symbol
    ];
    const page = liveMarks(rows, ['BTCUSDT', 'ETH-USDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'], NOW, 'live');
    expect(page.status).toBe('live'); expect(page.fetchedAt).toBe(NOW);
    expect(page.marks).toEqual([
      { symbol: 'BTCUSDT', markPrice: '50000.1', lastPrice: '50000.2', markProviderTimestamp: NOW - 120, receivedAt: NOW - 100, fetchedAt: NOW },
      { symbol: 'ETHUSDT', markPrice: '99.95', lastPrice: '100', markProviderTimestamp: NOW - 100, receivedAt: NOW - 100, fetchedAt: NOW },
    ]);
    expect(() => liveMarks(rows, [], NOW, 'live')).toThrow('invalid_symbol');
    expect(() => liveMarks(rows, ['btc'], NOW, 'live')).toThrow('invalid_symbol');
    expect(() => liveMarks(rows, Array.from({ length: PRIVATE_MARKS_MAX + 1 }, (_, i) => `S${i}USDT`), NOW, 'live')).toThrow('invalid_symbol');
  });
  test('the API client asks the collector once for all symbols and keeps only marks inside the freshness window', async () => {
    const request = jest.fn().mockResolvedValue(response({ status: 'live', fetchedAt: NOW, marks: [
      { symbol: 'BTCUSDT', markPrice: '50000.1', lastPrice: '50000.2', markProviderTimestamp: NOW - 200, receivedAt: NOW - 150, fetchedAt: NOW },
      { symbol: 'ETHUSDT', markPrice: '3000', lastPrice: '3001', markProviderTimestamp: NOW - PRIVATE_QUOTE_MAX_AGE_MS - 1, receivedAt: NOW - 100, fetchedAt: NOW },
    ] }));
    const marks = await api(request).marks(['BTC-USDT', 'ETHUSDT', 'BTCUSDT']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toBe('https://collector.example/internal/v1/private-trading/marks?symbols=BTCUSDT%2CETHUSDT');
    expect(request.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer private-test-token' });
    expect([...marks.keys()]).toEqual(['BTCUSDT']);                    // the stale ETH mark is absent, not old-but-served
    expect(marks.get('BTCUSDT')!.markPrice).toBe('50000.1');
    expect(await api(request).marks([])).toEqual(new Map()); expect(request).toHaveBeenCalledTimes(1);
  });
  test('an unrequested, duplicated or malformed mark makes the whole page invalid; too many symbols never reach the collector', async () => {
    const mark = { symbol: 'BTCUSDT', markPrice: '50000.1', lastPrice: '50000.2', markProviderTimestamp: NOW - 200, receivedAt: NOW - 150, fetchedAt: NOW };
    for (const marks of [[{ ...mark, symbol: 'ETHUSDT' }], [mark, mark], [{ ...mark, markPrice: '-1' }], [{ ...mark, markProviderTimestamp: 'x' }]]) {
      await expect(api(jest.fn().mockResolvedValue(response({ status: 'live', fetchedAt: NOW, marks }))).marks(['BTCUSDT'])).rejects.toThrow('market_data_invalid');
    }
    const request = jest.fn();
    await expect(api(request).marks(Array.from({ length: PRIVATE_MARKS_MAX + 1 }, (_, i) => `S${i}USDT`))).rejects.toThrow('invalid_symbol');
    expect(request).not.toHaveBeenCalled();
  });
  test('the collector route serves the frame it holds, requires the token, sends no-store, and refuses a bad list', async () => {
    const feed = new LiveFeed('private-test');
    feed.publish('snapshot', [row({ providerSymbol: 'BTCUSDT', markPrice: 50000.1 }), row({ providerSymbol: 'ETHUSDT', stale: true })]);
    const runtime = collectorServer(feed, 'test-token', () => ({}));
    try {
      await requestApp(runtime.app).get('/internal/v1/private-trading/marks?symbols=BTCUSDT').expect(401);
      const result = await requestApp(runtime.app).get('/internal/v1/private-trading/marks?symbols=BTCUSDT,ETHUSDT').set('Authorization', 'Bearer test-token').expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.marks.map((m: { symbol: string; markPrice: string }) => [m.symbol, m.markPrice])).toEqual([['BTCUSDT', '50000.1']]);
      await requestApp(runtime.app).get('/internal/v1/private-trading/marks').set('Authorization', 'Bearer test-token').expect(400);
      await requestApp(runtime.app).get('/internal/v1/private-trading/marks?symbols=btc').set('Authorization', 'Bearer test-token').expect(400);
    } finally { runtime.close(); }
  });
});
