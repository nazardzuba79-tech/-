import express from 'express';
import request from 'supertest';
import { marketDataRouter } from '../marketData';

/**
 * GET /market/universe — the DISCOVERABLE market universe.
 *
 * The whole point of this endpoint is that it is NOT the executable set.
 * A market listed here is a statement that it exists in the world; whether
 * VOLTEX will take an order on it is decided by FuturesMarketRegistry and
 * is a strict subset.
 */

const gateway = {} as any;
const prisma = {} as any;

function instrument(over: Record<string, unknown> = {}) {
  return {
    symbol: 'BTC/USDT',
    providerSymbol: 'BTCUSDT',
    provider: 'bybit',
    marketType: 'linear_perpetual',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    settleAsset: 'USDT',
    status: 'Trading',
    launchTime: 1, deliveryTime: null, providerMaxLeverage: 100, fundingIntervalMinutes: 480,
    filters: { tickSize: 0.1, qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 1, minNotional: 5, maxNotional: null, pricePrecision: 1, qtyPrecision: 3 },
    ...over,
  };
}

function app(universe: any) {
  const server = express();
  server.use('/api/v1', marketDataRouter(prisma, gateway, null, universe));
  return server;
}

const loaded = (instruments: any[], over: { refreshedAt?: number | null; stale?: boolean } = {}) => ({
  snapshot: () => ({
    instruments,
    refreshedAt: over.refreshedAt ?? 1_700_000_000_000,
    stale: over.stale ?? false,
    loaded: true,
  }),
});

describe('GET /market/universe', () => {
  it('answers honestly when no venue is wired', async () => {
    const res = await request(app(null)).get('/api/v1/market/universe');
    expect(res.body).toEqual({
      available: false,
      reason: 'provider_not_configured',
      detail: expect.any(String),
    });
    // No `value`, so nothing can be rendered as an empty exchange.
    expect(res.body.value).toBeUndefined();
  });

  it('says "not loaded" rather than "no markets" before the first refresh', async () => {
    const res = await request(app({ snapshot: () => ({ instruments: [], refreshedAt: null, stale: false, loaded: false }) }))
      .get('/api/v1/market/universe');
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('provider_unavailable');
    // The distinction that matters: an outage must never arrive as [].
    expect(res.body.value).toBeUndefined();
  });

  it('returns counts per market type without conflating them', async () => {
    const res = await request(
      app(
        loaded([
          instrument(),
          instrument({ symbol: 'ETH/USDT', providerSymbol: 'ETHUSDT', baseAsset: 'ETH' }),
          instrument({ symbol: 'BTC/USDT', providerSymbol: 'BTC-27JUN25', marketType: 'linear_futures' }),
          instrument({ symbol: 'SOL/USDT', providerSymbol: 'SOLUSDT', marketType: 'spot', settleAsset: null }),
          instrument({ symbol: 'BTC/USD', providerSymbol: 'BTCUSD', marketType: 'inverse' }),
        ])
      )
    ).get('/api/v1/market/universe');

    expect(res.body.available).toBe(true);
    expect(res.body.value.counts).toEqual({ spot: 1, linearPerpetual: 2, linearFutures: 1, inverse: 1 });
    expect(res.body.value.instruments).toHaveLength(5);
  });

  it('filters by market type without inventing one', async () => {
    const res = await request(
      app(loaded([instrument(), instrument({ symbol: 'SOL/USDT', marketType: 'spot', settleAsset: null })]))
    ).get('/api/v1/market/universe?type=spot');
    expect(res.body.value.instruments).toHaveLength(1);
    expect(res.body.value.instruments[0].marketType).toBe('spot');
  });

  it('serves the whole universe in ONE response, with no per-instrument work', async () => {
    const many = Array.from({ length: 1200 }, (_, i) =>
      instrument({ symbol: `C${i}/USDT`, providerSymbol: `C${i}USDT`, baseAsset: `C${i}` })
    );
    const universe = loaded(many);
    const spy = jest.spyOn(universe, 'snapshot');
    const res = await request(app(universe)).get('/api/v1/market/universe');
    expect(res.body.value.instruments).toHaveLength(1200);
    // Read once. Nothing fans out per market.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('carries provenance in the payload for diagnostics', async () => {
    // Internal provenance is required; the customer-facing UI never
    // renders it (frontend/src/lib/__tests__/noProviderBranding.test.ts).
    const res = await request(app(loaded([instrument()]))).get('/api/v1/market/universe');
    expect(res.body.value.instruments[0].provider).toBe('bybit');
    expect(res.body.value.instruments[0].providerSymbol).toBe('BTCUSDT');
  });

  it('never converts a missing filter into a zero', async () => {
    const res = await request(
      app(loaded([instrument({ filters: { tickSize: null, qtyStep: null, minOrderQty: null, maxOrderQty: null, minNotional: null, maxNotional: null, pricePrecision: null, qtyPrecision: null } })]))
    ).get('/api/v1/market/universe');
    expect(res.body.value.instruments[0].filters.tickSize).toBeNull();
    expect(res.body.value.instruments[0].filters.qtyStep).toBeNull();
  });

  // ── Freshness is carried through, never restated ──────────────────
  //
  // The route used to hardcode `stale: false`, so a stale-last-good
  // universe reached the client looking freshly refreshed. Both fields now
  // come from the snapshot, which in turn comes from the provider cache.

  it('reports a fresh universe as fresh, dated by the provider', async () => {
    const res = await request(app(loaded([instrument()], { refreshedAt: 1_700_000_000_000, stale: false })))
      .get('/api/v1/market/universe');
    expect(res.body.available).toBe(true);
    expect(res.body.stale).toBe(false);
    expect(res.body.fetchedAt).toBe(1_700_000_000_000);
  });

  it('marks a stale-last-good universe stale while still serving it', async () => {
    const res = await request(app(loaded([instrument()], { refreshedAt: 1_600_000_000_000, stale: true })))
      .get('/api/v1/market/universe');
    // Still usable — the stale budget exists precisely so an outage does
    // not empty the exchange…
    expect(res.body.available).toBe(true);
    expect(res.body.value.instruments).toHaveLength(1);
    // …but never presented as a fresh read.
    expect(res.body.stale).toBe(true);
    // And dated when the PROVIDER produced it, not when we served it.
    expect(res.body.fetchedAt).toBe(1_600_000_000_000);
    expect(res.body.fetchedAt).toBeLessThan(Date.now());
  });

  it('does not re-date a stale universe to the moment it was read', async () => {
    const dated = 1_500_000_000_000;
    const universe = loaded([instrument()], { refreshedAt: dated, stale: true });
    const first = await request(app(universe)).get('/api/v1/market/universe');
    const second = await request(app(universe)).get('/api/v1/market/universe');
    expect(first.body.fetchedAt).toBe(dated);
    expect(second.body.fetchedAt).toBe(dated);
  });
});
