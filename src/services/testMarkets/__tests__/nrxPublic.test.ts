import { NEURIX } from '../neurix';
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
