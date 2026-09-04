import {
  CountryDetectionService,
  countryFromHeaders,
  httpCountryLookup,
  normalizeCountry,
} from '../CountryDetectionService';

/** The two things the service reads off a request. */
function req(headers: Record<string, string> = {}, ip = '203.0.113.10') {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()], ip };
}

describe('normalizeCountry', () => {
  it('accepts an ISO 3166-1 alpha-2 code and upper-cases it', () => {
    expect(normalizeCountry('ua')).toBe('UA');
    expect(normalizeCountry(' de ')).toBe('DE');
  });

  it('rejects anything that is not two letters', () => {
    for (const bad of ['USA', 'U', '', '12', 'U1', null, undefined, 42, {}]) {
      expect(normalizeCountry(bad)).toBeNull();
    }
  });

  it('treats an edge’s "unknown" placeholders as no answer', () => {
    // Cloudflare sends XX/T1 when it cannot place the address; storing those
    // would show the user a country that does not exist.
    expect(normalizeCountry('XX')).toBeNull();
    expect(normalizeCountry('T1')).toBeNull();
    expect(normalizeCountry('ZZ')).toBeNull();
  });
});

describe('countryFromHeaders', () => {
  it('reads the Cloudflare header', () => {
    expect(countryFromHeaders(req({ 'cf-ipcountry': 'PL' }))).toBe('PL');
  });

  it('supports other common edge headers', () => {
    expect(countryFromHeaders(req({ 'x-vercel-ip-country': 'fr' }))).toBe('FR');
    expect(countryFromHeaders(req({ 'fastly-client-country': 'JP' }))).toBe('JP');
  });

  it('returns null when no edge header is present', () => {
    expect(countryFromHeaders(req())).toBeNull();
  });

  it('ignores a malformed header rather than storing it', () => {
    expect(countryFromHeaders(req({ 'cf-ipcountry': 'NOT-A-CODE' }))).toBeNull();
  });
});

describe('CountryDetectionService', () => {
  it('prefers the edge header and never calls the lookup', async () => {
    const lookup = jest.fn();
    const svc = new CountryDetectionService(lookup);
    expect(await svc.detect(req({ 'cf-ipcountry': 'ES' }))).toBe('ES');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls back to the IP lookup when there is no header', async () => {
    const svc = new CountryDetectionService(async () => 'BR');
    expect(await svc.detect(req())).toBe('BR');
  });

  it('is disabled, not broken, when no lookup is configured', async () => {
    const svc = new CountryDetectionService(null);
    expect(await svc.detect(req())).toBeNull();
  });

  it('never asks a public service about a private or loopback address', async () => {
    const lookup = jest.fn();
    const svc = new CountryDetectionService(lookup);
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.4', '172.16.9.9', '169.254.1.1', 'fd00::1']) {
      expect(await svc.detect(req({}, ip))).toBeNull();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers null instead of throwing when the lookup fails', async () => {
    const svc = new CountryDetectionService(async () => {
      throw new Error('provider down');
    });
    await expect(svc.detect(req())).resolves.toBeNull();
  });

  it('answers null when the lookup returns something unusable', async () => {
    const svc = new CountryDetectionService(async () => 'nonsense' as never);
    expect(await svc.detect(req())).toBeNull();
  });

  it('caches by IP so a burst of sign-ins is one lookup', async () => {
    const lookup = jest.fn(async () => 'IT');
    const svc = new CountryDetectionService(lookup);
    expect(await svc.detect(req({}, '198.51.100.7'))).toBe('IT');
    expect(await svc.detect(req({}, '198.51.100.7'))).toBe('IT');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('caches a negative answer too, so a dead provider is not hammered', async () => {
    const lookup = jest.fn(async () => null);
    const svc = new CountryDetectionService(lookup);
    await svc.detect(req({}, '198.51.100.8'));
    await svc.detect(req({}, '198.51.100.8'));
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps separate answers per address', async () => {
    const svc = new CountryDetectionService(async (ip) => (ip === '203.0.113.1' ? 'NL' : 'SE'));
    expect(await svc.detect(req({}, '203.0.113.1'))).toBe('NL');
    expect(await svc.detect(req({}, '203.0.113.2'))).toBe('SE');
  });
});

describe('httpCountryLookup', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is not built at all when no URL is configured', () => {
    expect(httpCountryLookup(undefined)).toBeNull();
    expect(httpCountryLookup('')).toBeNull();
  });

  it('substitutes the address into the configured URL', async () => {
    const seen: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ country_code: 'CA' }) } as any;
    }) as any;
    const lookup = httpCountryLookup('https://example.test/{ip}')!;
    expect(await lookup('203.0.113.5')).toBe('CA');
    expect(seen[0]).toBe('https://example.test/203.0.113.5');
  });

  it('accepts the common response shapes', async () => {
    for (const [body, expected] of [
      [{ country_code: 'gb' }, 'GB'],
      [{ countryCode: 'AT' }, 'AT'],
      [{ country: 'CH' }, 'CH'],
    ] as const) {
      global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })) as any;
      expect(await httpCountryLookup('https://example.test/{ip}')!('203.0.113.5')).toBe(expected);
    }
  });

  it('returns null on a non-OK response, a bad body or a thrown request', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as any;
    expect(await httpCountryLookup('https://x.test/{ip}')!('203.0.113.5')).toBeNull();

    global.fetch = jest.fn(async () => ({ ok: true, json: async () => 'not an object' })) as any;
    expect(await httpCountryLookup('https://x.test/{ip}')!('203.0.113.5')).toBeNull();

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    expect(await httpCountryLookup('https://x.test/{ip}')!('203.0.113.5')).toBeNull();
  });
});
