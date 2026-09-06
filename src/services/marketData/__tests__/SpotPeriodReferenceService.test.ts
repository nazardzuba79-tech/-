import express from 'express';
import request from 'supertest';
import { completedPeriodReference, SpotPeriodReferenceService } from '../SpotPeriodReferenceService';
import { spotPeriodReferenceRouter } from '../SpotPeriodReferenceRouter';
import type { MarketCandle } from '../../KrakenMarketDataService';

const now = Date.UTC(2026, 8, 6, 12, 7);
const cutoff = Math.floor(now / 1000 / 900) * 900;
const candle = (end: number, close: number): MarketCandle => ({ time: end - 900, open: close / 2, high: close * 3, low: close / 3, close, volume: 100 });
const history = [candle(cutoff - 7 * 86400, 100), candle(cutoff - 86400, 110), candle(cutoff, 130)];

describe('Spot period references use exact native pair closes', () => {
  test('selects latest completed close before cutoff, never open/high/low/future candle', () => {
    expect(completedPeriodReference([...history, candle(cutoff - 86400 + 900, 999)], now / 1000 - 86400))
      .toEqual({ price: 110, time: cutoff - 86400 });
  });
  test('rejects missing, expired, zero and invalid close history', () => {
    for (const series of [[], [candle(cutoff - 1800, 100)], [candle(cutoff, 0)], [candle(cutoff, NaN)]]) {
      expect(completedPeriodReference(series, now / 1000)).toBeNull();
    }
  });
  test('one 15-minute source series supplies24h and7d with disclosed timestamps', async () => {
    const market = { getCandles: jest.fn().mockResolvedValue(history) };
    const response = await new SpotPeriodReferenceService(market, () => now).references(['BTC/USDT']);
    expect(market.getCandles).toHaveBeenCalledWith('BTC/USDT', '15m', 720);
    expect(response).toEqual({ asOf: now, resolutionSeconds: 900, references: [{ pair: 'BTC/USDT', day: { price: 110, time: cutoff - 86400 }, week: { price: 100, time: cutoff - 7 * 86400 } }] });
  });
  test('same-bucket concurrent and subsequent reads share the cached source', async () => {
    const market = { getCandles: jest.fn().mockResolvedValue(history) };
    const service = new SpotPeriodReferenceService(market, () => now);
    await Promise.all([service.references(['BTC/USD']), service.references(['BTC/USD'])]);
    await service.references(['BTC/USD']);
    expect(market.getCandles).toHaveBeenCalledTimes(1);
  });
  test('rolling bucket refreshes rather than relabelling yesterday reference', async () => {
    let clock = now;
    const market = { getCandles: jest.fn().mockResolvedValue(history) };
    const service = new SpotPeriodReferenceService(market, () => clock);
    await service.references(['BTC/USD']);
    clock += 900000;
    const response = await service.references(['BTC/USD']);
    expect(market.getCandles).toHaveBeenCalledTimes(2);
    expect(response.references[0]).toEqual({ pair: 'BTC/USD', day: null, week: null });
  });
  test('native USD and USDT keys cannot share reference prices', async () => {
    const market = { getCandles: jest.fn(async (pair: string) => [candle(cutoff - 7 * 86400, pair === 'BTC/USD' ? 100 : 101)]) };
    const response = await new SpotPeriodReferenceService(market, () => now).references(['BTC/USD', 'BTC/USDT']);
    expect(response.references.map(row => row.week?.price)).toEqual([100, 101]);
  });
  test('unavailable source is null, not generated or zero percent', async () => {
    const service = new SpotPeriodReferenceService({ getCandles: jest.fn().mockRejectedValue(new Error('unavailable')) }, () => now);
    expect((await service.references(['BTC/USD'])).references[0]).toEqual({ pair: 'BTC/USD', day: null, week: null });
  });
  test('global upstream concurrency remains at most three across concurrent requests', async () => {
    let active = 0, maximum = 0;
    const market = { getCandles: jest.fn(async () => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1; return history;
    }) };
    const service = new SpotPeriodReferenceService(market, () => now);
    await Promise.all([service.references(['A/USD', 'B/USD', 'C/USD', 'D/USD']), service.references(['E/USD', 'F/USD', 'G/USD', 'H/USD'])]);
    expect(maximum).toBe(3);
  });
});

describe('bounded read-only period reference API', () => {
  const market = { getCandles: jest.fn().mockResolvedValue(history) };
  const app = express();
  app.use('/api/v1', spotPeriodReferenceRouter(new SpotPeriodReferenceService(market, () => now)));
  test('accepts native pairs only through exact GET route', async () => {
    const response = await request(app).get('/api/v1/market/external/period-references').query({ pairs: 'BTC/USD,BTC/USDT' });
    expect(response.status).toBe(200);
    expect(response.body.references.map((row: { pair: string }) => row.pair)).toEqual(['BTC/USD', 'BTC/USDT']);
  });
  test.each([
    '', '?pairs=https://example.com', '?pairs=BTC/USD&url=https://example.com', '?pairs=BTC/USD&pairs=ETH/USD',
    '?pairs=A/USD,B/USD,C/USD,D/USD,E/USD,F/USD,G/USD', '?pairs=../../wallet',
  ])('rejects invalid query %s', async query => {
    expect((await request(app).get('/api/v1/market/external/period-references' + query)).status).toBe(400);
  });
  test.each(['post', 'put', 'delete'] as const)('does not expose %s account actions', async method => {
    expect((await request(app)[method]('/api/v1/market/external/period-references?pairs=BTC/USD')).status).toBe(404);
  });
});
