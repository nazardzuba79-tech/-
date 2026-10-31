import { NEURIX, NRX_BALANCE_SELLOFF_SCENARIO } from '../neurix';
import { nrxPublicResponse } from '../nrxPublic';
import { publicTestAsset } from '../testMarketService';
import { simulationFor, TestMarketSimulation, HOUR_MS } from '../testMarketSimulation';
import { VOLTORA, isTestAssetPairOrSymbol } from '../testAssetConfig';
import { spotPriceSource, assertSpotListing } from '../nrxSpot';
import express from 'express';
import http from 'supertest';
import { testMarketsRouter } from '../../../api/routes/testMarkets';

const invoke = (path: string, method = 'GET', clock = () => NEURIX.listingAt) =>
  nrxPublicResponse(new Request(`https://market.voltextech.net${path}`, { method }), clock)!;

test('Render returns 410 for retired NRX, never redirects it to a venue; private account routes untouched', async () => {
  const app = express();
  app.use('/api/v1', testMarketsRouter());
  app.get('/api/v1/account/NRX', (_req, res) => res.json({ accountRoute: true }));
  for (const path of ['/api/v1/market/test-assets/NRX-USDT', '/api/v1/market/ticker/NRXUSDT',
    '/api/v1/market/ticker/NRXCOIN-USDT?pair=NRX/BTC']) {
    const response = await http(app).get(path);
    expect(response.status).toBe(410);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ error: 'market_retired', symbol: 'NRX' });
    expect(response.headers.location).toBeUndefined();
  }
  expect((await http(app).get('/api/v1/account/NRX')).body).toEqual({ accountRoute: true });
});

test('all retired public NRX read paths fail closed without clock, simulation or network IO', async () => {
  const clock = jest.fn(() => { throw Error('retired market must not run its model'); });
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('external IO forbidden'));
  try {
    for (const path of ['/market/nrx', '/market/test-assets/NRX-USDT', '/market/ticker/NRX-USDT',
      '/market/test-assets/NRX-USDT/candles', '/market/display/spot-book/NRX-USDT',
      '/market/external/trades/NRX-USDT', '/market/external/candles/NRX-USDT']) {
      const r = invoke(path, 'GET', clock);
      expect(r.status).toBe(410);
      expect(await r.json()).toEqual({ error: 'market_retired', symbol: 'NRX' });
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(invoke('/market/nrx', 'HEAD').status).toBe(410);
    expect(await invoke('/market/nrx', 'HEAD').text()).toBe('');
    expect(invoke('/market/nrx', 'OPTIONS').status).toBe(204);
    expect(invoke('/market/nrx', 'POST').status).toBe(405);
    expect(nrxPublicResponse(new Request('https://market.voltextech.net/market/ticker/BTC-USDT'))).toBeNull();
    expect(clock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});

test('historic modeled NRX data remains deterministic for audit, without public availability', () => {
  const listing = NEURIX.listingAt;
  expect(new Date(listing).toISOString()).toBe('2026-10-03T13:00:00.000Z');
  expect(NEURIX.scheduledScenario).toEqual(NRX_BALANCE_SELLOFF_SCENARIO);
  const original = new TestMarketSimulation({ ...NEURIX, scheduledScenario: undefined });
  const model = simulationFor(NEURIX);
  const first = publicTestAsset(NEURIX, listing).state.lastPrice;
  expect(first).toBe(0.8);
  expect(model.priceAt(listing)).toBe(0.8);
  expect(original.priceAt(listing + 48 * HOUR_MS)).toBeGreaterThan(0);
  expect(publicTestAsset(VOLTORA, VOLTORA.listingAt).state.lastPrice).toBe(.01);
  expect(isTestAssetPairOrSymbol('NRX')).toBe(true);
});

test('NRX has no conditional Spot price, no new orders; BTC and VTA stay unchanged', async () => {
  const source = { getTicker: jest.fn().mockResolvedValue({ lastPrice: '123' }) };
  expect(await spotPriceSource(source).getTicker('NRX/USDT')).toBeNull();
  expect(await spotPriceSource(source).getTicker('NRX/BTC')).toBeNull();
  expect(source.getTicker).not.toHaveBeenCalled();
  expect(await spotPriceSource(source).getTicker('BTC/USDT')).toEqual({ lastPrice: '123' });
  expect(() => assertSpotListing('NRX/USDT', NEURIX.listingAt + 1000)).toThrow('NRX is no longer available');
  expect(() => assertSpotListing('VTA/USDT', NEURIX.listingAt)).toThrow('not available');
});
