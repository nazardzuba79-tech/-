import express from 'express';
import request from 'supertest';
import { assertSpotListing, assertSpotListingReady, spotPriceSource } from '../nrxSpot';
import { nrxPublicResponse } from '../nrxPublic';
import { testMarketsRouter } from '../../../api/routes/testMarkets';
import { managedListingRegistry } from '../../listings/registry';
import { isTestAssetPairOrSymbol } from '../testAssetConfig';

describe('NRX retirement without deleting economic history', () => {
  afterEach(() => jest.restoreAllMocks());
  test.each(['NRX/USDT', 'NRX-USDT', 'nrx_usdt', 'NRXUSDT', 'NRX', 'NRX/BTC', 'BTC/NRX', 'NRX/SIMUSDT', 'NRXSIMUSDT'])('rejects new orders for %s before registry or venue IO', async pair => {
    const refresh = jest.spyOn(managedListingRegistry, 'ensureFresh').mockResolvedValue(undefined);
    expect(() => assertSpotListing(pair, Date.UTC(2030, 0))).toThrow('NRX is no longer');
    await expect(assertSpotListingReady(pair, { getTicker: jest.fn() })).rejects.toThrow('NRX is no longer');
    expect(refresh).not.toHaveBeenCalled();
    const source = { getTicker: jest.fn().mockResolvedValue({ lastPrice: '42' }) };
    expect(await spotPriceSource(source).getTicker(pair)).toBeNull();
    expect(source.getTicker).not.toHaveBeenCalled();
  });
  test('other venue prices pass through and retired asset remains financially restricted', async () => {
    const source = { getTicker: jest.fn().mockResolvedValue({ lastPrice: '42' }) };
    expect(await spotPriceSource(source).getTicker('BTC/USDT')).toEqual({ lastPrice: '42' });
    expect(isTestAssetPairOrSymbol('NRX/USDT')).toBe(true);
    expect(isTestAssetPairOrSymbol('NRX')).toBe(true);
  });
  test.each(['/market/nrx', '/market/test-assets/NRX-USDT', '/market/external/candles/NRX-USDT', '/market/display/spot-book/NRX-USDT', '/market/external/trades/NRX-USDT', '/market/ticker/NRXUSDT', '/orderbook/NRX-USDT', '/market/ticker/BTC-USDT?symbol=NRX'])('API retires %s with no venue fallthrough', async path => {
    const app = express(); const fallback = jest.fn((_req, res) => res.json({ venue: true }));
    app.use(testMarketsRouter()); app.use(fallback);
    const response = await request(app).get(path);
    expect(response.status).toBe(410); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ error: 'market_retired', symbol: 'NRX' }); expect(fallback).not.toHaveBeenCalled();
  });
  test('retirement does not block a different symbol containing the letters NRX', async () => {
    const app = express(); app.use(testMarketsRouter()); app.use((_req, res) => res.json({ venue: true }));
    const r = await request(app).get('/market/ticker/NRXCOIN-USDT');
    expect(r.status).toBe(200); expect(r.body).toEqual({ venue: true });
  });
  test('public gate leaves private balance/history/cancellation and other markets alone', async () => {
    const app = express(); app.use(testMarketsRouter()); app.use((_req, res) => res.json({ untouched: true }));
    for (const path of ['/orders/NRX/cancel', '/balances/NRX', '/market/ticker/BTC-USDT']) expect((await request(app).get(path)).body).toEqual({ untouched: true });
  });
  test.each(['/market/nrx', '/market/external/candles/NRX-USDT', '/market/display/spot-trades/nrx_usdt', '/market/ticker/%4eRX-USDT', '/orderbook/NRX-USDT'])('edge retires %s, no model computation', async path => {
    const clock = jest.fn(() => { throw new Error('Retired simulation must never run'); });
    const response = nrxPublicResponse(new Request('https://market.local' + path), clock)!;
    expect(response.status).toBe(410); expect(await response.json()).toEqual({ error: 'market_retired', symbol: 'NRX' });
    expect(clock).not.toHaveBeenCalled();
  });
  test('edge HEAD/OPTIONS and unrelated routes remain safe', async () => {
    expect(await nrxPublicResponse(new Request('https://market.local/market/nrx', { method: 'HEAD' }))!.text()).toBe('');
    expect(nrxPublicResponse(new Request('https://market.local/market/nrx', { method: 'OPTIONS' }))!.status).toBe(204);
    expect(nrxPublicResponse(new Request('https://market.local/market/nrx', { method: 'POST' }))!.status).toBe(405);
    expect(nrxPublicResponse(new Request('https://market.local/market/listings'))).toBeNull();
    expect(nrxPublicResponse(new Request('https://market.local/market/ticker/NRXCOIN-USDT'))).toBeNull();
    expect(nrxPublicResponse(new Request('https://market.local/market/ticker/BTC-USDT?pair=NRX/BTC'))?.status).toBe(410);
  });
});
