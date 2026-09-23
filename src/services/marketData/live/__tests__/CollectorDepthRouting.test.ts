/**
 * The API-region fallback order book.
 *
 * Oregon may not call Bybit directly. `CollectorUniverseProvider` enforces
 * that by disabling its inherited transport — but it only overrode the three
 * instrument-list methods, so `getOrderBook` reached the disabled transport
 * and every depth request in the API region came back as
 * "Direct Bybit access disabled in API region": our own policy reported to
 * the customer as a venue outage.
 *
 * These cases pin the route through the collector, and the things that must
 * NOT happen on the way.
 */
import express from 'express';
import request from 'supertest';
import { CollectorUniverseProvider, MarketDataCollectorClient } from '../MarketDataCollectorClient';
import { marketDepthRouter } from '../../../../api/routes/marketDepth';
import type { MarketUniverse } from '../../bybit/MarketUniverse';
import type { NormalizedInstrument } from '../../bybit/types';

const filters = { tickSize: 0.1, qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100, minNotional: 5, maxNotional: null, pricePrecision: 1, qtyPrecision: 3 };

function perp(providerSymbol: string, symbol: string): NormalizedInstrument {
  return { symbol, providerSymbol, provider: 'bybit', marketType: 'linear_perpetual', baseAsset: symbol.split('/')[0],
    quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', launchTime: 1, deliveryTime: null, filters,
    providerMaxLeverage: 100, fundingIntervalMinutes: 480 };
}

function book(symbol: string) {
  return { value: { symbol, bids: [{ price: '86000.1', quantity: '1.5' }, { price: '86000.0', quantity: '2' }],
    asks: [{ price: '86000.9', quantity: '1.1' }], updateId: 4242, providerTime: 1700000000000 },
    fetchedAt: 1700000000123, stale: false };
}

/** Counts what actually went where, so "no direct Bybit" is measured. */
function harness(depth: (symbol: string) => { status: number; body?: unknown; delayMs?: number }) {
  const seen = { collector: 0, bybitDirect: 0, symbols: [] as string[] };
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('bybit')) { seen.bybitDirect += 1; return new Response('{}', { status: 200 }); }
    if (url.includes('/internal/v1/futures/orderbook/')) {
      const symbol = decodeURIComponent(url.split('/').pop()!);
      seen.collector += 1; seen.symbols.push(symbol);
      const answer = depth(symbol);
      if (answer.delayMs) await new Promise((r) => setTimeout(r, answer.delayMs));
      return new Response(answer.body === undefined ? '{}' : JSON.stringify(answer.body), { status: answer.status });
    }
    return new Response(JSON.stringify({ instruments: [], refreshedAt: 1, stale: false, loaded: true }), { status: 200 });
  };
  const client = new MarketDataCollectorClient('https://collector.example', 'secret', fetchFn);
  const provider = new CollectorUniverseProvider(client);
  const universe = { provider, perpetualCandidates: () => [perp('BTCUSDT', 'BTC/USDT'), perp('ETHUSDT', 'ETH/USDT')] } as unknown as MarketUniverse;
  const app = express().use(marketDepthRouter(universe));
  return { app, seen, provider };
}

