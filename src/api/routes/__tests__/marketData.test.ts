process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { marketDataRouter } from '../marketData';

/**
 * The gateway's HTTP contract.
 *
 * Two things matter most here and are asserted structurally rather than by
 * example:
 *
 *   1. An unavailable section carries NO value-carrying fields on the
 *      wire. A client literally cannot plot an outage as zero, because
 *      there is nothing in the payload to plot.
 *   2. Provider health is admin-gated. It says which upstreams are failing
 *      and how often they rate-limit us — operational detail an ordinary
 *      client has no business seeing.
 */

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function prismaFor(role: string | null) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
    session: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null }) },
  } as any;
}

const TICKER = {
  pair: 'BTC/USDT',
  lastPrice: '50000',
  bidPrice: '49999',
  askPrice: '50001',
  high24h: '51000',
  low24h: '49000',
  volume24h: '0',
  quoteVolume24h: '1000',
  changePercent24h: '2.5',
};

function asset(over: Record<string, unknown> = {}) {
  return {
    id: 'cg:bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    logoUrl: 'btc.png',
    providers: { coingecko: 'bitcoin', kraken: 'BTC' },
    tradingPairs: ['BTC/USDT'],
    tradable: true,
    metadataSource: 'coingecko',
    rank: 1,
    ambiguous: false,
    collidingIds: [],
    ...over,
  };
}

function gatewayStub(over: Record<string, unknown> = {}) {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      tickers: { available: true, source: 'kraken', fetchedAt: 1, stale: false, value: [TICKER] },
      overview: { available: false, reason: 'provider_unavailable', detail: 'coingecko down' },
      sentiment: { available: true, source: 'alternative.me', fetchedAt: 1, stale: false, value: { value: 61, classification: 'Greed', updatedAt: 1 } },
    }),
    // The route now calls queryAssets, which does the filtering/sorting/
    // paging inside the registry over the cached join. The stub mirrors
    // that: it applies the tradable filter so the route's own behaviour
    // stays observable.
    queryAssets: jest.fn(async (options: any = {}) => {
      const all = [
        asset(),
        asset({ id: 'cg:monero', symbol: 'XMR', name: 'Monero', tradable: false, tradingPairs: [], rank: 30 }),
      ];
      const matched = options.tradableOnly ? all.filter((a) => a.tradable) : all;
      return {
        available: true,
        source: 'coingecko',
        fetchedAt: 1,
        stale: false,
        value: {
          assets: matched.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100)),
          matched: matched.length,
          catalogueTotal: all.length,
          tradableCount: all.filter((a) => a.tradable).length,
          collisions: [],
          metadataComplete: true,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
        },
      };
    }),
    iconMetadata: jest.fn().mockResolvedValue({ BTC: { id: 'cg:bitcoin', name: 'Bitcoin', logoUrl: 'btc.png' } }),
    getTradableMarkets: jest.fn().mockResolvedValue({ available: true, source: 'kraken', fetchedAt: 1, stale: false, value: [] }),
    getTicker: jest.fn().mockResolvedValue({ available: true, source: 'kraken', fetchedAt: 1, stale: false, value: TICKER }),
    getStatus: jest.fn().mockResolvedValue({ providers: [{ provider: 'kraken', state: 'CLOSED' }], capabilities: [], catalogue: null }),
    ...over,
  } as any;
}

function buildApp(prisma: any, gateway: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', marketDataRouter(prisma, gateway));
  return app;
}

