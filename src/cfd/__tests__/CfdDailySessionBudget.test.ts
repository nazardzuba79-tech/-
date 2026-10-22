// The CFD information strip reads one daily series per instrument through the
// same public display route as the chart. These tests pin the server-side
// budget for that read: one upstream request per (instrument, interval, limit)
// key however many readers arrive at once, the route floor of 20 bars, and a
// key that never collides with the chart's hourly series.
import express from 'express';
import request from 'supertest';
import { BiquoteCfdOhlcSource } from '../../services/marketData/cfd/BiquoteCfdOhlcSource';
import { publicDisplayCache, SLOW_DISPLAY_REFRESH_MS } from '../../api/middleware/publicDisplayCache';

const DAY = 86_400_000;
function dailyBody(providerSymbol: string, interval: string, count: number) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  return JSON.stringify({ symbol: providerSymbol, interval, bars: Array.from({ length: count }, (_, i) => ({
    openTime: new Date(today - i * DAY).toISOString(), open: 100 + i, high: 110 + i, low: 90 + i, close: 101 + i, volume: 0, tickVolume: 10, isOpen: i === 0 })) });
}
function fetchStub(delayMs = 20) {
  const calls: string[] = [];
  const fetchFn = jest.fn(async (url: string) => {
    calls.push(url);
    await new Promise(done => setTimeout(done, delayMs));
    const u = new URL(url); const providerSymbol = u.pathname.split('/')[2];
    return new Response(dailyBody(providerSymbol, u.searchParams.get('interval')!, Number(u.searchParams.get('limit'))), { status: 200 });
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

test('twenty-five simultaneous readers of the daily series cost one upstream request', async () => {
  const { calls, fetchFn } = fetchStub();
  const source = new BiquoteCfdOhlcSource('https://provider.invalid', fetchFn, 5_000, 15_000);
  const results = await Promise.all(Array.from({ length: 25 }, () => source.getOhlc('XAUUSD', '1d', 20)));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toBe('https://provider.invalid/api/XAUUSD/ohlc?interval=1d&limit=20');
  expect(results.every(r => r.interval === '1d' && r.bars.length === 20 && r.bars[r.bars.length - 1].isOpen)).toBe(true);
  // A second wave inside the source's own cache window is free as well.
  await source.getOhlc('XAUUSD', '1d', 20);
  expect(calls).toHaveLength(1);
});

test('the strip key never collides with the chart key, and the floor of 20 bars holds', async () => {
  const { calls, fetchFn } = fetchStub(1);
  const source = new BiquoteCfdOhlcSource('https://provider.invalid', fetchFn, 5_000, 15_000);
  await source.getOhlc('WTIUSD', '1h', 320);
  await source.getOhlc('WTIUSD', '1d', 20);
  await source.getOhlc('WTIUSD', '1d', 5);
  expect(calls).toEqual([
    'https://provider.invalid/api/USOIL/ohlc?interval=1h&limit=320',
    'https://provider.invalid/api/USOIL/ohlc?interval=1d&limit=20',
  ]);
});

test('the six-hour public display cache serves every later reader of the daily URL without the source', async () => {
  let clock = 1_700_000_000_000, upstream = 0;
  const app = express();
  app.get('/cfd/display/candles/:symbol', publicDisplayCache(SLOW_DISPLAY_REFRESH_MS, body => Array.isArray(body.bars), () => clock), (q, r) => {
    upstream++; r.json({ symbol: q.params.symbol, interval: q.query.interval, fetchedAt: clock, bars: [{ openTime: clock, open: 1, high: 2, low: 1, close: 1.5, isOpen: true }, { openTime: clock - DAY, open: 1, high: 2, low: 1, close: 1.2, isOpen: false }] });
  });
  const url = '/cfd/display/candles/XAUUSD?interval=1d&limit=20';
  const first = await request(app).get(url).expect(200);
  expect(first.body._display).toEqual({ mode: 'snapshot', capturedAt: clock, refreshMs: SLOW_DISPLAY_REFRESH_MS });
  const wave = await Promise.all(Array.from({ length: 10 }, () => request(app).get(url)));
  clock += SLOW_DISPLAY_REFRESH_MS - 1;
  await request(app).get(url).expect(200);
  expect(wave.every(r => r.status === 200 && r.body.bars.length === 2)).toBe(true);
  expect(upstream).toBe(1);
  // The chart's hourly series is a different cache entry; reading it does not refresh the daily one.
  await request(app).get('/cfd/display/candles/XAUUSD?interval=1h&limit=320').expect(200);
  expect(upstream).toBe(2);
  clock += 1;
  await request(app).get(url).expect(200);
  expect(upstream).toBe(3);
});