describe('futures order book in the API region', () => {
  // A + B: a healthy collector answers, and it answers *because* the direct
  // path is disabled — the whole point of the fix.
  it('A/B: returns real depth through the collector while direct Bybit is disabled', async () => {
    const { app, seen } = harness((s) => ({ status: 200, body: book(s) }));
    const res = await request(app).get('/market/futures/orderbook/BTCUSDT').expect(200);

    expect(res.body.available).toBe(true);
    expect(res.body.symbol).toBe('BTCUSDT');
    expect(res.body.bids).toHaveLength(2);
    expect(res.body.asks).toHaveLength(1);
    expect(res.body.updateId).toBe(4242);
    expect(res.body.providerTime).toBe(1700000000000);
    expect(res.body.stale).toBe(false);
    // The regression itself: this string must never reach a customer again.
    expect(JSON.stringify(res.body)).not.toContain('Direct Bybit access disabled');
    expect(seen.collector).toBe(1);
    expect(seen.bybitDirect).toBe(0);
  });

  // G: stated separately because it is the policy, not an implementation detail.
  it('G: makes no direct Bybit request from the restricted region, even on success', async () => {
    const { app, seen } = harness((s) => ({ status: 200, body: book(s) }));
    await request(app).get('/market/futures/orderbook/BTCUSDT');
    await request(app).get('/market/futures/orderbook/ETHUSDT');
    expect(seen.bybitDirect).toBe(0);
    expect(seen.collector).toBe(2);
  });

  it('C: a collector timeout fails bounded — one hop, no storm, no fake book', async () => {
    const { app, seen } = harness(() => ({ status: 504 }));
    const res = await request(app).get('/market/futures/orderbook/BTCUSDT').expect(200);

    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('provider_unavailable');
    // No levels at all — an unreachable venue is not an empty book.
    expect(res.body.bids).toBeUndefined();
    expect(res.body.asks).toBeUndefined();
    // One attempt. The collector client is constructed with retries: 0.
    expect(seen.collector).toBe(1);
  });

  it('D: a collector 500 is reported truthfully as unavailable, not as zero depth', async () => {
    const { app } = harness(() => ({ status: 500, body: { error: 'orderbook_unavailable' } }));
    const res = await request(app).get('/market/futures/orderbook/BTCUSDT').expect(200);

    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('provider_unavailable');
    expect(res.body).not.toHaveProperty('bids');
    // The venue's own words never reach the customer.
    expect(JSON.stringify(res.body)).not.toContain('Direct Bybit');
  });

  it('E: accepts the symbol spellings the route already supported', async () => {
    const { app } = harness((s) => ({ status: 200, body: book(s) }));
    for (const spelling of ['BTCUSDT', 'btcusdt', 'BTC/USDT']) {
      const res = await request(app).get(`/market/futures/orderbook/${encodeURIComponent(spelling)}`).expect(200);
      expect(res.body.available).toBe(true);
      expect(res.body.symbol).toBe('BTCUSDT');
    }
  });

  it('E: BTC-USDT is NOT a supported spelling today, and says so honestly', async () => {
    // Recorded rather than changed. The route normalizes with
    // `.toUpperCase().replace('/','')`, which strips a slash and nothing
    // else, so a hyphenated symbol has never matched a listed contract. It
    // is answered as not-listed — truthful, and it never reaches the venue.
    // Widening this is a product decision, not part of the region fix.
    const { app, seen } = harness((s) => ({ status: 200, body: book(s) }));
    const res = await request(app).get('/market/futures/orderbook/BTC-USDT').expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('symbol_not_listed');
    expect(seen.collector).toBe(0);
  });

  it('E: an unlisted contract is answered honestly, and never reaches the venue', async () => {
    const { app, seen } = harness((s) => ({ status: 200, body: book(s) }));
    const res = await request(app).get('/market/futures/orderbook/NOTREAL').expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('symbol_not_listed');
    expect(seen.collector).toBe(0);
  });

  it('F: never substitutes Spot depth — only linear perpetual passes', async () => {
    const { provider, seen } = harness((s) => ({ status: 200, body: book(s) }));
    await expect(provider.getOrderBook('spot', 'BTCUSDT')).rejects.toThrow(/linear perpetuals only/);
    await expect(provider.getOrderBook('inverse', 'BTCUSD')).rejects.toThrow(/linear perpetuals only/);
    expect(seen.collector).toBe(0);
    expect(seen.bybitDirect).toBe(0);
  });

  it('F: refuses a book the collector returns for a different contract', async () => {
    // The wrong market rendered under the right label is worse than no book.
    const { provider } = harness(() => ({ status: 200, body: book('ETHUSDT') }));
    await expect(provider.getOrderBook('linear', 'BTCUSDT')).rejects.toThrow(/different symbol/);
  });

  it('H: concurrent callers on one contract share a single collector hop', async () => {
    const { app, seen } = harness((s) => ({ status: 200, body: book(s), delayMs: 20 }));
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => request(app).get('/market/futures/orderbook/BTCUSDT')));
    responses.forEach((r) => { expect(r.body.available).toBe(true); expect(r.body.updateId).toBe(4242); });
    expect(seen.collector).toBe(1);
  });

  it('I: serves depth without touching Prisma or any database', async () => {
    // The route takes only a MarketUniverse. Nothing database-shaped is in
    // reach, and the collector client speaks HTTP to one configured origin.
    const { app, seen } = harness((s) => ({ status: 200, body: book(s) }));
    await request(app).get('/market/futures/orderbook/BTCUSDT').expect(200);
    expect(marketDepthRouter.length).toBe(1);
    expect(seen.collector).toBe(1);
  });
});
