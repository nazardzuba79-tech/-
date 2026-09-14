import requestApp from 'supertest';
import { CollectorPrivateTradingSource, PrivateTradingMarketData, PrivateChartInterval, PrivateInstrument, privateChartIntervalMs } from '../marketData';
import { collectorServer } from '../../services/marketData/live/collectorServer';
import { LiveFeed } from '../../services/marketData/live/contract';

const NOW = Date.UTC(2026, 8, 14, 12), HOUR = 3_600_000;
const response = (body: unknown) => ({ ok: true, json: async () => body } as Response);
const instrument = (): PrivateInstrument => ({ provider: 'bybit', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT',
  status: 'Trading', contractType: 'LinearPerpetual', launchTime: Date.UTC(2020, 0, 1), fetchedAt: NOW, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '100', maxMarketOrderQty: '10', minNotionalValue: '5' },
  leverage: { min: '1', max: '100', step: '0.01' }, riskTiers: [{ riskLimitValue: '1000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }],
  parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'fixture' });
const candle = (timestamp: number) => ({ timestamp, open: '100.123456789123456789', high: '110', low: '90', close: '104.123456789123456789', volume: '7.125' });
const page = (candles: ReturnType<typeof candle>[], interval: PrivateChartInterval = '1h', extra: Record<string, unknown> = {}) =>
  ({ source: 'BYBIT_LINEAR', symbol: 'BTCUSDT', interval, candles, fetchedAt: NOW, providerTimestamp: NOW, ...extra });
const client = (fetcher: jest.Mock, now = () => NOW) => new PrivateTradingMarketData({ collector: { url: 'https://collector.example', token: 'private-test' }, request: fetcher, now });
const selection = (extra: Record<string, unknown> = {}) => ({ symbol: 'BTCUSDT', source: 'BYBIT_LINEAR' as const, interval: '1h' as const, openTime: NOW - HOUR, pricePoint: 'CLOSE' as const, ...extra });
const collectorRequest = (modify?: (result: any, url: URL) => any) => jest.fn(async (input: string) => {
  const url = new URL(input);
  if (url.pathname.includes('/instruments/')) return response(instrument());
  const interval = url.searchParams.get('interval') as PrivateChartInterval, step = privateChartIntervalMs(interval), count = Number(url.searchParams.get('limit'));
  const offset = interval === '1w' ? 345_600_000 : 0, end = Number(url.searchParams.get('endTime') ?? NOW);
  const latest = Math.floor((end - offset) / step) * step + offset;
  const result = page(Array.from({ length: count }, (_, i) => candle(latest - i * step)), interval);
  return response(modify ? modify(result, url) : result);
});

describe('private chart authenticated futures history', () => {
  test('numeric chart OHLCV uses exact contract/source and only the authenticated collector', async () => {
    const fetcher = collectorRequest(), result = await client(fetcher).chartCandles({ symbol: 'BTC-USDT', interval: '1h', limit: 3 });
    expect(result).toMatchObject({ symbol: 'BTCUSDT', source: 'BYBIT_LINEAR', interval: '1h' });
    expect(result.candles.map(c => c.time)).toEqual([(NOW - 2 * HOUR) / 1000, (NOW - HOUR) / 1000, NOW / 1000]);
    expect(result.candles[0].volume).toBe(7.125); expect(result.candles[0].close).toBe(Number('104.123456789123456789'));
    expect(fetcher).toHaveBeenCalledWith('https://collector.example/internal/v1/private-trading/chart-candles/BTCUSDT?interval=1h&limit=3',
      expect.objectContaining({ headers: { Authorization: 'Bearer private-test' }, redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  test('1500 bars use exactly two bounded pages with no repeated boundary or invented bar', async () => {
    const fetcher = collectorRequest(), result = await client(fetcher).chartCandles({ symbol: 'BTCUSDT', interval: '1m', limit: 1500, endTime: NOW - 1 });
    expect(result.candles).toHaveLength(1500); expect(new Set(result.candles.map(c => c.time)).size).toBe(1500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = new URL(fetcher.mock.calls[0][0]), second = new URL(fetcher.mock.calls[1][0]);
    expect(first.searchParams.get('limit')).toBe('1000'); expect(second.searchParams.get('limit')).toBe('500');
    expect(Number(second.searchParams.get('endTime'))).toBe(NOW - 1000 * 60000 - 1);
    expect(result.candles[0].time).toBe((NOW - 1500 * 60000) / 1000);
  });
  test.each(['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const)('supports %s with correctly aligned bar time', async interval => {
    const result = await client(collectorRequest()).chartCandles({ symbol: 'BTCUSDT', interval, limit: 2 });
    expect(result.candles).toHaveLength(2);
    expect((result.candles[1].time - result.candles[0].time) * 1000).toBe(privateChartIntervalMs(interval));
    if (interval === '1w') expect(new Date(result.candles[1].time * 1000).getUTCDay()).toBe(1);
  });
  test.each([{ interval: '1M' }, { limit: 1501 }, { limit: 0 }, { limit: 1.5 }, { endTime: NOW + 1 }, { endTime: -1 }, { symbol: 'BTCUSD' }])('rejects invalid range before network: %j', async patch => {
    const fetcher = collectorRequest(); await expect(client(fetcher).chartCandles({ symbol: 'BTCUSDT', interval: '1h', ...patch } as any)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  test.each([{ source: 'BYBIT_SPOT' }, { symbol: 'ETHUSDT' }, { interval: '4h' }, { providerTimestamp: NOW + 1001 }])('rejects chart response mismatch: %j', async mismatch => {
    await expect(client(collectorRequest(result => ({ ...result, ...mismatch }))).chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1 })).rejects.toThrow('market_data_invalid');
  });
  test('does not fill provider gaps or synthesize missing volume', async () => {
    const sparse = collectorRequest(result => ({ ...result, candles: [result.candles[0]] }));
    expect((await client(sparse).chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 3 })).candles).toHaveLength(1); expect(sparse).toHaveBeenCalledTimes(1);
    const missingVolume = collectorRequest(result => { delete result.candles[0].volume; return result; });
    await expect(client(missingVolume).chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1 })).rejects.toThrow('market_data_invalid');
  });
  test('rejects duplicate, misaligned or internally inconsistent OHLC', async () => {
    for (const change of [(r: any) => { r.candles.push(r.candles[0]); return r; }, (r: any) => { r.candles[0].timestamp++; return r; }, (r: any) => { r.candles[0].high = '50'; return r; }]) {
      await expect(client(collectorRequest(change)).chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 2 })).rejects.toThrow('market_data_invalid');
    }
  });
  test('live chart caching is brief; settled caching returns isolated copies', async () => {
    let clock = NOW; const fetcher = collectorRequest(), market = client(fetcher, () => clock);
    const request = { symbol: 'BTCUSDT', interval: '1h' as const, limit: 1 };
    const first = await market.chartCandles(request); first.candles[0].close = 999;
    expect((await market.chartCandles(request)).candles[0].close).not.toBe(999); expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 2001; await market.chartCandles(request); expect(fetcher).toHaveBeenCalledTimes(2);
    const historic = { ...request, endTime: NOW - HOUR - 1 };
    await market.chartCandles(historic); clock += 30000; await market.chartCandles(historic); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  test('aborted selection and cached chart calls return no stale result', async () => {
    const fetcher = collectorRequest(), market = client(fetcher), request = { symbol: 'BTCUSDT', interval: '1h' as const, limit: 1 };
    await market.chartCandles(request); const controller = new AbortController(); controller.abort();
    await expect(market.chartCandles({ ...request, signal: controller.signal })).rejects.toThrow('request_cancelled');
    await expect(market.resolveCandle({ ...selection(), signal: controller.signal })).rejects.toThrow('request_cancelled'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('chart cache is bounded across historical panning requests', async () => {
    const fetcher = collectorRequest(), market = client(fetcher);
    for (let i = 1; i <= 65; i++) await market.chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1, endTime: NOW - i * HOUR - 1 });
    await market.chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1, endTime: NOW - HOUR - 1 });
    expect(fetcher).toHaveBeenCalledTimes(66);
  });
  test('cancellation while a page returns prevents the next page and any result publication', async () => {
    const controller = new AbortController(), underlying = collectorRequest();
    const fetcher = jest.fn(async (url: string) => { const result = await underlying(url); controller.abort(); return result; });
    await expect(client(fetcher).chartCandles({ symbol: 'BTCUSDT', interval: '1m', limit: 1500, signal: controller.signal })).rejects.toThrow('request_cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('concurrent chart requests remain bounded and a rejected extra request makes no upstream call', async () => {
    const pending: Array<(result: Response) => void> = [], fetcher = jest.fn(() => new Promise<Response>(resolve => { pending.push(resolve); }));
    const market = client(fetcher), requests = Array.from({ length: 4 }, (_, i) => market.chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1, endTime: NOW - (i + 1) * HOUR - 1 }));
    await expect(market.chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1 })).rejects.toThrow('chart_busy');
    expect(fetcher).toHaveBeenCalledTimes(4); pending.forEach(resolve => resolve(response(page([]))));
    expect((await Promise.all(requests)).every(result => result.candles.length === 0)).toBe(true);
  });
});

