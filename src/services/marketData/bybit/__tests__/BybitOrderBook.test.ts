import express from 'express';
import request from 'supertest';
import { BybitMarketDataService } from '../BybitMarketDataService';
import { MarketUniverse } from '../MarketUniverse';
import { marketDepthRouter } from '../../../../api/routes/marketDepth';

const BOOK = { s: 'BTCUSDT', b: [['100.5', '2'], ['100.4', '1']], a: [['100.6', '3']], ts: 1_700_000_000_000, u: 42, seq: 7 };

function fixture(overrides: { book?: any; retCode?: number; fail?: boolean } = {}) {
  let now = 1_000_000;
  const fetchFn = jest.fn(async (input: any) => {
    if (overrides.fail) throw new Error('unavailable');
    const url = new URL(String(input));
    if (url.pathname.endsWith('/orderbook')) {
      return { ok: true, status: 200, json: async () => ({ retCode: overrides.retCode ?? 0, retMsg: 'x', time: now, result: overrides.book ?? BOOK }) } as Response;
    }
    // instruments-info, for the universe the route validates against
    return { ok: true, status: 200, json: async () => ({ retCode: 0, time: now, result: {
      list: [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', settleCoin: 'USDT', status: 'Trading', contractType: 'LinearPerpetual' }],
      nextPageCursor: '' } }) } as Response;
  });
  const rest = new BybitMarketDataService({ fetchFn, now: () => now, sleep: async () => {} });
  return { rest, fetchFn, advance: (n: number) => { now += n; } };
}

test('one book, and concurrent readers share the single upstream request', async () => {
  const f = fixture();
  const [a, b, c] = await Promise.all([
    f.rest.getOrderBook('linear', 'BTCUSDT'),
    f.rest.getOrderBook('linear', 'BTCUSDT'),
    f.rest.getOrderBook('linear', 'BTCUSDT'),
  ]);
  // The whole load argument for the fallback: readers coalesce.
  expect(f.fetchFn).toHaveBeenCalledTimes(1);
  expect(a.value.bids).toEqual([{ price: '100.5', quantity: '2' }, { price: '100.4', quantity: '1' }]);
  expect(a.value.asks).toEqual([{ price: '100.6', quantity: '3' }]);
  expect(a.value.updateId).toBe(42);
  expect(a.value.providerTime).toBe(1_700_000_000_000);
  expect(b.value).toEqual(a.value); expect(c.value).toEqual(a.value);
  expect(f.fetchFn.mock.calls[0][0]).toContain('category=linear&symbol=BTCUSDT&limit=200');
});

test('within the TTL a second read costs nothing; past it, exactly one more request', async () => {
  const f = fixture();
  await f.rest.getOrderBook('linear', 'BTCUSDT');
  f.advance(900);
  await f.rest.getOrderBook('linear', 'BTCUSDT');
  expect(f.fetchFn).toHaveBeenCalledTimes(1);
  f.advance(200);
  await f.rest.getOrderBook('linear', 'BTCUSDT');
  expect(f.fetchFn).toHaveBeenCalledTimes(2);
});

test.each([
  ['a level that is not a pair', { ...BOOK, b: [['100.5']] }],
  ['a non-numeric price', { ...BOOK, b: [['abc', '1']] }],
  ['a zero price', { ...BOOK, b: [['0', '1']] }],
  ['a negative quantity', { ...BOOK, b: [['100.5', '-1']] }],
  ['a crossed book', { ...BOOK, b: [['200', '1']] }],
  ['someone else\'s symbol', { ...BOOK, s: 'ETHUSDT' }],
  ['no update id', { ...BOOK, u: 'nope' }],
])('%s refuses the whole book rather than returning a shorter one', async (_label, book) => {
  const f = fixture({ book });
  await expect(f.rest.getOrderBook('linear', 'BTCUSDT')).rejects.toThrow();
});

test('a non-zero retCode is a failure, not an empty book', async () => {
  const f = fixture({ retCode: 10001 });
  await expect(f.rest.getOrderBook('linear', 'BTCUSDT')).rejects.toThrow(/retCode 10001/);
});

test('a symbol the venue does not list never reaches the venue', async () => {
  const f = fixture();
  await expect(f.rest.getOrderBook('linear', 'not a symbol')).rejects.toThrow(/Unsupported symbol/);
  expect(f.fetchFn).not.toHaveBeenCalled();
});

describe('the fallback route', () => {
  async function app(f: ReturnType<typeof fixture>) {
    const universe = new MarketUniverse(f.rest);
    await universe.refresh();
    const server = express();
    server.use('/api/v1', marketDepthRouter(universe));
    return server;
  }

  it('serves a listed contract', async () => {
    const f = fixture();
    const res = await request(await app(f)).get('/api/v1/market/futures/orderbook/BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.symbol).toBe('BTCUSDT');
    expect(res.body.bids).toEqual([{ price: '100.5', quantity: '2' }, { price: '100.4', quantity: '1' }]);
    expect(res.body.updateId).toBe(42);
  });

  it('refuses an unlisted contract without calling the venue', async () => {
    const f = fixture();
    const server = await app(f);
    const before = f.fetchFn.mock.calls.length;
    const res = await request(server).get('/api/v1/market/futures/orderbook/DOGEUSDT');
    expect(res.body).toEqual({ available: false, reason: 'symbol_not_listed', detail: 'DOGEUSDT is not a listed linear perpetual.' });
    expect(f.fetchFn.mock.calls.length).toBe(before);
  });

  it('answers an outage with no levels at all, so nothing can be drawn as zero depth', async () => {
    const f = fixture();
    const server = await app(f);
    (f.fetchFn as jest.Mock).mockImplementation(async () => { throw new Error('venue down'); });
    const res = await request(server).get('/api/v1/market/futures/orderbook/BTCUSDT');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('provider_unavailable');
    expect(res.body.bids).toBeUndefined();
    expect(res.body.asks).toBeUndefined();
  });

  it('answers honestly when no venue is wired at all', async () => {
    const server = express();
    server.use('/api/v1', marketDepthRouter(null));
    const res = await request(server).get('/api/v1/market/futures/orderbook/BTCUSDT');
    expect(res.body.reason).toBe('provider_not_configured');
  });
});
