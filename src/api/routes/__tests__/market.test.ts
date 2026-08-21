import request from 'supertest';
import express from 'express';
import { marketRouter } from '../market';
import { ExternalMarketDataError } from '../../../services/BybitMarketDataService';

function buildApp(marketDataService: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', marketRouter(marketDataService));
  return app;
}

describe('market routes', () => {
  it('GET /market/external/symbols returns the mirrored symbol list', async () => {
    const service = { listSymbols: jest.fn().mockResolvedValue([{ pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT' }]) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/symbols');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('bybit');
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
    const service = { listSymbols: jest.fn().mockRejectedValue(new ExternalMarketDataError('Bybit is down')) };
    const app = buildApp(service);

    const res = await request(app).get('/api/v1/market/external/symbols');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Bybit is down');
  });
});
