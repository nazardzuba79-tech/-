import express from 'express';
import request from 'supertest';
jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireTradePermission: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockFeed = {
  running: false,
  start: jest.fn(() => { mockFeed.running = true; }),
  stop: jest.fn(() => { mockFeed.running = false; }),
  getQuotes: async () => [],
  diagnostics: () => ({}),
  isConfigured: () => false,
};
jest.mock('../../services/marketData/cfd/DerivPublicStreamQuoteSource', () => ({
  DerivPublicStreamQuoteSource: jest.fn(() => mockFeed),
}));
jest.mock('../../services/marketData/cfd/BiquoteCfdQuoteSource', () => ({
  BiquoteCfdQuoteSource: jest.fn(() => ({ getQuotes: async () => [], diagnostics: () => ({}) })),
}));
jest.mock('../../services/marketData/cfd/EiaOilDisplaySource', () => ({
  EiaOilDisplaySource: jest.fn(() => ({ getQuotes: async () => [], diagnostics: () => ({}) })),
}));
import * as routes from '../../api/routes/cfd';

test('a disposable HTTP host can release its live display feed and start a later host', async () => {
  const env = process.env.NODE_ENV;
  let router;
  try {
    // Exercise the same default display source as the browser QA host, not
    // the null source normally selected under NODE_ENV=test.
    process.env.NODE_ENV = 'production';
    router = routes.cfdRouter({} as any, {
      getQuotes: async () => [], catalog: () => [], isConfigured: () => false,
    } as any, {} as any);
  } finally { process.env.NODE_ENV = env; }
  const app = express().use('/api/v1', router);
  await request(app).get('/api/v1/cfd/tickers').expect(200);
  await request(app).get('/api/v1/cfd/tickers').expect(200);
  expect(mockFeed.running).toBe(true);
  expect(mockFeed.start).toHaveBeenCalledTimes(1);

  const stop = (routes as typeof routes & { stopCfdDisplayFeeds: () => void }).stopCfdDisplayFeeds;
  expect(typeof stop).toBe('function');
  stop(); stop();
  expect(mockFeed.running).toBe(false);
  await request(app).get('/api/v1/cfd/tickers').expect(200);
  expect(mockFeed.running).toBe(true);
  expect(mockFeed.start).toHaveBeenCalledTimes(2);
  stop();
  expect(mockFeed.running).toBe(false);
});
