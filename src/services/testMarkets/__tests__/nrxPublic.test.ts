import { NEURIX, NRX_BALANCE_SELLOFF_SCENARIO } from '../neurix';
import { nrxPublicResponse } from '../nrxPublic';
import { publicTestAsset, testMarketCandles } from '../testMarketService';
import { simulationFor, TestMarketSimulation, HOUR_MS } from '../testMarketSimulation';
import { VOLTORA, isTestAssetPairOrSymbol } from '../testAssetConfig';
import { spotPriceSource, assertSpotListing } from '../nrxSpot';
import express from 'express';
import http from 'supertest';
import { testMarketsRouter } from '../../../api/routes/testMarkets';

const request = (path: string, now: number, init?: RequestInit) => nrxPublicResponse(
  new Request(`https://market.voltextech.net${path}`, init), () => now,
)!;
const listing = NEURIX.listingAt;

test('Render redirects only public NRX reads, including HEAD; account routes are untouched', async () => {
  const app = express();
  app.use('/api/v1', testMarketsRouter());
  app.get('/api/v1/account/NRX', (_req, res) => res.json({ accountRoute: true }));
  const path = '/api/v1/market/test-assets/NRX-USDT';
  for (const response of [await http(app).get(path), await http(app).head(path)]) {
    expect(response.status).toBe(307);
    expect(response.headers.location).toBe('https://market.voltextech.net/market/test-assets/NRX-USDT');
  }
  expect((await http(app).get('/api/v1/account/NRX')).body).toEqual({ accountRoute: true });
});

test('NRX identity, listing boundary and 0.80 initial price; VTA unchanged', async () => {
  expect(new Date(listing).toISOString()).toBe('2026-10-03T13:00:00.000Z');
  const before = await request('/market/nrx', listing - 1).json();
  expect(before.assets[0]).toMatchObject({ name: 'NEURIX', pair: 'NRX/USDT', initialPrice: .8, isTradable: true,
    state: { phase: 'pre-listing', lastPrice: null } });
  const live = await request('/market/nrx', listing).json();
  expect(live.assets[0].state).toMatchObject({ phase: 'live', lastPrice: .8 });
  expect(publicTestAsset(VOLTORA, VOLTORA.listingAt).state.lastPrice).toBe(.01);
  expect(VOLTORA.listingAt).toBe(Date.parse('2026-09-28T15:00:00Z'));
});

test('original NRX wave engine keeps shared relative growth rules without copying the math', () => {
  const a = new TestMarketSimulation({ ...NEURIX, scheduledScenario: undefined });
  const b = new TestMarketSimulation({ ...VOLTORA, seed: NEURIX.seed, listingAt: listing, initialPrice: .8 });
  // NRX's wave structure re-arranges the hours INSIDE each block, so the shared
  // growth rule is the block and day anchors: the listing, 48h and every day after.
  for (const hours of [0, 48, 72, 96, 120]) expect(a.priceAt(listing + hours * HOUR_MS)).toBe(b.priceAt(listing + hours * HOUR_MS));
});

test('before listing there are no candles, book levels or trades', async () => {
  expect((await request('/market/test-assets/NRX-USDT/candles', listing - 1).json()).candles).toEqual([]);
  expect((await request('/market/display/spot-book/NRX-USDT', listing - 1).json()).bids).toEqual([]);
  expect((await request('/market/external/trades/NRX-USDT', listing - 1).json()).trades).toEqual([]);
  expect(request('/market/ticker/NRX-USDT', listing - 1).status).toBe(404);
});

