import { CloudflareListingStore, ListingStoreError, UnconfiguredListingStore, listingStoreFromEnvironment } from '../store';

const token = 'synthetic-local-only-listings-secret-0001';

describe('Render listing store configuration never stops the server', () => {
  test.each([
    [{}, 'not_set', false],
    [{ LISTINGS_STORE_URL: 'https://market.voltextech.net' }, 'missing_token', true],
    [{ LISTINGS_STORE_TOKEN: token }, 'missing_url', true],
    [{ LISTINGS_STORE_URL: 'https://market.voltextech.net', LISTINGS_STORE_TOKEN: 'short' }, 'invalid_token', true],
    [{ LISTINGS_STORE_URL: 'http://market.voltextech.net', LISTINGS_STORE_TOKEN: token, NODE_ENV: 'production' }, 'invalid_url', true],
    [{ LISTINGS_STORE_URL: 'not a url', LISTINGS_STORE_TOKEN: token }, 'invalid_url', true],
  ])('%o → not configured (%s), logged by name only', async (env, problem, logged) => {
    const lines: string[] = [];
    const store = listingStoreFromEnvironment(env as NodeJS.ProcessEnv, (line) => lines.push(line));
    expect(store).toBeInstanceOf(UnconfiguredListingStore);
    expect((store as UnconfiguredListingStore).problem).toBe(problem);
    expect(lines).toHaveLength(logged ? 1 : 0);
    expect(lines.join()).not.toContain(token);
    await expect(store.list()).rejects.toMatchObject({ status: 503, code: 'STORE_NOT_CONFIGURED' });
  });

  test('both set and valid → the Cloudflare store', () => {
    const store = listingStoreFromEnvironment({ LISTINGS_STORE_URL: ' https://market.voltextech.net ', LISTINGS_STORE_TOKEN: token } as NodeJS.ProcessEnv, () => {});
    expect(store).toBeInstanceOf(CloudflareListingStore);
  });
});

describe('Worker answers are reported as configuration faults, never as success', () => {
  const store = (status: number, body: unknown) => new CloudflareListingStore('https://edge.example', token,
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
  test('Worker without its secret → STORE_NOT_CONFIGURED', async () => {
    await expect(store(503, { error: 'store_not_configured' }).list()).rejects.toMatchObject({ status: 503, code: 'STORE_NOT_CONFIGURED' });
  });
  test.each([401, 403])('Worker refuses the token (%i) → STORE_AUTH_FAILED', async (status) => {
    await expect(store(status, { error: 'unauthorized' }).list()).rejects.toMatchObject({ status: 503, code: 'STORE_AUTH_FAILED' });
  });
  test('any other failure stays STORE_UNAVAILABLE', async () => {
    const error = await store(500, {}).list().catch((e) => e);
    expect(error).toBeInstanceOf(ListingStoreError);
    expect(error.code).toBe('STORE_UNAVAILABLE');
  });
});