describe('market data gateway routes', () => {
  it('serves one snapshot carrying source and freshness per section', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/snapshot');

    expect(res.status).toBe(200);
    expect(res.body.tickers.source).toBe('kraken');
    expect(res.body.tickers.stale).toBe(false);
    expect(typeof res.body.tickers.fetchedAt).toBe('number');
  });

  it('sends an unavailable section with NO value-carrying fields', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/snapshot');

    expect(res.body.overview.available).toBe(false);
    expect(Object.keys(res.body.overview).sort()).toEqual(['available', 'detail', 'reason']);
    expect(res.body.overview).not.toHaveProperty('value');
    // Nothing a chart could read as a zero market cap.
    expect(res.body.overview.totalMarketCapUsd).toBeUndefined();
  });

  it('answers 200 for a degraded section — a provider outage is not a VOLTEX fault', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/snapshot');
    expect(res.status).toBe(200);
  });

  it('preserves a real zero through the wire', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/snapshot');
    expect(res.body.tickers.value[0].volume24h).toBe('0');
  });

  it('keeps the catalogue and the tradable set distinct', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/assets');

    expect(res.status).toBe(200);
    expect(res.body.value.catalogueTotal).toBe(2);
    expect(res.body.value.tradableCount).toBe(1);
    expect(res.body.value.matched).toBe(2);
    // Every asset carries a namespaced canonical id, not a bare ticker.
    expect(res.body.value.assets.every((a: any) => a.id.includes(':'))).toBe(true);
  });

  it('filters the catalogue to executable markets on request', async () => {
    const res = await request(buildApp(prismaFor(null), gatewayStub())).get('/api/v1/market/assets?tradable=true');

    expect(res.body.value.assets).toHaveLength(1);
    expect(res.body.value.assets[0].symbol).toBe('BTC');
    expect(res.body.value.matched).toBe(1);
    // The catalogue total is still reported, so a UI can say "1 of 2
    // tradable" rather than pretending the catalogue is one asset.
    expect(res.body.value.catalogueTotal).toBe(2);
  });

  it('passes search, sort and direction through to the registry', async () => {
    const gateway = gatewayStub();
    await request(buildApp(prismaFor(null), gateway)).get(
      '/api/v1/market/assets?search=bit&sort=marketCap&dir=asc&limit=25&offset=50'
    );

    expect(gateway.queryAssets).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'bit', sort: 'marketCap', direction: 'asc', limit: 25, offset: 50 })
    );
  });

  it('ignores an unknown sort key rather than passing it through', async () => {
    const gateway = gatewayStub();
    await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/assets?sort=DROP%20TABLE');
    expect(gateway.queryAssets.mock.calls[0][0].sort).toBeUndefined();
  });

  it('bounds an oversized search string', async () => {
    const gateway = gatewayStub();
    await request(buildApp(prismaFor(null), gateway)).get(`/api/v1/market/assets?search=${'a'.repeat(500)}`);
    expect(gateway.queryAssets.mock.calls[0][0].search.length).toBeLessThanOrEqual(64);
  });

  it('clamps a hostile limit instead of trusting it', async () => {
    const gateway = gatewayStub();
    const res = await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/assets?limit=999999&offset=-5');

    // Clamped to the 1000 ceiling — which exists so the Markets page can
    // load the whole catalogue once — not to whatever the client asked for.
    expect(gateway.queryAssets.mock.calls[0][0].limit).toBe(1000);
    expect(gateway.queryAssets.mock.calls[0][0].offset).toBe(0);
    expect(res.body.value.limit).toBeLessThanOrEqual(1000);
    expect(res.body.value.offset).toBeGreaterThanOrEqual(0);
  });

  it('returns icon metadata for a batch and omits unknown symbols', async () => {
    const gateway = gatewayStub();
    const res = await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/assets/icons?symbols=btc,nope');

    expect(res.status).toBe(200);
    expect(gateway.iconMetadata).toHaveBeenCalledWith(['BTC', 'NOPE']);
    expect(res.body.assets.BTC.id).toBe('cg:bitcoin');
    // Absent, not present-and-empty: the client's letter fallback covers it.
    expect(res.body.assets.NOPE).toBeUndefined();
  });

  it('does not call the gateway at all for an empty symbol list', async () => {
    const gateway = gatewayStub();
    const res = await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/assets/icons?symbols=');

    expect(res.body).toEqual({ assets: {} });
    expect(gateway.iconMetadata).not.toHaveBeenCalled();
  });

  it('bounds an oversized symbol list rather than walking the catalogue for it', async () => {
    const gateway = gatewayStub();
    const symbols = Array.from({ length: 900 }, (_, i) => `S${i}`).join(',');
    await request(buildApp(prismaFor(null), gateway)).get(`/api/v1/market/assets/icons?symbols=${symbols}`);

    expect(gateway.iconMetadata.mock.calls[0][0].length).toBeLessThanOrEqual(500);
  });

  it('degrades icons to an empty map rather than failing the page', async () => {
    const gateway = gatewayStub({ iconMetadata: jest.fn().mockRejectedValue(new Error('boom')) });
    const res = await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/assets/icons?symbols=BTC');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assets: {} });
  });

  it('keeps provider health admin-only', async () => {
    const gateway = gatewayStub();

    const anon = await request(buildApp(prismaFor('ADMIN'), gateway)).get('/api/v1/market/status');
    expect(anon.status).toBe(401);

    const user = await request(buildApp(prismaFor('USER'), gateway))
      .get('/api/v1/market/status')
      .set('Authorization', authHeader('u1'));
    expect(user.status).toBe(403);

    expect(gateway.getStatus).not.toHaveBeenCalled();

    const admin = await request(buildApp(prismaFor('ADMIN'), gateway))
      .get('/api/v1/market/status')
      .set('Authorization', authHeader('a1'));
    expect(admin.status).toBe(200);
    expect(admin.body.providers[0].provider).toBe('kraken');
  });

  it('converts a hyphenated pair param back to the internal format', async () => {
    const gateway = gatewayStub();
    await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/ticker/BTC-USDT');
    expect(gateway.getTicker).toHaveBeenCalledWith('BTC/USDT');
  });

  it('returns 500 only for a structural failure, not a provider one', async () => {
    const gateway = gatewayStub({ getSnapshot: jest.fn().mockRejectedValue(new Error('structural')) });
    const res = await request(buildApp(prismaFor(null), gateway)).get('/api/v1/market/snapshot');

    expect(res.status).toBe(500);
    // The error body never carries the internal message.
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
