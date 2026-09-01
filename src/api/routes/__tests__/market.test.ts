import request from 'supertest';
import express from 'express';
import { marketRouter } from '../market';
import { ExternalMarketDataError } from '../../../services/KrakenMarketDataService';
import { ExternalRankingError } from '../../../services/CoinGeckoService';

function buildApp(
  marketDataService: any,
  coinGeckoService: any = { getRankings: jest.fn().mockResolvedValue([]), getGlobalMarket: jest.fn().mockResolvedValue(null) },
  fearGreedService: any = { getIndex: jest.fn().mockResolvedValue(null) },
  prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(null) } }
) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', marketRouter(marketDataService, coinGeckoService, fearGreedService, prisma));
  return app;
}

describe('GET /market/featured-trader', () => {
  const photo = 'data:image/png;base64,iVBORw0KGgo=';

  it('returns the featured account photo', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ avatarUrl: photo }) } };
    const res = await request(buildApp({}, undefined, undefined, prisma)).get('/api/v1/market/featured-trader');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(photo);
  });

  it('reads exactly one designated account and only its photo', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ avatarUrl: photo }) } };
    await request(buildApp({}, undefined, undefined, prisma)).get('/api/v1/market/featured-trader');

    // The route must not be usable as a general user lookup: no filter it
    // accepts from the request, and only the avatar column selected.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { avatarUrl: true },
    });
  });

  it('returns null when no photo has been uploaded', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ avatarUrl: null }) } };
    const res = await request(buildApp({}, undefined, undefined, prisma)).get('/api/v1/market/featured-trader');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });

  it('returns null rather than failing when the lookup errors', async () => {
    const prisma = { user: { findFirst: jest.fn().mockRejectedValue(new Error('db down')) } };
    const res = await request(buildApp({}, undefined, undefined, prisma)).get('/api/v1/market/featured-trader');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
  });
});

describe('GET /market/global', () => {
  const globalData = {
    totalVolume24hUsd: 76_360_000_000,
    totalMarketCapUsd: 2_410_000_000_000,
    btcDominancePercent: 57.4,
    marketCapChangePercent24h: 1.8,
  };

  it('returns the market-wide totals and the published Fear & Greed reading', async () => {
    const coinGecko = { getRankings: jest.fn(), getGlobalMarket: jest.fn().mockResolvedValue(globalData) };
    const fearGreed = { getIndex: jest.fn().mockResolvedValue({ value: 71, classification: 'Greed', updatedAt: 1_735_689_600 }) };
    const app = buildApp({}, coinGecko, fearGreed);

    const res = await request(app).get('/api/v1/market/global');

    expect(res.status).toBe(200);
    expect(res.body.global.totalVolume24hUsd).toBe(76_360_000_000);
    expect(res.body.fearGreed).toEqual({ value: 71, classification: 'Greed', updatedAt: 1_735_689_600 });
  });

  it('still serves the volume totals when only the Fear & Greed source fails', async () => {
    const coinGecko = { getRankings: jest.fn(), getGlobalMarket: jest.fn().mockResolvedValue(globalData) };
    const fearGreed = { getIndex: jest.fn().mockRejectedValue(new Error('rate limited')) };
    const app = buildApp({}, coinGecko, fearGreed);

    const res = await request(app).get('/api/v1/market/global');

    expect(res.status).toBe(200);
    expect(res.body.global.totalVolume24hUsd).toBe(76_360_000_000);
    expect(res.body.fearGreed).toBeNull();
  });

  it('still serves the Fear & Greed reading when only CoinGecko fails', async () => {
    const coinGecko = { getRankings: jest.fn(), getGlobalMarket: jest.fn().mockRejectedValue(new Error('rate limited')) };
    const fearGreed = { getIndex: jest.fn().mockResolvedValue({ value: 71, classification: 'Greed', updatedAt: 1 }) };
    const app = buildApp({}, coinGecko, fearGreed);

    const res = await request(app).get('/api/v1/market/global');

    expect(res.status).toBe(200);
    expect(res.body.global).toBeNull();
    expect(res.body.fearGreed.value).toBe(71);
  });

  it('502s only when both sources fail', async () => {
    const coinGecko = { getRankings: jest.fn(), getGlobalMarket: jest.fn().mockRejectedValue(new Error('down')) };
    const fearGreed = { getIndex: jest.fn().mockRejectedValue(new Error('down')) };
    const app = buildApp({}, coinGecko, fearGreed);

    const res = await request(app).get('/api/v1/market/global');

    expect(res.status).toBe(502);
  });
});

describe('market routes', () => {
  it('GET /market/external/symbols returns the mirrored symbol list', async () => {
    const service = { listSymbols: jest.fn().mockResolvedValue([{ pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' }]) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/symbols');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('kraken');
    expect(res.body.symbols).toHaveLength(1);
  });

  it('GET /market/external/tickers returns all mirrored tickers', async () => {
    const service = { getTickers: jest.fn().mockResolvedValue([{ pair: 'BTC/USDT', lastPrice: '60000' }]) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/tickers');

    expect(res.status).toBe(200);
    expect(res.body.tickers[0].pair).toBe('BTC/USDT');
  });

  it('GET /market/external/tickers/:pair converts the hyphenated slug back to a slash pair', async () => {
    const service = { getTicker: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', lastPrice: '60000' }) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/tickers/BTC-USDT');

    expect(res.status).toBe(200);
    expect(service.getTicker).toHaveBeenCalledWith('BTC/USDT');
  });

  it('GET /market/external/tickers/:pair returns 404 for an unknown pair', async () => {
    const service = { getTicker: jest.fn().mockResolvedValue(null) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/tickers/NOPE-USDT');

    expect(res.status).toBe(404);
  });

  it('GET /market/external/orderbook/:pair returns the mirrored order book', async () => {
    const service = {
      getOrderBook: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', bids: [], asks: [], timestamp: 123 }),
    };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/orderbook/BTC-USDT?limit=10');

    expect(res.status).toBe(200);
    expect(service.getOrderBook).toHaveBeenCalledWith('BTC/USDT', 10);
    expect(res.body.pair).toBe('BTC/USDT');
  });

  it('caps the order book limit at 200', async () => {
    const service = {
      getOrderBook: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', bids: [], asks: [], timestamp: 123 }),
    };
    const app = buildApp(service);

    await request(app).get('/api/v1/market/external/orderbook/BTC-USDT?limit=9999');

    expect(service.getOrderBook).toHaveBeenCalledWith('BTC/USDT', 200);
  });

  it('returns 502 when the upstream service fails', async () => {
    const service = { listSymbols: jest.fn().mockRejectedValue(new ExternalMarketDataError('Kraken is down')) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/symbols');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Kraken is down');
  });

  it('GET /market/external/rankings returns the mirrored CoinGecko rankings', async () => {
    const coinGeckoService = {
      getRankings: jest.fn().mockResolvedValue([{ symbol: 'BTC', rank: 1, name: 'Bitcoin', image: 'btc.png', categories: [] }]),
    };
    const app = buildApp({}, coinGeckoService);

    const res = await request(app).get('/api/v1/market/external/rankings');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('coingecko');
    expect(res.body.rankings).toHaveLength(1);
  });

  it('GET /market/external/rankings returns 502 when CoinGecko fails', async () => {
    const coinGeckoService = { getRankings: jest.fn().mockRejectedValue(new ExternalRankingError('CoinGecko is down')) };
    const app = buildApp({}, coinGeckoService);

    const res = await request(app).get('/api/v1/market/external/rankings');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('CoinGecko is down');
  });
});