describe('selected candle server resolution', () => {
  test.each(['OPEN', 'CLOSE'] as const)('resolves %s exact decimal price and its distinct effective boundary', async pricePoint => {
    const fetcher = collectorRequest(), result = await client(fetcher).resolveCandle({ ...selection(), pricePoint });
    expect(result).toMatchObject({ symbol: 'BTCUSDT', source: 'BYBIT_LINEAR', interval: '1h', intervalMs: HOUR, openTime: NOW - HOUR, closeTime: NOW,
      pricePoint, effectiveAt: pricePoint === 'OPEN' ? NOW - HOUR : NOW, verification: 'VERIFIED' });
    expect(result.price).toBe(pricePoint === 'OPEN' ? '100.123456789123456789' : '104.123456789123456789');
    expect(result.candle.timestamp).toBe(NOW - HOUR);
    expect(fetcher.mock.calls[1][0]).toContain(`limit=1&endTime=${NOW - 1}`);
  });
  test.each(['OPEN', 'CLOSE'] as const)('rejects current incomplete candle even for %s', async pricePoint => {
    const fetcher = collectorRequest(); await expect(client(fetcher).resolveCandle({ ...selection(), openTime: NOW, pricePoint })).rejects.toThrow('candle_not_closed'); expect(fetcher).not.toHaveBeenCalled();
  });
  test('provider clock must confirm completion; local time alone cannot finalize a cached forming close', async () => {
    const fetcher = collectorRequest(result => ({ ...result, providerTimestamp: NOW - 1 }));
    await expect(client(fetcher).resolveCandle(selection())).rejects.toThrow('candle_not_closed');
  });
  test.each([{ source: 'BYBIT_SPOT' }, { interval: '30m' }, { pricePoint: 'CURSOR' }, { openTime: NOW - HOUR + 1 }])('rejects unverified selection input: %j', async mismatch => {
    const fetcher = collectorRequest(); await expect(client(fetcher).resolveCandle(selection(mismatch) as any)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  test('no nearest-candle substitution when selected provider timestamp is absent', async () => {
    const fetcher = collectorRequest(result => ({ ...result, candles: [candle(NOW - 2 * HOUR)] }));
    await expect(client(fetcher).resolveCandle(selection())).rejects.toThrow('selected_candle_missing');
  });
  test('rejects selected bar before contract launch without candle network work', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ ...instrument(), launchTime: NOW - HOUR + 1 }));
    await expect(client(fetcher).resolveCandle(selection())).rejects.toThrow('contract_not_launched'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('Monday UTC weekly selection resolves the same bar; epoch Thursday alignment is rejected', async () => {
    const monday = Date.UTC(2026, 8, 7), result = await client(collectorRequest()).resolveCandle({ ...selection(), interval: '1w', openTime: monday });
    expect(result.openTime).toBe(monday); expect(result.closeTime).toBe(Date.UTC(2026, 8, 14));
    await expect(client(collectorRequest()).resolveCandle({ ...selection(), interval: '1w', openTime: monday - 4 * 86_400_000 })).rejects.toThrow('invalid_candle_alignment');
  });
});

describe('collector chart source and access preservation', () => {
  test.each([['1h', '60'], ['4h', '240'], ['1d', 'D'], ['1w', 'W']] as const)('requests %s from exact linear venue endpoint (%s)', async (interval, wire) => {
    const at = interval === '1w' ? Date.UTC(2026, 8, 7) : Math.floor(NOW / privateChartIntervalMs(interval)) * privateChartIntervalMs(interval);
    const fetcher = jest.fn().mockResolvedValue(response({ retCode: 0, time: NOW, result: { category: 'linear', symbol: 'BTCUSDT', list: [[String(at), '100', '110', '90', '105', '1.25', '125']] } }));
    const source = new CollectorPrivateTradingSource(fetcher, () => NOW); jest.spyOn(source, 'instrument').mockResolvedValue(instrument());
    const result = await source.chartCandles({ symbol: 'BTCUSDT', interval, limit: 1 });
    expect(result.candles[0].volume).toBe('1.25');
    const url = new URL(fetcher.mock.calls[0][0]); expect(url.origin).toBe('https://api.bybit.com'); expect(url.pathname).toBe('/v5/market/kline');
    expect(url.searchParams.get('category')).toBe('linear'); expect(url.searchParams.get('symbol')).toBe('BTCUSDT'); expect(url.searchParams.get('interval')).toBe(wire);
  });
  test('collector chart route requires token and retains no-store response', async () => {
    const source = new LiveFeed('bybit'); const server = collectorServer(source, 'test-token', () => ({}));
    await requestApp(server.app).get('/internal/v1/private-trading/chart-candles/BTCUSDT?interval=1h').expect(401);
    const result = await requestApp(server.app).get('/internal/v1/private-trading/chart-candles/BTCUSDT?interval=bad').set('Authorization', 'Bearer test-token').expect(400);
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.body.error).toBe('invalid_chart_interval');
    server.close();
  });
  test.each([{ category: 'spot' }, { symbol: 'ETHUSDT' }])('collector refuses upstream product substitution: %j', async mismatch => {
    const fetcher = jest.fn().mockResolvedValue(response({ retCode: 0, time: NOW, result: { category: 'linear', symbol: 'BTCUSDT', list: [[String(NOW), '100', '110', '90', '105', '1']], ...mismatch } }));
    const source = new CollectorPrivateTradingSource(fetcher, () => NOW); jest.spyOn(source, 'instrument').mockResolvedValue(instrument());
    await expect(source.chartCandles({ symbol: 'BTCUSDT', interval: '1h', limit: 1 })).rejects.toThrow('market_data_invalid');
  });
});