test('all live public data deterministic, populated, canonical, no future leakage or IO', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External IO forbidden'));
  try {
    const now = listing + 125_000;
    const candles = (await request('/market/test-assets/NRX-USDT/candles', now).json()).candles;
    expect(candles).toEqual(testMarketCandles(NEURIX, '5m', now));
    expect(candles.length).toBeGreaterThan(0);
    const book = await request('/market/display/spot-book/NRX-USDT', now).json();
    expect(book).toEqual(await request('/market/display/spot-book/NRX-USDT', now).json());
    expect(book.bids).toHaveLength(25); expect(book.asks).toHaveLength(25);
    expect(+book.bids[0].price).toBeLessThan(+book.asks[0].price);
    const trades = (await request('/market/external/trades/NRX-USDT', now).json()).trades;
    expect(trades.length).toBeGreaterThan(0);
    expect(trades).toEqual(simulationFor(NEURIX).recentTrades(now).map(trade => ({ ...trade, time: trade.timestamp })));
    for (const trade of trades) expect(trade.timestamp).toBeLessThanOrEqual(now);
    const ticker = (await request('/market/ticker/NRX-USDT', now).json()).ticker;
    expect(+ticker.lastPrice).toBe(publicTestAsset(NEURIX, now).state.lastPrice);
    expect(+ticker.volume24h).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

test('client clock cannot list early; safe methods/intervals and no NRX venue fallthrough', async () => {
  expect((await request(`/market/nrx?simulationPreviewTime=${listing + 99999}`, listing - 1).json()).assets[0].state.phase).toBe('pre-listing');
  expect(request('/market/nrx', listing, { method: 'POST' }).status).toBe(405);
  expect(request('/market/nrx', listing, { method: 'HEAD' }).headers.get('cache-control')).toBe('no-store');
  expect(await request('/market/nrx', listing, { method: 'HEAD' }).text()).toBe('');
  expect(request('/market/nrx', listing, { method: 'OPTIONS' }).status).toBe(204);
  expect(request('/market/display/futures-book/NRXUSDT', listing).status).toBe(404);
  expect(request('/market/test-assets/NRX-USDT/candles?interval=bad', listing).status).toBe(400);
  expect(nrxPublicResponse(new Request('https://market.voltextech.net/market/display/spot-book/BTC-USDT'))).toBeNull();
});

test('Spot conditional price uses canonical NRX only; ordinary venue prices and VTA guard preserved', async () => {
  const source = { getTicker: jest.fn().mockResolvedValue({ lastPrice: '123' }) };
  expect(await spotPriceSource(source, () => listing - 1).getTicker(NEURIX.pair)).toBeNull();
  expect(await spotPriceSource(source, () => listing).getTicker(NEURIX.pair)).toEqual({ lastPrice: '0.8' });
  expect(source.getTicker).not.toHaveBeenCalled();
  expect(await spotPriceSource(source).getTicker('BTC/USDT')).toEqual({ lastPrice: '123' });
  expect(() => assertSpotListing('NRX/USDT', listing - 1)).toThrow('not started');
  expect(() => assertSpotListing('NRX/USDT', listing)).not.toThrow();
  expect(() => assertSpotListing('VTA/USDT', listing)).toThrow('not available');
  expect(isTestAssetPairOrSymbol('NRX')).toBe(true); // still excluded from withdrawals/Futures collateral
});

test('NRX preserves live history, then runs balance → -60% selloff → balance', () => {
  expect(NEURIX.scheduledScenario).toEqual(NRX_BALANCE_SELLOFF_SCENARIO);
  const sim = simulationFor(NEURIX);
  const baseline = new TestMarketSimulation({ ...NEURIX, scheduledScenario: undefined });
  for (const [at, price] of [
    ['2026-10-03T14:00:00Z', 1.4877408],
    ['2026-10-03T21:00:00Z', 2.7420778],
    ['2026-10-04T13:00:00Z', 45.828573],
    ['2026-10-05T04:22:59.506Z', 241.09443],
  ] as const) {
    expect(sim.priceAt(Date.parse(at))).toBe(price);
    expect(sim.priceAt(Date.parse(at))).toBe(baseline.priceAt(Date.parse(at)));
  }

  const from = NRX_BALANCE_SELLOFF_SCENARIO.from;
  const anchor = baseline.priceAt(from)!;
  expect(sim.priceAt(from)).toBe(anchor);
  expect(sim.priceAt(NRX_BALANCE_SELLOFF_SCENARIO.rangeEndAt)).toBeCloseTo(anchor, 8);
  const terminal = Number((anchor * (1 - NRX_BALANCE_SELLOFF_SCENARIO.selloffFraction)).toPrecision(8));
  expect(Math.abs(sim.priceAt(NRX_BALANCE_SELLOFF_SCENARIO.selloffEndAt)! - terminal)).toBeLessThanOrEqual(Math.max(1e-8, terminal * 1e-7));
  const later = sim.priceAt(NRX_BALANCE_SELLOFF_SCENARIO.selloffEndAt + 24 * HOUR_MS)!;
  expect(later).toBeGreaterThan(terminal * .5);
  expect(later).toBeLessThan(terminal * 1.6);

  expect(publicTestAsset(NEURIX, Date.parse('2026-10-05T04:22:59.506Z')).state).toMatchObject({
    lastPrice: 241.09443, openPrice24h: 7.7160454, high24h: 273.75376, low24h: 6.2710392,
  });
  expect(testMarketCandles(NEURIX, '4h', Date.parse('2026-10-05T04:22:59.506Z'), 12)[0]).toEqual({
    time: 1791028800, open: .8, high: 2.1389475, low: .75115033, close: 1.9657949, volume: 2538378.4403,
  });
});
