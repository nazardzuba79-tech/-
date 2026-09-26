import express from 'express';
import request from 'supertest';
import BigNumber from 'bignumber.js';
import { testMarketsRouter } from '../testMarkets';
import { VOLTORA, TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../../services/testMarkets/testAssetConfig';
import { resolveSimulationNow } from '../../../services/testMarkets/testMarketService';
import { OrderService } from '../../../services/OrderService';
import { WithdrawalService } from '../../../services/WithdrawalService';
import { DepositService } from '../../../services/DepositService';
import { BalanceAdjustmentService } from '../../../services/BalanceAdjustmentService';
import { DemoTradingService } from '../../../services/DemoTradingService';

const L = VOLTORA.listingAt;
const HOUR = 3_600_000;
const PREVIEW_ENV = { NODE_ENV: 'development', TEST_MARKET_SIMULATION_PREVIEW: '1' } as NodeJS.ProcessEnv;

function app(now: number, env: NodeJS.ProcessEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv) {
  const a = express();
  a.use('/api/v1', testMarketsRouter(() => now, env));
  // Stands in for the venue-backed routers mounted after it.
  a.use('/api/v1', (req, res) => res.status(299).json({ passedThrough: req.path }));
  return a;
}

describe('the test-asset list and state', () => {
  test('pre-listing: listed, not tradable, no price and no candles', async () => {
    const res = await request(app(L - 10 * HOUR)).get('/api/v1/market/test-assets');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0]).toMatchObject({
      pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', isTestAsset: true, isTradable: false,
      status: 'TEST · NOT TRADABLE', listingAt: '2026-09-27T16:00:00.000Z', initialPrice: 0.01,
      state: { phase: 'pre-listing', lastPrice: null, change24hPercent: null, volume24h: null },
    });
    const candles = await request(app(L - 1)).get('/api/v1/market/external/candles/VTA-USDT?interval=5m');
    expect(candles.body).toMatchObject({ source: 'simulation', isTestAsset: true, candles: [] });
  });

  test('right after the listing the first candle is there', async () => {
    const res = await request(app(L + 1)).get('/api/v1/market/test-assets/VTA-USDT/candles?interval=5m');
    expect(res.body.candles).toEqual([{ time: L / 1000, open: 0.01, high: 0.01, low: 0.01, close: 0.01, volume: 0 }]);
    const state = await request(app(L + 1)).get('/api/v1/market/test-assets/VTA-USDT');
    expect(state.body.state).toMatchObject({ phase: 'live', lastPrice: 0.01, change24hPercent: 0 });
  });

  test('candles never reach past the server clock, and a refresh returns the same history', async () => {
    const now = L + 30 * HOUR + 12_345;
    for (const interval of ['5m', '15m', '1h', '4h', '1d', '1w']) {
      const first = await request(app(now)).get(`/api/v1/market/external/candles/VTA-USDT?interval=${interval}&limit=1000`);
      const second = await request(app(now)).get(`/api/v1/market/external/candles/VTA-USDT?interval=${interval}&limit=1000`);
      expect(first.status).toBe(200);
      expect(second.body.candles).toEqual(first.body.candles);
      expect(first.body.candles.length).toBeGreaterThan(0);
      expect(first.body.candles.every((c: { time: number }) => c.time * 1000 <= now)).toBe(true);
    }
    const bad = await request(app(now)).get('/api/v1/market/external/candles/VTA-USDT?interval=1m');
    expect(bad.status).toBe(400);
  });

  test('limit is respected and the last candle is the forming one', async () => {
    const now = L + 50 * HOUR + 7 * 60_000;
    const res = await request(app(now)).get('/api/v1/market/external/candles/VTA-USDT?interval=1h&limit=10');
    expect(res.body.candles).toHaveLength(10);
    expect(res.body.candles[9].time * 1000).toBe(L + 50 * HOUR);
  });

  test('ticker, empty book and empty tape for the test pair', async () => {
    const now = L + 20 * HOUR;
    const ticker = await request(app(now)).get('/api/v1/market/external/tickers/VTA-USDT');
    const state = (await request(app(now)).get('/api/v1/market/test-assets/VTA-USDT')).body.state;
    expect(ticker.body.ticker.lastPrice).toBe(String(state.lastPrice));
    expect(ticker.body.ticker.changePercent24h).toBe(String(state.change24hPercent));
    expect(ticker.body).toMatchObject({ isTestAsset: true, isTradable: false });
    for (const path of ['/market/external/orderbook/VTA-USDT', '/market/display/spot-book/VTA-USDT', '/orderbook/VTA-USDT']) {
      const book = await request(app(now)).get(`/api/v1${path}`);
      expect(book.body).toMatchObject({ isTestAsset: true, available: false, bids: [], asks: [] });
    }
    expect((await request(app(now)).get('/api/v1/market/external/trades/VTA-USDT')).body.trades).toEqual([]);
    expect((await request(app(L - 1)).get('/api/v1/market/external/tickers/VTA-USDT')).status).toBe(404);
  });

  test('every other pair passes through to the routers that serve it today', async () => {
    for (const path of ['/market/external/candles/BTC-USDT', '/market/external/tickers/ETH-USDT', '/market/external/orderbook/BTC-USDT',
      '/market/display/spot-book/BTC-USDT', '/market/external/trades/SOL-USDT', '/market/ticker/BTC-USDT', '/orderbook/BTC-USDT']) {
      const res = await request(app(L + HOUR)).get(`/api/v1${path}`);
      expect(res.status).toBe(299);
    }
  });
});

