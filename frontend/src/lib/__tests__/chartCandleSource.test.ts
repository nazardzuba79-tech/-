import { loadChartCandles, rawStoreSize, resetChartCandleSource, workspaceCandleLoader } from '../chartCandleSource';
import type { Candle } from '../indicators';

const start = Date.UTC(2026, 1, 18) / 1000;
const mk = (time: number, price = 100): Candle => ({ time, open: price, high: price + 2, low: price - 2, close: price + 1, volume: 10 });
const hourly = (from: number, count: number) => Array.from({ length: count }, (_, i) => mk(from + i * 3600, 100 + i));

beforeEach(() => resetChartCandleSource());

describe('native intervals', () => {
  it('passes a native request straight to the market loader with the caller\'s own signal', async () => {
    const loader = jest.fn(async () => ({ candles: hourly(start, 3) }));
    const controller = new AbortController();
    const request = { market: 'futures' as const, pair: 'BTC/USDT', timeframe: '1h' as const, limit: 300, signal: controller.signal };
    const a = await loadChartCandles(loader, 'futures-public', request);
    await loadChartCandles(loader, 'futures-public', request);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[0]).toEqual(['BTC/USDT', '1h', 300, controller.signal, undefined]);
    expect(a.plan).toEqual({ kind: 'native' });
    expect(a.partialLast).toBe(false);
  });
  it('shares one base-bar request between two derived callers and lets one leave without aborting it', async () => {
    let inner: AbortSignal | undefined;
    const loader = jest.fn((_p: string, _i: string, _l: number, signal?: AbortSignal) => new Promise<{ candles: Candle[] }>(resolve => { inner = signal; setTimeout(() => resolve({ candles: hourly(start, 12) }), 20); }));
    const request = { market: 'spot' as const, pair: 'ETH/USDT', timeframe: '2h' as const, limit: 10 };
    const leaving = new AbortController();
    const first = loadChartCandles(loader, 'spot-public', { ...request, signal: leaving.signal });
    const second = loadChartCandles(loader, 'spot-public', request);
    leaving.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(inner?.aborted).toBe(false);
    expect((await second).candles).toHaveLength(6);
    expect(loader).toHaveBeenCalledTimes(1);
    // A third caller a moment later reuses the fresh base bars; a different window does not.
    await loadChartCandles(loader, 'spot-public', request);
    expect(loader).toHaveBeenCalledTimes(1);
    await loadChartCandles(loader, 'spot-public', { ...request, endTime: start * 1000 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('refuses an interval the source cannot build at all', async () => {
    const loader = jest.fn();
    await expect(loadChartCandles(loader, 'test-market', { market: 'spot', pair: 'VTA/USDT', timeframe: '1m', limit: 10 })).rejects.toThrow('timeframe_unavailable');
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('derived intervals', () => {
  it('requests the base interval with a wider limit and returns aggregated bars', async () => {
    const now = start + 48 * 3600 + 600;
    jest.useFakeTimers({ now: now * 1000 });
    const loader = jest.fn(async () => ({ candles: hourly(start, 49) })); // 48 full hours + the forming one
    const out = await loadChartCandles(loader, 'spot-public', { market: 'spot', pair: 'BTC/USDT', timeframe: '6h', limit: 50 });
    expect(loader.mock.calls[0].slice(0, 3)).toEqual(['BTC/USDT', '1h', 50 * 6 + 6]);
    expect(out.plan).toEqual({ kind: 'derived', base: '1h', factor: 6 });
    expect(out.candles.map(c => c.time)).toEqual(Array.from({ length: 9 }, (_, i) => start + i * 6 * 3600));
    expect(out.candles[0]).toEqual({ time: start, open: 100, high: 107, low: 98, close: 106, volume: 60 });
    expect(out.partialLast).toBe(true);
    jest.useRealTimers();
  });
  it('keeps base bars across history pages so a bucket on the seam is complete', async () => {
    const now = start + 24 * 3600;
    jest.useFakeTimers({ now: now * 1000 });
    const latest = hourly(start + 12 * 3600 + 2 * 3600, 10); // starts 14:00: the 12:00 bucket is cut
    const older = hourly(start, 14); // 00:00 … 13:00
    const loader = jest.fn(async (_p: string, _i: string, _l: number, _s?: AbortSignal, endTime?: number) => ({ candles: endTime === undefined ? latest : older }));
    const request = { market: 'spot' as const, pair: 'BTC/USDT', timeframe: '6h' as const, limit: 10 };
    const first = await loadChartCandles(loader, 'spot-public', request);
    expect(first.candles.map(c => c.time)).toEqual([start + 18 * 3600]);
    const page = await loadChartCandles(loader, 'spot-public', { ...request, endTime: (start + 14 * 3600) * 1000 - 1 });
    expect(page.candles.map(c => c.time)).toEqual([start, start + 6 * 3600, start + 12 * 3600]);
    expect(rawStoreSize('spot', 'BTC/USDT', '1h')).toBe(24);
    jest.useRealTimers();
  });
  it('falls back to a derived build when the source refuses a native code', async () => {
    const loader = jest.fn(async (_p: string, interval: string) => {
      if (interval === '2h') throw new Error('candle_http_400');
      return { candles: hourly(start, 8) };
    });
    const out = await loadChartCandles(loader, 'futures-public', { market: 'futures', pair: 'BTC/USDT', timeframe: '2h', limit: 10 });
    expect(out.plan).toEqual({ kind: 'derived', base: '1h', factor: 2 });
    expect(out.candles).toHaveLength(4);
  });
  it('wraps a market loader with the same contract for every catalogue interval', async () => {
    const loader = jest.fn(async () => ({ candles: hourly(start, 4) }));
    const wrapped = workspaceCandleLoader(loader, 'spot-public', 'spot');
    const out = await wrapped('BTC/USDT', '2h', 5);
    expect(out.candles.map(c => c.time)).toEqual([start, start + 7200]);
    await wrapped('BTC/USDT', 'weird', 5);
    expect(loader).toHaveBeenLastCalledWith('BTC/USDT', 'weird', 5, undefined, undefined);
  });
});
