import {
  BestChangeService,
  bestChangeServiceFromEnv,
  FAILURE_COOLDOWN_MS,
  resolveCacheTtlSeconds,
  SNAPSHOT_MAX_STALE_MS,
} from '../BestChangeService';
import type { DirectoryOkResponse, OffersOkResponse, OffersQuery } from '../../../shared/exchangers/types';
import fixture from './fixtures/bestchange-openapi.json';

// Obviously fake: never a real key.
const KEY = 'TESTONLYfakeKey000000000000000002';
const T0 = Date.UTC(2026, 10, 8, 8, 0, 0);

type Mode = 'ok' | 'fail5xx' | 'invalidKey' | 'leakyThrow';

function upstream(initial: Partial<Record<'currencies' | 'changers' | 'rates', unknown>> = {}) {
  const bodies: Record<'currencies' | 'changers' | 'rates', unknown> = {
    currencies: fixture.currencies,
    changers: fixture.changers,
    rates: fixture.rates,
    ...initial,
  };
  const mode: Record<'currencies' | 'changers' | 'rates', Mode> = { currencies: 'ok', changers: 'ok', rates: 'ok' };
  const calls: Array<{ kind: string; url: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = new URL(url).pathname.split('/').slice(3).join('/');
    const kind = path.split('/')[0] as 'currencies' | 'changers' | 'rates';
    calls.push({ kind, url });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      switch (mode[kind]) {
        case 'fail5xx':
          return new Response('err', { status: 502, headers: { 'content-type': 'text/plain' } });
        case 'invalidKey':
          return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 200, headers: { 'content-type': 'application/json' } });
        case 'leakyThrow':
          throw new TypeError(`fetch failed for ${url}`);
        default:
          return new Response(JSON.stringify(bodies[kind]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return {
    fetchFn,
    calls,
    mode,
    bodies,
    count: (kind: string) => calls.filter((c) => c.kind === kind).length,
    maxInFlight: () => maxInFlight,
  };
}

let clock = T0;
let consoleOutput: string[];
beforeEach(() => {
  clock = T0;
  consoleOutput = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => jest.restoreAllMocks());

function service(up: ReturnType<typeof upstream>, extra: { partnerId?: string; ttl?: string } = {}) {
  return new BestChangeService({ apiKey: KEY, fetchFn: up.fetchFn, now: () => clock, partnerId: extra.partnerId, cacheTtlSeconds: extra.ttl });
}

const SBP_USDT: OffersQuery = { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000 };

function expectNoLeak(...bodies: unknown[]) {
  const responses = bodies.map((b) => JSON.stringify(b)).join('\n');
  const logs = consoleOutput.join('\n');
  expect(responses).not.toContain(KEY);
  expect(responses).not.toContain('bestchange.app');
  expect(logs).not.toContain(KEY);
  // Logs may name the host and status, never a URL or path.
  expect(logs).not.toMatch(/https?:|\/v2\//);
}

describe('not configured', () => {
  it.each([[undefined], [''], ['   '], ['short'], ['has spaces in the key 1234']])('key %p ⇒ not_configured, no upstream call', async (apiKey) => {
    const up = upstream();
    const svc = new BestChangeService({ apiKey, fetchFn: up.fetchFn });
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.directory()).resolves.toEqual({ status: 'not_configured' });
    await expect(svc.offers(SBP_USDT)).resolves.toEqual({ status: 'not_configured' });
    expect(up.calls).toHaveLength(0);
    expectNoLeak();
  });

  it('bestChangeServiceFromEnv trims the key and reads partner/TTL', async () => {
    const up = upstream();
    const svc = bestChangeServiceFromEnv({ BESTCHANGE_API_KEY: `  ${KEY}\n`, BESTCHANGE_PARTNER_ID: '123', BESTCHANGE_CACHE_TTL_SECONDS: '120' }, { fetchFn: up.fetchFn });
    expect(svc.isConfigured()).toBe(true);
    expect(svc.cacheTtlSeconds).toBe(120);
    const offers = (await svc.offers(SBP_USDT)) as OffersOkResponse;
    expect(offers.directionLink).toEqual({ url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html?p=123' });
    expect(bestChangeServiceFromEnv({}).isConfigured()).toBe(false);
  });
});

describe('cache TTL setting', () => {
  it('defaults to 45 and clamps to 30..300', () => {
    expect(resolveCacheTtlSeconds(undefined)).toBe(45);
    expect(resolveCacheTtlSeconds('')).toBe(45);
    expect(resolveCacheTtlSeconds('abc')).toBe(45);
    expect(resolveCacheTtlSeconds('-5')).toBe(45);
    expect(resolveCacheTtlSeconds('5')).toBe(30);
    expect(resolveCacheTtlSeconds('60')).toBe(60);
    expect(resolveCacheTtlSeconds(' 90 ')).toBe(90);
    expect(resolveCacheTtlSeconds('9999')).toBe(300);
    expect(resolveCacheTtlSeconds(Number.POSITIVE_INFINITY)).toBe(45);
  });
});

describe('directory from the live currencies', () => {
  it('lists fixed RUB methods present as non-crypto non-cash, plus dynamic *RUB extras, and resolved receive pairs only', async () => {
    const up = upstream();
    const dir = (await service(up).directory()) as DirectoryOkResponse;
    expect(dir.status).toBe('ok');
    expect(dir.asOf).toBe(new Date(T0).toISOString());
    expect(dir.methods).toEqual([
      { id: 'sbp', label: 'Карта и СБП без P2P', kind: 'payment_system', available: true },
      { id: 'sberbank', label: 'Сбербанк', kind: 'bank', available: false },
      { id: 'tbank', label: 'Т-Банк', kind: 'bank', available: false },
      { id: 'bc-test-bank-rub', label: 'Тестовый банк RUB', kind: 'bank', available: true },
    ]);
    // Cash RUB and the USD card are never offered.
    expect(JSON.stringify(dir.methods)).not.toMatch(/cash|usd/i);
    expect(dir.assets).toEqual([
      { assetId: 'USDT', networkId: 'tron', available: true },
      { assetId: 'BTC', networkId: 'bitcoin', available: false },
      { assetId: 'TRX', networkId: 'tron', available: true },
    ]);
  });
});

describe('one batched rates request per snapshot, coalesced', () => {
  it('fetches currencies, changers and ONE rates call covering every method × receive pair', async () => {
    const up = upstream();
    await service(up).directory();
    expect(up.count('currencies')).toBe(1);
    expect(up.count('changers')).toBe(1);
    expect(up.count('rates')).toBe(1);
    const ratesPath = new URL(up.calls.find((c) => c.kind === 'rates')!.url).pathname.split('/rates/')[1];
    const pairs = ratesPath.split('+');
    expect(pairs).toHaveLength(4 * 3);
    expect(pairs).toEqual(expect.arrayContaining(['9001-9101', '9001-9102', '9001-9103', '9005-9101', '9003-9102']));
  });

  it('50 concurrent clients cost one refresh, never more than one upstream request in flight', async () => {
    const up = upstream();
    const svc = service(up);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? svc.directory() : svc.offers(SBP_USDT))));
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(up.calls).toHaveLength(3);
    expect(up.maxInFlight()).toBe(1);
  });

  it('serves from cache inside the TTL; after it, only rates is refreshed (currencies 1 h, changers 10 min)', async () => {
    const up = upstream();
    const svc = service(up);
    await svc.offers(SBP_USDT);
    clock += 44_000;
    await svc.offers(SBP_USDT);
    await svc.directory();
    expect(up.count('rates')).toBe(1);
    clock += 2_000; // 46 s > 45 s default TTL
    await svc.offers(SBP_USDT);
    expect(up.count('rates')).toBe(2);
    expect(up.count('currencies')).toBe(1);
    expect(up.count('changers')).toBe(1);
    clock += 10 * 60_000;
    await svc.offers(SBP_USDT);
    expect(up.count('changers')).toBe(2);
    expect(up.count('currencies')).toBe(1);
  });

  it('never asks for more than 500 pairs: dynamic extras beyond the limit are left out', async () => {
    const extras = Array.from({ length: 600 }, (_, i) => ({
      id: 20000 + i, name: `Тестовый банк ${i} RUB`, urlname: `test-bank-${i}`, code: `TB${i}RUB`, crypto: false, cash: false,
    }));
    const currencies = { currencies: [...fixture.currencies.currencies.filter((c) => c.id !== 9102 && c.id !== 9103), ...extras] };
    const up = upstream({ currencies });
    const dir = (await service(up).directory()) as DirectoryOkResponse;
    const pairs = new URL(up.calls.find((c) => c.kind === 'rates')!.url).pathname.split('/rates/')[1].split('+');
    expect(pairs.length).toBe(500);
    expect(dir.methods).toHaveLength(500);
    expect(dir.methods.slice(0, 3).map((m) => m.id)).toEqual(['sbp', 'sberbank', 'tbank']);
  });
});

describe('offers computation (docs/EXCHANGERS_694.md)', () => {
  it('active changers only, one row per changer, both rate orientations, rank order, floors, limits, marks and links', async () => {
    const up = upstream();
    const res = (await service(up).offers(SBP_USDT)) as OffersOkResponse;
    expect(res.status).toBe('ok');
    expect(res.stale).toBe(false);
    expect(res.query).toEqual(SBP_USDT);
    expect(res.directionLink).toEqual({ url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' });
    // 9203 inactive, 9999 unknown, 9205 rate 0 ⇒ gone. 9204 collapsed to its best row.
    expect(res.offers.map((o) => o.id)).toEqual(['9202', '9201', '9204']);

    const [o9202, o9201, o9204] = res.offers;
    // Direct orientation (RUB per unit).
    expect(o9202.rubPerUnit).toBe(95.5);
    expect(o9202.rankRubPerUnit).toBe(96);
    expect(o9202.receiveAmount).toBe(104.71);
    expect(o9202.minRub).toBe(100);
    expect(o9202.maxRub).toBeNull(); // inmax 0 ⇒ no stated maximum
    expect(o9202.fitsAmount).toBe(true);
    expect(o9202.link).toBeNull(); // evil.example + javascript: ⇒ dropped
    expect(o9202.marks).toEqual([]);

    // Inverted orientation (USDT per RUB) normalised to RUB per unit.
    expect(o9201.rubPerUnit).toBeCloseTo(95.238095238, 6);
    expect(o9201.rankRubPerUnit).toBeCloseTo(96.153846154, 6);
    expect(o9201.receiveAmount).toBe(105); // 10000 × 0.0105, no 104.99 artefact
    expect(o9201).toMatchObject({
      exchanger: { id: 9201, name: 'Тестовый обменник 1', rating: 5, reviews: { positive: 390, neutral: 3, claim: 0, closed: 2 } },
      minRub: 1000,
      maxRub: 500000,
      reserve: 12345.6,
      marks: ['manual', 'verifying'],
      fitsAmount: true,
      link: { kind: 'exchanger', url: 'https://www.bestchange.ru/click.php?id=9201' },
    });

    // Best row of 9204 (94.1, rankrate unparsable ⇒ null ⇒ sorted last).
    expect(o9204.rubPerUnit).toBe(94.1);
    expect(o9204.rankRubPerUnit).toBeNull();
    expect(o9204.receiveAmount).toBe(106.26);
    expect(o9204.marks).toEqual(['floating']);
    expect(o9204.fitsAmount).toBe(false); // inmin 50 000 > 10 000
    expect(o9204.exchanger.reviews).toBeNull();
    // ru link has the wrong id ⇒ falls back to the valid en link.
    expect(o9204.link).toEqual({ kind: 'exchanger', url: 'https://www.bestchange.com/click.php?id=9204' });
  });

  it('keeps TRX (native) and USDT TRC-20 apart', async () => {
    const up = upstream();
    const trx = (await service(up).offers({ method: 'sbp', asset: 'TRX', network: 'tron', amount: 10000 })) as OffersOkResponse;
    expect(trx.offers.map((o) => o.id)).toEqual(['9201']);
    expect(trx.offers[0].rubPerUnit).toBe(8.5);
    expect(trx.offers[0].receiveAmount).toBe(1176.47);
    expect(trx.directionLink).toEqual({ url: 'https://www.bestchange.ru/sbp-to-tron.html' });
  });

  it('dynamic extra method works end to end and its extra-parameter link is refused', async () => {
    const up = upstream();
    const res = (await service(up).offers({ method: 'bc-test-bank-rub', asset: 'USDT', network: 'tron', amount: 15000.5 })) as OffersOkResponse;
    expect(res.offers).toHaveLength(1);
    expect(res.offers[0]).toMatchObject({ id: '9205', rubPerUnit: 96, rankRubPerUnit: 96.2, minRub: 10, maxRub: 20000, fitsAmount: true, link: null, marks: ['card2card'] });
    expect(res.directionLink).toEqual({ url: 'https://www.bestchange.ru/test-bank-rub-to-tether-trc20.html' });
  });

  it('an available-but-empty combination answers ok with no offers', async () => {
    const res = (await service(upstream()).offers({ method: 'sberbank', asset: 'USDT', network: 'tron', amount: 5000 })) as OffersOkResponse;
    expect(res.status).toBe('ok');
    expect(res.offers).toEqual([]);
  });

  it('method or pair not in the live directory ⇒ invalid', async () => {
    const svc = service(upstream());
    await expect(svc.offers({ ...SBP_USDT, method: 'mir' })).resolves.toEqual({ status: 'invalid' });
    await expect(svc.offers({ ...SBP_USDT, method: 'bc-nope' })).resolves.toEqual({ status: 'invalid' });
    await expect(svc.offers({ ...SBP_USDT, asset: 'ETH', network: 'ethereum' })).resolves.toEqual({ status: 'invalid' });
    await expect(svc.offers({ ...SBP_USDT, asset: 'USDT', network: 'bsc' })).resolves.toEqual({ status: 'invalid' });
  });

  it('partner id goes only onto direction links, and an invalid one is ignored', async () => {
    const withPartner = (await service(upstream(), { partnerId: '4242' }).offers(SBP_USDT)) as OffersOkResponse;
    expect(withPartner.directionLink).toEqual({ url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html?p=4242' });
    expect(withPartner.offers.every((o) => !o.link || !o.link.url.includes('p='))).toBe(true);
    const bad = (await service(upstream(), { partnerId: '42&x=1' }).offers(SBP_USDT)) as OffersOkResponse;
    expect(bad.directionLink).toEqual({ url: 'https://www.bestchange.ru/sbp-to-tether-trc20.html' });
  });
});

describe('failures: stale serving, cooldown, fixed statuses, no leaks', () => {
  it('serves the last snapshot flagged stale for up to 5 minutes, then unavailable', async () => {
    const up = upstream();
    const svc = service(up);
    await svc.offers(SBP_USDT);
    up.mode.rates = 'fail5xx';
    clock += 46_000;
    const stale = (await svc.offers(SBP_USDT)) as OffersOkResponse;
    expect(stale.status).toBe('ok');
    expect(stale.stale).toBe(true);
    expect(stale.asOf).toBe(new Date(T0).toISOString());
    expect(stale.offers.length).toBe(3);

    clock = T0 + 45_000 + SNAPSHOT_MAX_STALE_MS + 1_000;
    const gone = await svc.offers(SBP_USDT);
    expect(gone).toEqual({ status: 'unavailable', retryAfter: expect.any(Number) });
    expect((gone as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(5);
    expectNoLeak(stale, gone);
  });

  it('after a failure no new upstream attempt starts during the cooldown', async () => {
    const up = upstream();
    up.mode.currencies = 'fail5xx';
    const svc = service(up);
    await expect(svc.directory()).resolves.toMatchObject({ status: 'unavailable' });
    const afterFirst = up.calls.length;
    expect(afterFirst).toBe(5); // main host + 4 mirrors
    await Promise.all(Array.from({ length: 20 }, () => svc.offers(SBP_USDT)));
    expect(up.calls.length).toBe(afterFirst);
    clock += FAILURE_COOLDOWN_MS + 1;
    up.mode.currencies = 'ok';
    await expect(svc.directory()).resolves.toMatchObject({ status: 'ok' });
  });

  it('a rejected key (HTTP 200 {"error":"Invalid API key"}) reads as not_configured, never leaking the key', async () => {
    const up = upstream();
    up.mode.currencies = 'invalidKey';
    const svc = service(up);
    const dir = await svc.directory();
    const offers = await svc.offers(SBP_USDT);
    expect(dir).toEqual({ status: 'not_configured' });
    expect(offers).toEqual({ status: 'not_configured' });
    expect(up.count('currencies')).toBe(1);
    expectNoLeak(dir, offers);
  });

  it('a transport error whose text contains the URL and key never reaches a response or a log', async () => {
    const up = upstream();
    up.mode.rates = 'leakyThrow';
    const svc = service(up);
    const dir = await svc.directory();
    expect(dir).toMatchObject({ status: 'unavailable' });
    expect(up.count('rates')).toBe(5);
    expectNoLeak(dir);
  });

  it('a malformed upstream payload ⇒ unavailable, nothing echoed', async () => {
    const up = upstream({ changers: { changers: `secret ${KEY}` } });
    const dir = await service(up).directory();
    expect(dir).toMatchObject({ status: 'unavailable' });
    expectNoLeak(dir);
  });

  it('an unexpected client bug is logged by error name only', async () => {
    const client = {
      getCurrencies: async () => { throw new RangeError(`boom https://bestchange.app/v2/${KEY}/currencies/ru`); },
      getChangers: async () => ({ changers: [] }),
      getRates: async () => ({ rates: {} }),
    };
    const svc = new BestChangeService({ apiKey: KEY, client, now: () => clock });
    const dir = await svc.directory();
    expect(dir).toMatchObject({ status: 'unavailable' });
    expect(consoleOutput.join('\n')).toContain('RangeError');
    expectNoLeak(dir);
  });
});