describe('the preview clock is development-only', () => {
  test('production ignores simulationPreviewTime', async () => {
    const res = await request(app(L - HOUR)).get(`/api/v1/market/test-assets?simulationPreviewTime=${new Date(L + 48 * HOUR).toISOString()}`);
    expect(res.body.assets[0].state.phase).toBe('pre-listing');
    expect(res.body.serverTime).toBe(L - HOUR);
  });
  test('a non-production environment still needs the explicit flag', () => {
    expect(resolveSimulationNow(String(L + HOUR), () => 5, { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(5);
    expect(resolveSimulationNow(String(L + HOUR), () => 5, { NODE_ENV: 'production', TEST_MARKET_SIMULATION_PREVIEW: '1' } as NodeJS.ProcessEnv)).toBe(5);
    expect(resolveSimulationNow(String(L + HOUR), () => 5, PREVIEW_ENV)).toBe(L + HOUR);
    expect(resolveSimulationNow('not-a-date', () => 5, PREVIEW_ENV)).toBe(5);
  });
  test('with both, the preview time drives the state', async () => {
    const res = await request(app(L - HOUR, PREVIEW_ENV)).get(`/api/v1/market/test-assets?simulationPreviewTime=${new Date(L + 48 * HOUR).toISOString()}`);
    expect(res.body.assets[0].state.phase).toBe('live');
    expect(res.body.assets[0].state.lastPrice).toBeCloseTo(0.01 * Math.pow(1.3, 25) * Math.pow(0.96, 6), 5);
  });
});

describe('a test asset can never trade, hold a balance, deposit or withdraw', () => {
  // Every dependency throws if touched: the refusal must come first.
  const untouchable = new Proxy({}, { get: () => { throw new Error('touched a real dependency'); } }) as never;

  test('orders and OCO orders are refused before the engine, the price source or the database', async () => {
    const orders = new OrderService(untouchable, untouchable, untouchable);
    for (const pair of ['VTA/USDT', 'VTAUSDT']) {
      await expect(orders.placeOrder({ userId: 'u', pair, side: 'BUY', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOcoOrder({ userId: 'u', pair, side: 'SELL', quantity: new BigNumber(1), takeProfitPrice: new BigNumber(2), stopTriggerPrice: new BigNumber(1), stopLimitPrice: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    }
  });
  test('demo orders and admin demo top-ups too', async () => {
    const demo = new DemoTradingService(untouchable, untouchable as never);
    await expect(demo.placeOrder({ userId: 'u', pair: 'VTA/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(demo.topUp({ userId: 'u', asset: 'VTA', amount: '100', performedByAdminId: 'a' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
  });
  test('withdrawals, deposit claims and admin balance adjustments', async () => {
    await expect(new WithdrawalService(untouchable).requestWithdrawal({ userId: 'u', asset: 'VTA', network: 'x', toAddress: 'x', amount: '1' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(new DepositService(untouchable, { chain: 'ethereum' } as never, untouchable).claimDeposit({ userId: 'u', txHash: '0x1', asset: 'vta' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(new DepositService(untouchable, { chain: 'ethereum' } as never, untouchable).recordIncoming({ txHash: '0x1', asset: 'VTA' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(new BalanceAdjustmentService(untouchable).adjust({ userId: 'u', asset: 'VTA', amount: '100', reason: 'x', performedByAdminId: 'a' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
  });
});
