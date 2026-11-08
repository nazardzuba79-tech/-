import {
  BESTCHANGE_API_HOSTS,
  createBestChangeClient,
  isPlausibleBestChangeKey,
  MAX_RATE_PAIRS,
} from '../BestChangeClient';
import { BestChangeError } from '../errors';

// Obviously fake: never a real key.
const KEY = 'TESTONLYfakeKey000000000000000001';

type Reply = Response | Error | DOMException | ((url: string, init: RequestInit) => Promise<Response>);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function scripted(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const next = replies.shift();
    if (next === undefined) throw new Error('unexpected extra request');
    if (typeof next === 'function') return next(url, init ?? {});
    // DOMException is not `instanceof Error` inside the Jest sandbox, so test for Response instead.
    if (next instanceof Response) return next;
    throw next;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, mock: fetchFn };
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
  jest.restoreAllMocks();
});

function expectNoKeyLeak(error?: unknown) {
  const all = consoleOutput.join('\n');
  expect(all).not.toContain(KEY);
  expect(all).not.toContain('/v2/');
  if (error !== undefined) {
    expect(error).toBeInstanceOf(BestChangeError);
    const e = error as BestChangeError;
    expect(`${e.message} ${e.stack} ${JSON.stringify(e)}`).not.toContain(KEY);
    expect(e.message).not.toMatch(/https?:|\/v2\//);
    expect((e as { cause?: unknown }).cause).toBeUndefined();
  }
}

async function caught(promise: Promise<unknown>): Promise<BestChangeError> {
  try {
    await promise;
  } catch (error) {
    return error as BestChangeError;
  }
  throw new Error('expected a rejection');
}

describe('key shape', () => {
  it('accepts 16-128 ASCII letters/digits only', () => {
    expect(isPlausibleBestChangeKey(KEY)).toBe(true);
    expect(isPlausibleBestChangeKey('a'.repeat(16))).toBe(true);
    expect(isPlausibleBestChangeKey('a'.repeat(15))).toBe(false);
    expect(isPlausibleBestChangeKey('a'.repeat(129))).toBe(false);
    for (const bad of ['', 'key with space 0000', 'abc/def0000000000000', 'abc%2F00000000000000', 'ключключключключключ', undefined, null, 42]) {
      expect(isPlausibleBestChangeKey(bad)).toBe(false);
    }
  });

  it('refuses to build a client for a malformed key without any request', () => {
    const { fetchFn, mock } = scripted([]);
    expect(() => createBestChangeClient({ apiKey: 'short', fetchFn })).toThrow(BestChangeError);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('request shape', () => {
  it('uses the first official host, the key as an encoded path segment, JSON accept, redirect:error and a timeout signal', async () => {
    const { fetchFn, calls } = scripted([json({ currencies: [] })]);
    const client = createBestChangeClient({ apiKey: KEY, fetchFn });
    await expect(client.getCurrencies('ru')).resolves.toEqual({ currencies: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://bestchange.app/v2/${KEY}/currencies/ru`);
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('changers path', async () => {
    const { fetchFn, calls } = scripted([json({ changers: [] })]);
    await createBestChangeClient({ apiKey: KEY, fetchFn }).getChangers('ru');
    expect(calls[0].url).toBe(`https://bestchange.app/v2/${KEY}/changers/ru`);
  });

  it('rejects an unsupported lang without a request', async () => {
    const { fetchFn, mock } = scripted([]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('de' as 'ru'));
    expect(error.code).toBe('invalid_request');
    expect(mock).not.toHaveBeenCalled();
  });

  it('batches every pair into ONE rates request joined with +', async () => {
    const { fetchFn, calls } = scripted([json({ rates: {} })]);
    await createBestChangeClient({ apiKey: KEY, fetchFn }).getRates([[9001, 9101], [9001, 9102], [9002, 9101]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://bestchange.app/v2/${KEY}/rates/9001-9101+9001-9102+9002-9101`);
  });

  it('allows exactly 500 pairs and refuses 501, empty or non-integer pairs without a request', async () => {
    const pairs = Array.from({ length: MAX_RATE_PAIRS }, (_, i) => [9000 + i, 1] as const);
    const ok = scripted([json({ rates: {} })]);
    await createBestChangeClient({ apiKey: KEY, fetchFn: ok.fetchFn }).getRates(pairs);
    expect(ok.calls).toHaveLength(1);

    const none = scripted([]);
    const client = createBestChangeClient({ apiKey: KEY, fetchFn: none.fetchFn });
    for (const bad of [[...pairs, [1, 2] as const], [], [[1.5, 2] as const], [[0, 2] as const], [[-1, 2] as const], [[Number.NaN, 2] as const]]) {
      expect((await caught(client.getRates(bad))).code).toBe('invalid_request');
    }
    expect(none.mock).not.toHaveBeenCalled();
  });
});

describe('error mapping (no mirror retry: same key, same answer)', () => {
  it('HTTP 200 {"error":"Invalid API key"} ⇒ key_rejected after one request', async () => {
    const { fetchFn, calls } = scripted([json({ error: 'Invalid API key' })]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru'));
    expect(error.code).toBe('key_rejected');
    expect(calls).toHaveLength(1);
    expectNoKeyLeak(error);
  });

  it('any other JSON error body ⇒ upstream, body text never surfaces', async () => {
    const { fetchFn, calls } = scripted([json({ error: `Service down for ${KEY}` })]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru'));
    expect(error.code).toBe('upstream');
    expect(error.message).toBe('BestChange API is unavailable');
    expect(calls).toHaveLength(1);
    expectNoKeyLeak(error);
  });

  it('HTTP 404 (malformed key, nginx HTML) ⇒ upstream after one request', async () => {
    const { fetchFn, calls } = scripted([new Response(`<html>404 /v2/${KEY}/currencies/ru</html>`, { status: 404, headers: { 'content-type': 'text/html' } })]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru'));
    expect(error.code).toBe('upstream');
    expect(calls).toHaveLength(1);
    expectNoKeyLeak(error);
  });

  it('HTTP 429 ⇒ rate_limited after one request', async () => {
    const { fetchFn, calls } = scripted([json({}, 429)]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getChangers('ru'));
    expect(error.code).toBe('rate_limited');
    expect(calls).toHaveLength(1);
    expectNoKeyLeak(error);
  });

  it('body over the size cap ⇒ upstream, no mirror', async () => {
    const { fetchFn, calls } = scripted([json({ currencies: 'x'.repeat(5000) })]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn, maxBytes: 1024 }).getCurrencies('ru'));
    expect(error.code).toBe('upstream');
    expect(calls).toHaveLength(1);
  });

  it('declared content-length over the cap ⇒ upstream without reading', async () => {
    const { fetchFn } = scripted([json({ a: 1 }, 200, { 'content-length': '999999999' })]);
    expect((await caught(createBestChangeClient({ apiKey: KEY, fetchFn, maxBytes: 1024 }).getCurrencies('ru'))).code).toBe('upstream');
  });
});

describe('mirror fallback (network faults, timeouts, 5xx, non-JSON only)', () => {
  it('5xx on the main host ⇒ mirror1 answers', async () => {
    const { fetchFn, calls } = scripted([json({}, 502), json({ currencies: [] })]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru')).resolves.toEqual({ currencies: [] });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['bestchange.app', 'mirror1.bestchange.app']);
    expectNoKeyLeak();
  });

  it('network error whose text contains the URL ⇒ next mirror, and the text is never logged', async () => {
    const leaky = new TypeError(`fetch failed https://bestchange.app/v2/${KEY}/currencies/ru`);
    const { fetchFn, calls } = scripted([leaky, json({ ok: 1 })]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru')).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expectNoKeyLeak();
  });

  it('a timeout (TimeoutError) ⇒ next mirror', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { fetchFn, calls } = scripted([timeout, json({ ok: 2 })]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn }).getChangers('ru')).resolves.toEqual({ ok: 2 });
    expect(calls).toHaveLength(2);
  });

  it('the per-attempt AbortSignal really fires and the next mirror is tried', async () => {
    const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
    const { fetchFn, calls } = scripted([hang, json({ ok: 3 })]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn, timeoutMs: 20 }).getCurrencies('ru')).resolves.toEqual({ ok: 3 });
    expect(calls).toHaveLength(2);
  });

  it('non-JSON content type or unparsable JSON ⇒ next mirror', async () => {
    const { fetchFn, calls } = scripted([
      new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
      json({ ok: 4 }),
    ]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru')).resolves.toEqual({ ok: 4 });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['bestchange.app', 'mirror1.bestchange.app', 'mirror2.bestchange.app']);
  });

  it('a redirect (fetch rejects under redirect:error) ⇒ next mirror', async () => {
    const { fetchFn, calls } = scripted([new TypeError('fetch failed: unexpected redirect'), json({ ok: 5 })]);
    await expect(createBestChangeClient({ apiKey: KEY, fetchFn }).getCurrencies('ru')).resolves.toEqual({ ok: 5 });
    expect(calls).toHaveLength(2);
  });

  it('every host failing ⇒ one fixed upstream error after exactly the 5 official hosts', async () => {
    const { fetchFn, calls } = scripted([
      new TypeError(`connect ECONNREFUSED ${KEY}`),
      json({}, 500),
      json({}, 503),
      new DOMException('aborted', 'TimeoutError'),
      new Response('nope', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn }).getRates([[9001, 9101]]));
    expect(error.code).toBe('upstream');
    expect(calls.map((c) => new URL(c.url).host)).toEqual([...BESTCHANGE_API_HOSTS]);
    for (const c of calls) expect(new URL(c.url).protocol).toBe('https:');
    expectNoKeyLeak(error);
    // Logs carry only fixed reasons + host/status.
    for (const line of consoleOutput) expect(line).toMatch(/^\[bestchange\] [a-zA-Z ]+ \{"host":"[a-z0-9.]+"(,"status":\d+)?\}$/);
  });

  it('stops trying mirrors once the total time budget is spent', async () => {
    let t = 0;
    const slowFail = async () => {
      t += 600;
      throw new TypeError('fetch failed');
    };
    const { fetchFn, calls } = scripted([slowFail, slowFail, slowFail, slowFail, slowFail]);
    const error = await caught(createBestChangeClient({ apiKey: KEY, fetchFn, totalBudgetMs: 1000, now: () => t }).getCurrencies('ru'));
    expect(error.code).toBe('upstream');
    expect(calls).toHaveLength(2);
  });
});
