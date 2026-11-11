jest.mock('../api', () => ({ API_BASE: 'https://api.example.test/api/v1' }));

import { fetchExchangerOffers, fetchExchangersDirectory, offersPath } from '../exchangersApi';
import type { OffersQuery } from '../../../../src/shared/exchangers/types';

/**
 * «Обменники» (Issue #694) client: public reads with no session attached.
 * A stale stored token must never reach these endpoints (a 401 there would
 * sign the visitor out through api.ts), and nothing the page cannot validate
 * may reach the screen. Fixture values only; no real offers.
 */

const QUERY: OffersQuery = { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000.5 };
type Call = { url: string; init: RequestInit };

function mockFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body } as unknown as Response;
  });
  return calls;
}

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

test('builds the documented offers address with encoded parameters', () => {
  expect(offersPath(QUERY)).toBe('/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=10000.5');
  expect(offersPath({ ...QUERY, method: 'bc-a&b=c' })).toBe('/exchangers/offers?method=bc-a%26b%3Dc&asset=USDT&network=tron&amount=10000.5');
});

test('sends no credentials, no Authorization header and carries the abort signal', async () => {
  const calls = mockFetch({ status: 'not_configured' });
  const ctl = new AbortController();
  await expect(fetchExchangersDirectory(ctl.signal)).resolves.toEqual({ kind: 'not_configured' });
  await fetchExchangerOffers(QUERY, ctl.signal);
  expect(calls.map((c) => c.url)).toEqual([
    'https://api.example.test/api/v1/exchangers/directory',
    'https://api.example.test/api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=10000.5',
  ]);
  for (const { init } of calls) {
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBe(ctl.signal);
    // Exactly one header, Accept: no Authorization, no Cookie, nothing else.
    expect(init.headers).toEqual({ Accept: 'application/json' });
  }
});

test('error statuses with a contract body are reported by kind', async () => {
  mockFetch({ status: 'unavailable', retryAfter: 60 }, 503);
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'unavailable', retryAfter: 60 });
  mockFetch({ status: 'rate_limited', retryAfter: 5 }, 429);
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'rate_limited', retryAfter: 5 });
  mockFetch({ status: 'invalid' }, 400);
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'invalid' });
});

test('a network failure or a non-JSON body becomes error, never an empty list', async () => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  await expect(fetchExchangersDirectory(new AbortController().signal)).resolves.toEqual({ kind: 'error' });
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } }));
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'error' });
});

test('an answer for another query is refused', async () => {
  mockFetch({ status: 'ok', asOf: null, stale: false, query: { ...QUERY, asset: 'TRX' }, directionLink: null, offers: [] });
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'error' });
});

test('an aborted request is re-thrown so the page can ignore it', async () => {
  const ctl = new AbortController();
  (globalThis as { fetch: unknown }).fetch = jest.fn(async () => {
    ctl.abort();
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  await expect(fetchExchangerOffers(QUERY, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

// Issue #694: the production API release may not carry this feature yet. A missing
// route is the honest "no rate source" state (links to BestChange only), not an error.
test('a 404 from the API means "not configured": no retry prompt, no numbers', async () => {
  mockFetch({ error: 'Not found' }, 404);
  await expect(fetchExchangersDirectory(new AbortController().signal)).resolves.toEqual({ kind: 'not_configured' });
  mockFetch({ error: 'Not found' }, 404);
  await expect(fetchExchangerOffers(QUERY, new AbortController().signal)).resolves.toEqual({ kind: 'not_configured' });
});
test('any other unreadable answer stays an error', async () => {
  mockFetch('<html>bad gateway</html>', 502);
  await expect(fetchExchangersDirectory(new AbortController().signal)).resolves.toEqual({ kind: 'error' });
});
