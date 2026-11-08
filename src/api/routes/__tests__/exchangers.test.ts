import express from 'express';
import request from 'supertest';
import { exchangersRouter, type ExchangersRouterOptions } from '../exchangers';
import { BestChangeService, type ExchangersService } from '../../../services/exchangers/BestChangeService';
import fixture from '../../../services/exchangers/__tests__/fixtures/bestchange-openapi.json';

// Obviously fake: never a real key.
const KEY = 'TESTONLYfakeKey000000000000000003';

function fakeUpstream(mode: 'ok' | 'down' | 'invalidKey' = 'ok') {
  let calls = 0;
  const fetchFn = (async (input: RequestInfo | URL) => {
    calls += 1;
    const kind = new URL(String(input)).pathname.split('/')[3] as keyof typeof fixture;
    if (mode === 'down') throw new TypeError(`fetch failed ${String(input)}`);
    const body = mode === 'invalidKey' ? { error: 'Invalid API key' } : fixture[kind];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

function appWith(service: ExchangersService, options: ExchangersRouterOptions = {}, trustProxy = false) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.use('/api/v1', exchangersRouter(service, options));
  return app;
}

function realService(mode: 'ok' | 'down' | 'invalidKey' = 'ok', apiKey: string | undefined = KEY) {
  const up = fakeUpstream(mode);
  return { up, service: new BestChangeService({ apiKey, fetchFn: up.fetchFn }) };
}

let consoleOutput: string[];
beforeEach(() => {
  consoleOutput = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => {
  // express-rate-limit reports misconfiguration (double counting, proxy issues) as ERR_ERL_* on the console.
  expect(consoleOutput.join('\n')).not.toContain('ERR_ERL');
  jest.restoreAllMocks();
});

function expectNoLeak(res: request.Response) {
  const text = `${res.text} ${JSON.stringify(res.headers)}`;
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('bestchange.app');
  expect(text).not.toMatch(/fetch failed|Error/);
  const logs = consoleOutput.join('\n');
  expect(logs).not.toContain(KEY);
  expect(logs).not.toMatch(/https?:|\/v2\//);
}

const OK_QUERY = 'method=sbp&asset=USDT&network=tron&amount=10000';

describe('not configured', () => {
  it('both endpoints answer 200 not_configured, never 401, with no upstream call', async () => {
    const { up, service } = realService('ok', '');
    const app = appWith(service);
    for (const path of ['/api/v1/exchangers/directory', `/api/v1/exchangers/offers?${OK_QUERY}`]) {
      const res = await request(app).get(path).set('Authorization', 'Bearer stale-token');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'not_configured' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(up.calls()).toBe(0);
  });

  it('a rejected key also reads as not_configured and the key never appears', async () => {
    const { service } = realService('invalidKey');
    const res = await request(appWith(service)).get('/api/v1/exchangers/directory');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not_configured' });
    expectNoLeak(res);
  });
});

describe('ok answers', () => {
  it('directory: 200 with public 15 s cache', async () => {
    const { service } = realService();
    const res = await request(appWith(service)).get('/api/v1/exchangers/directory');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    expect(res.body.status).toBe('ok');
    expect(res.body.methods.map((m: { id: string }) => m.id)).toEqual(['sbp', 'sberbank', 'tbank', 'bc-test-bank-rub']);
    expect(res.body.assets).toHaveLength(3);
  });

  it('offers: 200 with the contract shape', async () => {
    const { service } = realService();
    const res = await request(appWith(service)).get(`/api/v1/exchangers/offers?${OK_QUERY}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    expect(res.body).toMatchObject({
      status: 'ok',
      stale: false,
      query: { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000 },
      directionLink: { url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' },
    });
    expect(res.body.offers.map((o: { id: string }) => o.id)).toEqual(['9202', '9201', '9204']);
    expect(Object.keys(res.body.offers[0]).sort()).toEqual(
      ['exchanger', 'fitsAmount', 'id', 'link', 'marks', 'maxRub', 'minRub', 'rankRubPerUnit', 'receiveAmount', 'reserve', 'rubPerUnit'].sort(),
    );
  });

  it.each([
    ['10000,5', 10000.5],
    ['10000.50', 10000.5],
    ['10 000', 10000],
    ['10%C2%A0000', 10000],
    ['1', 1],
    ['100000000', 100000000],
  ])('amount %s is accepted as %d', async (raw, expected) => {
    const { service } = realService();
    const res = await request(appWith(service)).get(`/api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=${raw.replace(/ /g, '%20')}`);
    expect(res.status).toBe(200);
    expect(res.body.query.amount).toBe(expected);
  });

  it('dynamic RUB extra method is accepted when it is in the live directory', async () => {
    const { service } = realService();
    const res = await request(appWith(service)).get('/api/v1/exchangers/offers?method=bc-test-bank-rub&asset=USDT&network=tron&amount=5000');
    expect(res.status).toBe(200);
    expect(res.body.offers.map((o: { id: string }) => o.id)).toEqual(['9205']);
  });
});

describe('strict validation ⇒ 400 {status:"invalid"}', () => {
  it.each([
    ['missing amount', 'method=sbp&asset=USDT&network=tron'],
    ['missing method', 'asset=USDT&network=tron&amount=100'],
    ['amount 0', 'method=sbp&asset=USDT&network=tron&amount=0'],
    ['amount above max', 'method=sbp&asset=USDT&network=tron&amount=100000001'],
    ['negative amount', 'method=sbp&asset=USDT&network=tron&amount=-5'],
    ['mixed separators', 'method=sbp&asset=USDT&network=tron&amount=1,234.56'],
    ['exponent', 'method=sbp&asset=USDT&network=tron&amount=1e5'],
    ['three decimals', 'method=sbp&asset=USDT&network=tron&amount=10.123'],
    ['unknown asset', 'method=sbp&asset=DOGE&network=tron&amount=100'],
    ['asset/network mismatch', 'method=sbp&asset=USDT&network=bitcoin&amount=100'],
    ['TRX on ethereum', 'method=sbp&asset=TRX&network=ethereum&amount=100'],
    ['lowercase asset', 'method=sbp&asset=usdt&network=tron&amount=100'],
    ['malformed method', 'method=..%2Fetc&asset=USDT&network=tron&amount=100'],
    ['unknown fixed-looking method', 'method=qiwi&asset=USDT&network=tron&amount=100'],
    ['method not in live directory', 'method=mir&asset=USDT&network=tron&amount=100'],
    ['dynamic method not in live directory', 'method=bc-nope&asset=USDT&network=tron&amount=100'],
    ['pair not resolved live', 'method=sbp&asset=ETH&network=ethereum&amount=100'],
    ['extra parameter', `${OK_QUERY}&ref=1`],
    ['duplicate parameter', `${OK_QUERY}&amount=5`],
    ['array parameter', 'method[]=sbp&asset=USDT&network=tron&amount=100'],
    ['object parameter', 'method[a]=sbp&asset=USDT&network=tron&amount=100'],
    ['oversized query', `${OK_QUERY}${'&x='.padEnd(300, 'x')}`],
  ])('%s', async (_name, query) => {
    const { service } = realService();
    const res = await request(appWith(service)).get(`/api/v1/exchangers/offers?${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'invalid' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('shape errors are refused before the service is asked', async () => {
    const service: ExchangersService = { isConfigured: () => true, directory: jest.fn(), offers: jest.fn() };
    const res = await request(appWith(service)).get('/api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=abc');
    expect(res.status).toBe(400);
    expect(service.offers).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('upstream down with no snapshot ⇒ 503 unavailable with Retry-After, nothing leaked', async () => {
    const { service } = realService('down');
    const app = appWith(service);
    for (const path of ['/api/v1/exchangers/directory', `/api/v1/exchangers/offers?${OK_QUERY}`]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unavailable', retryAfter: expect.any(Number) });
      expect(Number(res.headers['retry-after'])).toBe(res.body.retryAfter);
      expect(res.headers['cache-control']).toBe('no-store');
      expectNoLeak(res);
    }
  });

  it('a throwing service (message containing the key) ⇒ 503 with a fixed body; err.message is never returned or logged', async () => {
    const boom = new Error(`upstream https://bestchange.app/v2/${KEY}/rates/1-2 failed`);
    const service: ExchangersService = {
      isConfigured: () => true,
      directory: jest.fn().mockRejectedValue(boom),
      offers: jest.fn().mockRejectedValue(boom),
    };
    const app = appWith(service);
    for (const path of ['/api/v1/exchangers/directory', `/api/v1/exchangers/offers?${OK_QUERY}`]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'unavailable', retryAfter: 30 });
      expectNoLeak(res);
    }
  });
});

describe('rate limiting ⇒ 429 {status:"rate_limited", retryAfter}', () => {
  it('per client (req.ip)', async () => {
    const { service } = realService();
    const app = appWith(service, { perClientLimit: 3 });
    for (let i = 0; i < 3; i += 1) expect((await request(app).get('/api/v1/exchangers/directory')).status).toBe(200);
    const res = await request(app).get(`/api/v1/exchangers/offers?${OK_QUERY}`);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ status: 'rate_limited', retryAfter: expect.any(Number) });
    expect(res.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(res.body.retryAfter).toBeLessThanOrEqual(60);
    expect(Number(res.headers['retry-after'])).toBe(res.body.retryAfter);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('no shared ceiling: 10 saturated client addresses do not lock out an 11th (default limits)', async () => {
    const { up, service } = realService();
    const app = appWith(service, {}, true); // production sets trust proxy 1
    for (let c = 1; c <= 10; c += 1) {
      const ip = `10.0.0.${c}`;
      for (let i = 0; i < 60; i += 1) expect((await request(app).get('/api/v1/exchangers/directory').set('X-Forwarded-For', ip)).status).toBe(200);
      // That client is now at its own per-client limit.
      expect((await request(app).get('/api/v1/exchangers/directory').set('X-Forwarded-For', ip)).status).toBe(429);
    }
    const victim = await request(app).get(`/api/v1/exchangers/offers?${OK_QUERY}`).set('X-Forwarded-For', '203.0.113.9');
    expect(victim.status).toBe(200);
    expect(victim.body.status).toBe('ok');
    // 610 client requests still cost only the 3 snapshot calls upstream.
    expect(up.calls()).toBe(3);
  });

  it('the limiter is scoped to /exchangers and does not touch other /api/v1 routes', async () => {
    const { service } = realService();
    const app = express();
    app.use('/api/v1', exchangersRouter(service, { perClientLimit: 1 }));
    app.get('/api/v1/other', (_req, res) => { res.json({ ok: true }); });
    await request(app).get('/api/v1/exchangers/directory');
    expect((await request(app).get('/api/v1/exchangers/directory')).status).toBe(429);
    for (let i = 0; i < 3; i += 1) expect((await request(app).get('/api/v1/other')).status).toBe(200);
  });
});

describe('upstream load does not scale with clients', () => {
  it('40 requests through the router cost exactly 3 upstream calls (currencies, changers, one batched rates)', async () => {
    const { up, service } = realService();
    const app = appWith(service, {}, true); // production sets trust proxy 1
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
      request(app).get(i % 2 ? '/api/v1/exchangers/directory' : `/api/v1/exchangers/offers?${OK_QUERY}`).set('X-Forwarded-For', `203.0.113.${i}`)));
    expect(up.calls()).toBe(3);
  });
});
