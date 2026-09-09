import express from 'express';
import request from 'supertest';
import { marketDataRouter } from '../marketData';
import { BybitMarketDataService } from '../../../services/marketData/bybit/BybitMarketDataService';
import { MarketUniverse } from '../../../services/marketData/bybit/MarketUniverse';

/** Measurement, not assertion-of-taste: these numbers go in the report. */
const perp = (s: string) => ({
  symbol: s, contractType: 'LinearPerpetual', status: 'Trading',
  baseCoin: s.replace('USDT', ''), quoteCoin: 'USDT', settleCoin: 'USDT',
  launchTime: '1584230400000', deliveryTime: '0', fundingInterval: 480,
  leverageFilter: { maxLeverage: '100.00' }, priceFilter: { tickSize: '0.10' },
  lotSizeFilter: { minOrderQty: '0.001', maxOrderQty: '1190', qtyStep: '0.001', minNotionalValue: '5' },
});
const spotRow = (s: string) => ({
  symbol: s, baseCoin: s.replace('USDT', ''), quoteCoin: 'USDT', status: 'Trading',
  priceFilter: { tickSize: '0.01' },
  lotSizeFilter: { basePrecision: '0.000001', minOrderQty: '0.0001', maxOrderQty: '71', minOrderAmt: '1', maxOrderAmt: '2000000' },
});
const ok = (list: unknown[], cursor: string | null = null) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => ({ retCode: 0, retMsg: 'OK', result: { list, nextPageCursor: cursor } }),
});

it('MEASUREMENT: universe request count and payload size', async () => {
  // Shaped like today's real Bybit scale: ~700 spot, ~1200 linear.
  const pages = [
    { rows: Array.from({ length: 1000 }, (_, i) => perp(`L${i}USDT`)), cursor: 'c1' },
    { rows: Array.from({ length: 200 }, (_, i) => perp(`M${i}USDT`)), cursor: null },
  ];
  let page = 0;
  const calls: string[] = [];
  const fetchFn = jest.fn(async (url: string) => {
    calls.push(url);
    if (url.includes('/v5/market/tickers')) {
      return ok(Array.from({ length: 1200 }, (_, i) => ({ symbol: `L${i}USDT`, lastPrice: '1.5', price24hPcnt: '0.01', turnover24h: '1000' })));
    }
    if (url.includes('category=spot')) return ok(Array.from({ length: 700 }, (_, i) => spotRow(`S${i}USDT`)));
    const p = pages[page++];
    return ok(p.rows, p.cursor);
  }) as unknown as typeof fetch;

  const svc = new BybitMarketDataService({ fetchFn, baseUrl: 'https://stub', sleep: async () => {} });
  const universe = new MarketUniverse(svc);
  const t0 = Date.now();
  await universe.refresh();
  const buildMs = Date.now() - t0;

  const app = express();
  app.use('/api/v1', marketDataRouter({} as any, {} as any, null, universe));
  const full = await request(app).get('/api/v1/market/universe');
  const perpsOnly = await request(app).get('/api/v1/market/universe?type=linear_perpetual');

  // A ticker refresh for the whole exchange.
  const before = svc.upstreamRequestCount;
  await Promise.all(Array.from({ length: 100 }, () => svc.getTickers('linear')));
  const tickerRequests = svc.upstreamRequestCount - before;

  const kb = (r: any) => Math.round(JSON.stringify(r.body).length / 1024);
  // Express gzips this in production; the wire size is what matters.
  const gzipKb = (r: any) =>
    Math.round(require('zlib').gzipSync(Buffer.from(JSON.stringify(r.body))).length / 1024);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    upstreamRequestsToBuildUniverse: calls.filter((u) => u.includes('instruments-info')).length,
    instruments: full.body.value.instruments.length,
    counts: full.body.value.counts,
    fullUniversePayloadKB: kb(full),
    fullUniverseGzipKB: gzipKb(full),
    perpetualsOnlyPayloadKB: kb(perpsOnly),
    perpetualsOnlyGzipKB: gzipKb(perpsOnly),
    upstreamRequestsFor100ConcurrentTickerReaders: tickerRequests,
    universeBuildMs: buildMs,
  }, null, 2));

  expect(calls.filter((u) => u.includes('instruments-info'))).toHaveLength(3);
  expect(tickerRequests).toBe(1);
});
