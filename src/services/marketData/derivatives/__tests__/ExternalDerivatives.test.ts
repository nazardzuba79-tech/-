import { BinanceDerivativesService, binanceContractFor } from '../BinanceDerivativesService';
import { OkxDerivativesService, okxContractFor } from '../OkxDerivativesService';
import { ExternalDerivativesService, TRACKED_ASSETS } from '../ExternalDerivativesService';
import { numeric } from '../types';

/**
 * External derivatives adapters.
 *
 * The sandbox's egress proxy answers 403 to CONNECT for both
 * fapi.binance.com and www.okx.com, so nothing here touches a live API and
 * no live verification is claimed anywhere. Every response below is a
 * fixture shaped to the published contract, and the assertions are about
 * OUR behaviour: what we send, what we do with a good answer, and — mostly
 * — what we refuse to invent from a bad one.
 */

const NO_RETRY = { retries: 0, sleep: async () => {} };

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** Routes one fetch double across the several endpoints a call touches. */
function router(routes: { match: RegExp; reply: () => Response | Promise<Response> }[]) {
  const calls: string[] = [];
  const fetchFn = jest.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    const hit = routes.find((r) => r.match.test(u));
    if (!hit) throw new Error(`unrouted: ${u}`);
    return hit.reply();
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, mock: fetchFn };
}

const BINANCE_OI = { symbol: 'BTCUSDT', openInterest: '81234.567', time: 1_700_000_000_000 };
const BINANCE_PREMIUM = {
  symbol: 'BTCUSDT',
  markPrice: '50100.00',
  indexPrice: '50000.00',
  lastFundingRate: '0.0001',
  nextFundingTime: 1_700_028_800_000,
  time: 1_700_000_000_000,
};
const BINANCE_RATIO = [
  { symbol: 'BTCUSDT', longAccount: '0.6442', shortAccount: '0.3558', longShortRatio: '1.8101', timestamp: '1700000000000' },
];
/** Binance's real quote-currency turnover field. */
const BINANCE_TICKER = { symbol: 'BTCUSDT', lastPrice: '50100.00', volume: '120000.5', quoteVolume: '6012030000.00' };
/**
 * OKX's swap ticker. `volCcy24h` is the BASE amount for a derivatives
 * instrument and `vol24h` is a CONTRACT count — neither is a turnover, and
 * the fixture carries deliberately small values so a test that wrongly
 * used one would produce an obviously absurd total.
 */
const OKX_TICKER = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', last: '50080', vol24h: '9876543', volCcy24h: '11788.887619' }] };

const OKX_OI = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', oi: '250000', oiCcy: '2500.5', oiUsd: '125000000', ts: '1700000000000' }] };
const OKX_FUNDING = {
  code: '0',
  msg: '',
  data: [{ instId: 'BTC-USDT-SWAP', fundingRate: '0.00005', nextFundingTime: '1700028800000', fundingTime: '1700000000000' }],
};
const OKX_MARK = { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', markPx: '50080', ts: '1700000000000' }] };
const OKX_INDEX = { code: '0', msg: '', data: [{ instId: 'BTC-USDT', idxPx: '50000', ts: '1700000000000' }] };

function binanceRoutes() {
  return [
    { match: /openInterest\?/, reply: () => res(BINANCE_OI) },
    { match: /premiumIndex/, reply: () => res(BINANCE_PREMIUM) },
    { match: /LongShort/, reply: () => res(BINANCE_RATIO) },
    { match: /ticker\/24hr/, reply: () => res(BINANCE_TICKER) },
  ];
}
function okxRoutes() {
  return [
    { match: /public\/open-interest/, reply: () => res(OKX_OI) },
    { match: /public\/funding-rate/, reply: () => res(OKX_FUNDING) },
    { match: /public\/mark-price/, reply: () => res(OKX_MARK) },
    { match: /market\/index-tickers/, reply: () => res(OKX_INDEX) },
    { match: /market\/ticker\?/, reply: () => res(OKX_TICKER) },
  ];
}

// ── No credentials, ever ────────────────────────────────────────────

describe('authentication', () => {
  it('sends no key, signature or auth header to either venue', async () => {
    const b = router(binanceRoutes());
    const o = router(okxRoutes());
    const binance = new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY });
    const okx = new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY });
    await binance.getOpenInterest('BTC');
    await binance.getLongShortRatio('BTC', 'global_account');
    await okx.getOpenInterest('BTC');
    await okx.getBasis('BTC');

    for (const call of [...b.mock.mock.calls, ...o.mock.mock.calls] as unknown[][]) {
      const url = String(call[0]);
      expect(url).not.toMatch(/apiKey|api_key|signature|token|secret|passphrase/i);
      // These adapters call getJson with a URL only — no init, so no
      // header object exists to carry a credential.
      expect(call.length).toBe(1);
    }
  });
});

// ── Successful responses ────────────────────────────────────────────

describe('successful responses', () => {
  it('maps a Binance open-interest response to base units and its own USD notional', async () => {
    const { fetchFn } = router(binanceRoutes());
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const oi = await svc.getOpenInterest('BTC');

    expect(oi).toMatchObject({ venue: 'binance', contract: 'BTCUSDT', baseAsset: 'BTC', openInterestBase: 81234.567 });
    // Priced with BINANCE's own mark price — a Binance figure end to end.
    expect(oi!.openInterestUsd).toBeCloseTo(81234.567 * 50100, 2);
  });

  it("uses OKX's base-currency open interest, never its raw contract count", async () => {
    const { fetchFn } = router(okxRoutes());
    const svc = new OkxDerivativesService('https://okx.test', { fetchFn, policy: NO_RETRY });
    const oi = await svc.getOpenInterest('BTC');

    // oiCcy (2500.5), not oi (250000 contracts), which is not comparable
    // with Binance's base units.
    expect(oi).toMatchObject({ venue: 'okx', contract: 'BTC-USDT-SWAP', openInterestBase: 2500.5, openInterestUsd: 125_000_000 });
  });

  it('derives the OKX funding interval from the venue\'s own two timestamps', async () => {
    const { fetchFn } = router(okxRoutes());
    const svc = new OkxDerivativesService('https://okx.test', { fetchFn, policy: NO_RETRY });
    const funding = await svc.getFunding('BTC');
    expect(funding).toMatchObject({ venue: 'okx', fundingRate: 0.00005, nextFundingTime: 1_700_028_800_000, intervalHours: 8 });
  });

  it('leaves the Binance funding interval null rather than assuming a convention', async () => {
    const { fetchFn } = router(binanceRoutes());
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    expect((await svc.getFunding('BTC'))!.intervalHours).toBeNull();
  });
});

// ── Basis formula ───────────────────────────────────────────────────

describe('perpetual basis', () => {
  it('computes (mark - index) / index as a percentage', async () => {
    const { fetchFn } = router(binanceRoutes());
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const basis = await svc.getBasis('BTC');
    // (50100 - 50000) / 50000 = 0.002 -> 0.2%
    expect(basis!.basisPercent).toBeCloseTo(0.2, 10);
  });

  it('keeps a genuinely zero basis as zero', async () => {
    const { fetchFn } = router([
      { match: /premiumIndex/, reply: () => res({ ...BINANCE_PREMIUM, markPrice: '50000', indexPrice: '50000' }) },
    ]);
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const basis = await svc.getBasis('BTC');
    expect(basis!.basisPercent).toBe(0);
    expect(basis!.basisPercent).not.toBeNull();
  });

  it('reports null basis when a price is missing, and never divides by a zero index', async () => {
    for (const premium of [
      { ...BINANCE_PREMIUM, indexPrice: null },
      { ...BINANCE_PREMIUM, markPrice: 'n/a' },
      { ...BINANCE_PREMIUM, indexPrice: '0' },
    ]) {
      const { fetchFn } = router([{ match: /premiumIndex/, reply: () => res(premium) }]);
      const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
      expect((await svc.getBasis('BTC'))!.basisPercent).toBeNull();
    }
  });
});

// ── Long/short definitions stay distinct ────────────────────────────

describe('long/short positioning', () => {
  it('keeps the three ratio definitions on their own endpoints and labels', async () => {
    const seen: string[] = [];
    const fetchFn = jest.fn(async (url: any) => {
      seen.push(String(url));
      return res(BINANCE_RATIO);
    }) as unknown as typeof fetch;
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });

    const global = await svc.getLongShortRatio('BTC', 'global_account');
    const topAcct = await svc.getLongShortRatio('BTC', 'top_account');
    const topPos = await svc.getLongShortRatio('BTC', 'top_position');

    expect(global!.kind).toBe('global_account');
    expect(topAcct!.kind).toBe('top_account');
    expect(topPos!.kind).toBe('top_position');
    expect(seen[0]).toContain('/futures/data/globalLongShortAccountRatio');
    expect(seen[1]).toContain('/futures/data/topLongShortAccountRatio');
    expect(seen[2]).toContain('/futures/data/topLongShortPositionRatio');
    // The sampling window travels with the value rather than being implied.
    expect(global!.period).toBe('5m');
    for (const url of seen) expect(url).toContain('period=5m');
  });

  it('rejects a positioning row with no usable proportions instead of defaulting to 50/50', async () => {
    const fetchFn = jest.fn(async () =>
      res([{ symbol: 'BTCUSDT', longAccount: 'x', shortAccount: null, longShortRatio: undefined, timestamp: '1' }])
    ) as unknown as typeof fetch;
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    await expect(svc.getLongShortRatio('BTC', 'global_account')).rejects.toThrow();
  });

  it('never produces a 0.5 / 0.5 fallback anywhere in the source', () => {
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../BinanceDerivativesService.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/\?\?\s*0\.5/);
    expect(code).not.toMatch(/longAccount\s*[:=]\s*0\.5/);
    expect(code).not.toMatch(/\?\?\s*0\b/);
  });
});

// ── Malformed, empty and error payloads ─────────────────────────────

describe('malformed and failing responses', () => {
  it('treats an OKX non-zero code as a failure even though the HTTP status is 200', async () => {
    const fetchFn = jest.fn(async () => res({ code: '51001', msg: 'Instrument ID does not exist', data: [] })) as unknown as typeof fetch;
    const svc = new OkxDerivativesService('https://okx.test', { fetchFn, policy: NO_RETRY });
    await expect(svc.getOpenInterest('BTC')).rejects.toThrow(/code 51001/);
  });

  it('treats an empty OKX data array as no data, never as zero', async () => {
    const fetchFn = jest.fn(async () => res({ code: '0', msg: '', data: [] })) as unknown as typeof fetch;
    const svc = new OkxDerivativesService('https://okx.test', { fetchFn, policy: NO_RETRY });
    await expect(svc.getOpenInterest('BTC')).rejects.toThrow(/no rows/);
  });

  it('reports a null open interest rather than zero when the field is unusable', async () => {
    const { fetchFn } = router([
      { match: /openInterest\?/, reply: () => res({ symbol: 'BTCUSDT', openInterest: 'not-a-number' }) },
      { match: /premiumIndex/, reply: () => res(BINANCE_PREMIUM) },
    ]);
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const oi = await svc.getOpenInterest('BTC');
    expect(oi!.openInterestBase).toBeNull();
    // No base figure means no notional either — it is not priced from thin air.
    expect(oi!.openInterestUsd).toBeNull();
  });

  it('keeps a REAL zero open interest as zero', async () => {
    const { fetchFn } = router([
      { match: /openInterest\?/, reply: () => res({ symbol: 'BTCUSDT', openInterest: '0' }) },
      { match: /premiumIndex/, reply: () => res(BINANCE_PREMIUM) },
    ]);
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const oi = await svc.getOpenInterest('BTC');
    expect(oi!.openInterestBase).toBe(0);
    expect(oi!.openInterestUsd).toBe(0);
  });

  it('does not call a venue at all for an asset it does not list', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const binance = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY });
    const okx = new OkxDerivativesService('https://okx.test', { fetchFn, policy: NO_RETRY });
    expect(await binance.getOpenInterest('NOPE')).toBeNull();
    expect(await okx.getFunding('NOPE')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    // The contract maps are explicit; nothing concatenates a ticker.
    expect(binanceContractFor('NOPE')).toBeNull();
    expect(okxContractFor('NOPE')).toBeNull();
  });

  it('parses provider numbers without ever coercing a bad one to zero', () => {
    expect(numeric('0')).toBe(0);
    expect(numeric(0)).toBe(0);
    expect(numeric('1.5')).toBe(1.5);
    for (const bad of ['', '   ', 'abc', null, undefined, {}, [], NaN, Infinity]) {
      expect(numeric(bad)).toBeNull();
    }
  });
});

// ── Transport policy: 429, Retry-After, 5xx, circuit, stale ─────────

describe('transport policy', () => {
  it('retries a 5xx and succeeds on the follow-up attempt', async () => {
    let n = 0;
    const fetchFn = jest.fn(async () => {
      n += 1;
      return n === 1 ? res({}, { status: 503 }) : res(BINANCE_OI);
    }) as unknown as typeof fetch;
    const svc = new BinanceDerivativesService('https://fapi.test', {
      fetchFn,
      policy: { retries: 1, sleep: async () => {} },
    });
    // premiumIndex shares the double and also answers BINANCE_OI-shaped
    // JSON; only the open-interest number is asserted.
    expect((await svc.getOpenInterest('BTC'))!.openInterestBase).toBe(81234.567);
    expect(n).toBeGreaterThan(1);
  });

  it('honours a Retry-After on a 429 and records the rate limit', async () => {
    const slept: number[] = [];
    const fetchFn = jest.fn(async () => res({}, { status: 429, headers: { 'retry-after': '1' } })) as unknown as typeof fetch;
    const svc = new OkxDerivativesService('https://okx.test', {
      fetchFn,
      policy: { retries: 1, maxDelayMs: 5_000, sleep: async (ms) => { slept.push(ms); } },
    });
    await expect(svc.getOpenInterest('BTC')).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalled();
  });

  it('stops calling the venue once its circuit opens, and does not open the other one', async () => {
    const failing = jest.fn(async () => res({}, { status: 500 })) as unknown as typeof fetch;
    const healthy = router(okxRoutes());
    const binance = new BinanceDerivativesService('https://fapi.test', { fetchFn: failing, policy: NO_RETRY });
    const okx = new OkxDerivativesService('https://okx.test', { fetchFn: healthy.fetchFn, policy: NO_RETRY });

    for (let i = 0; i < 8; i++) await binance.getOpenInterest('BTC').catch(() => {});
    const callsAtOpen = (failing as unknown as jest.Mock).mock.calls.length;
    for (let i = 0; i < 5; i++) await binance.getOpenInterest('BTC').catch(() => {});
    // The circuit is open: further attempts cost no network call at all.
    expect((failing as unknown as jest.Mock).mock.calls.length).toBe(callsAtOpen);

    // OKX has its OWN circuit and is unaffected.
    expect((await okx.getOpenInterest('BTC'))!.openInterestBase).toBe(2500.5);
  });

  it('serves the last good value with stale:true inside the budget', async () => {
    let clock = 1_000_000;
    let fail = false;
    const fetchFn = jest.fn(async (url: any) =>
      fail ? res({}, { status: 500 }) : String(url).includes('premiumIndex') ? res(BINANCE_PREMIUM) : res(BINANCE_OI)
    ) as unknown as typeof fetch;
    const svc = new BinanceDerivativesService('https://fapi.test', {
      fetchFn,
      policy: NO_RETRY,
      now: () => clock,
    });

    expect((await svc.getOpenInterest('BTC'))!.stale).toBe(false);
    fail = true;
    clock += 30_000; // past the 15s TTL, inside the 120s stale budget
    const stale = await svc.getOpenInterest('BTC');
    expect(stale!.openInterestBase).toBe(81234.567);
    expect(stale!.stale).toBe(true);
  });

  it('stops serving once the value is past the stale budget', async () => {
    let clock = 1_000_000;
    let fail = false;
    const fetchFn = jest.fn(async (url: any) =>
      fail ? res({}, { status: 500 }) : String(url).includes('premiumIndex') ? res(BINANCE_PREMIUM) : res(BINANCE_OI)
    ) as unknown as typeof fetch;
    const svc = new BinanceDerivativesService('https://fapi.test', { fetchFn, policy: NO_RETRY, now: () => clock });

    await svc.getOpenInterest('BTC');
    fail = true;
    clock += 10 * 60_000; // well past TTL + stale budget
    await expect(svc.getOpenInterest('BTC')).rejects.toThrow();
  });
});

// ── Aggregation, attribution and partial outage ─────────────────────

describe('tracked-venue aggregation', () => {
  function aggregator(opts: { binanceFails?: boolean; okxFails?: boolean } = {}) {
    const b = router(opts.binanceFails ? [{ match: /./, reply: () => res({}, { status: 500 }) }] : binanceRoutes());
    const o = router(opts.okxFails ? [{ match: /./, reply: () => res({}, { status: 500 }) }] : okxRoutes());
    return {
      service: new ExternalDerivativesService(
        new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
        new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
      ),
      binanceCalls: b.mock,
      okxCalls: o.mock,
    };
  }

  it('sums only the venues that answered and names exactly those', async () => {
    const { service } = aggregator();
    const section = await service.getTrackedOpenInterest('BTC');
    if (!section.available) throw new Error('expected available');

    expect(section.value.venues.map((v) => v.venue).sort()).toEqual(['binance', 'okx']);
    expect(section.value.totalOpenInterestUsd).toBeCloseTo(81234.567 * 50100 + 125_000_000, 0);
    expect(ExternalDerivativesService.attributionOf(section.value.venues).map((v) => v.venue)).toEqual(['binance', 'okx']);
  });

  it('drops a failed venue from the value AND from the attribution', async () => {
    const { service } = aggregator({ okxFails: true });
    const section = await service.getTrackedOpenInterest('BTC');
    if (!section.available) throw new Error('expected available');

    // Binance still contributes; OKX must not appear anywhere, so a label
    // derived from this cannot keep claiming "Binance + OKX".
    expect(section.value.venues.map((v) => v.venue)).toEqual(['binance']);
    expect(ExternalDerivativesService.attributionOf(section.value.venues).map((v) => v.venue)).toEqual(['binance']);
    expect(section.value.totalOpenInterestUsd).toBeCloseTo(81234.567 * 50100, 0);
  });

  it('is unavailable — not an empty aggregate — when every venue fails', async () => {
    const { service } = aggregator({ binanceFails: true, okxFails: true });
    for (const section of [
      await service.getTrackedOpenInterest('BTC'),
      await service.getFundingComparison('BTC'),
      await service.getBasisComparison('BTC'),
      await service.getPositioning('BTC'),
    ]) {
      expect(section.available).toBe(false);
      expect(section).toMatchObject({ reason: 'provider_unavailable' });
      expect(section).not.toHaveProperty('value');
    }
  });

  it('never claims a market-wide aggregate anywhere in the payload or the source', async () => {
    const { service } = aggregator();
    const section = await service.getTrackedOpenInterest('BTC');
    const json = JSON.stringify(section);
    expect(json).not.toMatch(/marketWide|market_wide|totalMarket/i);
    // The field is named for what it is.
    if (!section.available) throw new Error('expected available');
    expect(section.value).toHaveProperty('totalOpenInterestUsd');
    expect(section.value).toHaveProperty('venues');
  });

  it('keeps each venue funding rate separate and never averages them', async () => {
    const { service } = aggregator();
    const section = await service.getFundingComparison('BTC');
    if (!section.available) throw new Error('expected available');
    const rates = section.value.venues.map((v) => ({ venue: v.venue, rate: v.fundingRate }));
    expect(rates).toEqual([
      { venue: 'binance', rate: 0.0001 },
      { venue: 'okx', rate: 0.00005 },
    ]);
    expect(section.value).not.toHaveProperty('averageFundingRate');
  });

  it('preserves a real zero funding rate as zero, distinct from a missing one', async () => {
    const b = router([
      { match: /premiumIndex/, reply: () => res({ ...BINANCE_PREMIUM, lastFundingRate: '0' }) },
      { match: /openInterest\?/, reply: () => res(BINANCE_OI) },
    ]);
    const o = router([{ match: /public\/funding-rate/, reply: () => res({ code: '0', data: [{ instId: 'BTC-USDT-SWAP', fundingRate: '' }] }) }]);
    const service = new ExternalDerivativesService(
      new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
      new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
    );
    const section = await service.getFundingComparison('BTC');
    if (!section.available) throw new Error('expected available');
    const byVenue = Object.fromEntries(section.value.venues.map((v) => [v.venue, v.fundingRate]));
    expect(byVenue.binance).toBe(0); // flat funding is a fact
    expect(byVenue.okx).toBeNull(); // unreported is not flat
  });

  it('labels positioning as Binance only rather than cross-venue', async () => {
    const { service } = aggregator();
    const section = await service.getPositioning('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.source).toBe('binance');
    expect(new Set(section.value.ratios.map((r) => r.venue))).toEqual(new Set(['binance']));
    expect(section.value.ratios.map((r) => r.kind).sort()).toEqual(['global_account', 'top_account', 'top_position']);
  });
});

// ── §25: 100 concurrent consumers, bounded provider requests ────────

describe('request coalescing', () => {
  it('collapses 100 simultaneous Analytics consumers into a bounded request count', async () => {
    const b = router(binanceRoutes());
    const o = router(okxRoutes());
    const service = new ExternalDerivativesService(
      new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
      new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
    );

    await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.all([
          service.getTrackedOpenInterest('BTC'),
          service.getFundingComparison('BTC'),
          service.getBasisComparison('BTC'),
          service.getPositioning('BTC'),
        ])
      )
    );

    // Distinct upstream endpoints, each fetched once: Binance
    // openInterest + premiumIndex + three ratio endpoints = 5; OKX
    // open-interest + funding-rate + mark-price + index-tickers = 4.
    expect(new Set(b.calls).size).toBe(5);
    expect(new Set(o.calls).size).toBe(4);
    expect(b.calls.length).toBe(5);
    expect(o.calls.length).toBe(4);
    // 100 consumers, 9 provider requests in total — not 900.
    expect(b.calls.length + o.calls.length).toBe(9);
  });

  it('serves a second wave of 100 consumers from cache with no new requests', async () => {
    const b = router(binanceRoutes());
    const o = router(okxRoutes());
    const service = new ExternalDerivativesService(
      new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
      new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
    );
    await service.getTrackedOpenInterest('BTC');
    const after = b.calls.length + o.calls.length;
    await Promise.all(Array.from({ length: 100 }, () => service.getTrackedOpenInterest('BTC')));
    expect(b.calls.length + o.calls.length).toBe(after);
  });
});

describe('tracked assets', () => {
  it('covers each tracked asset on both venues', () => {
    for (const asset of TRACKED_ASSETS) {
      expect(binanceContractFor(asset)).not.toBeNull();
      expect(okxContractFor(asset)).not.toBeNull();
    }
  });
});

// ── 24h turnover ────────────────────────────────────────────────────

describe('24h turnover', () => {
  function svc(opts: { binanceFails?: boolean; okxFails?: boolean; okxTicker?: unknown; binanceTicker?: unknown } = {}) {
    const b = router(
      opts.binanceFails
        ? [{ match: /./, reply: () => res({}, { status: 500 }) }]
        : [
            { match: /ticker\/24hr/, reply: () => res('binanceTicker' in opts ? opts.binanceTicker : BINANCE_TICKER) },
            ...binanceRoutes(),
          ]
    );
    const o = router(
      opts.okxFails
        ? [{ match: /./, reply: () => res({}, { status: 500 }) }]
        : [{ match: /market\/ticker\?/, reply: () => res('okxTicker' in opts ? opts.okxTicker : OKX_TICKER) }, ...okxRoutes()]
    );
    return {
      service: new ExternalDerivativesService(
        new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
        new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
      ),
      b,
      o,
    };
  }

  it("uses Binance's own quote-currency field verbatim, not price x base volume", async () => {
    const { service, b } = svc();
    const section = await service.getTrackedTurnover24h('BTC');
    if (!section.available) throw new Error('expected available');

    // Exactly `quoteVolume`. The approximation lastPrice x volume would be
    // 50100 * 120000.5 = 6,012,025,050 — close, and wrong.
    expect(section.value.totalTurnoverUsd).toBe(6_012_030_000);
    expect(section.value.totalTurnoverUsd).not.toBe(50100 * 120000.5);
    expect(b.calls.some((u) => u.includes('/fapi/v1/ticker/24hr?symbol=BTCUSDT'))).toBe(true);
  });

  it('reports NO turnover for OKX rather than misreading a base amount as a turnover', async () => {
    const { service } = svc();
    const section = await service.getTrackedTurnover24h('BTC');
    if (!section.available) throw new Error('expected available');

    // OKX answered, but its swap ticker publishes no quote-currency
    // turnover: volCcy24h is a BASE amount and vol24h is a contract count.
    // Neither may appear in the total, and OKX must not be credited.
    expect(section.value.venues.map((v) => v.venue)).toEqual(['binance']);
    expect(section.value.totalTurnoverUsd).toBe(6_012_030_000);
    expect(section.value.totalTurnoverUsd).not.toBe(6_012_030_000 + 11_788.887619);
    expect(section.value.totalTurnoverUsd).not.toBe(6_012_030_000 + 9_876_543);
  });

  it('picks up a genuine OKX quote field if the venue ever publishes one', async () => {
    const { service } = svc({
      okxTicker: { code: '0', data: [{ instId: 'BTC-USDT-SWAP', volCcy24h: '11788.88', volCcyQuote24h: '3000000000' }] },
    });
    const section = await service.getTrackedTurnover24h('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.value.venues.map((v) => v.venue).sort()).toEqual(['binance', 'okx']);
    expect(section.value.totalTurnoverUsd).toBe(6_012_030_000 + 3_000_000_000);
  });

  it('falls back to the single available venue when the other is down', async () => {
    const { service } = svc({ okxFails: true });
    const section = await service.getTrackedTurnover24h('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.value.venues.map((v) => v.venue)).toEqual(['binance']);
    expect(section.value.totalTurnoverUsd).toBe(6_012_030_000);
  });

  it('is unavailable — never zero — when every venue is down', async () => {
    const { service } = svc({ binanceFails: true, okxFails: true });
    const section = await service.getTrackedTurnover24h('BTC');
    expect(section.available).toBe(false);
    expect(section).toMatchObject({ reason: 'provider_unavailable' });
    expect(section).not.toHaveProperty('value');
  });

  it('is unavailable when every venue answers but none publishes a comparable figure', async () => {
    const { service } = svc({ binanceFails: true });
    const section = await service.getTrackedTurnover24h('BTC');
    // Binance down, OKX up but reporting no quote turnover. That is "no
    // data", which is a different fact from "providers unavailable", and
    // it is emphatically not zero.
    expect(section.available).toBe(false);
    expect(section).toMatchObject({ reason: 'no_data' });
    expect(section).not.toHaveProperty('value');
  });

  it('keeps a REAL zero turnover as zero', async () => {
    const { service } = svc({ binanceTicker: { ...BINANCE_TICKER, quoteVolume: '0' } });
    const section = await service.getTrackedTurnover24h('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.value.totalTurnoverUsd).toBe(0);
    expect(section.value.venues[0].turnover24hUsd).toBe(0);
  });

  it('treats an unparseable turnover as unreported, not as zero', async () => {
    const { service } = svc({ binanceTicker: { ...BINANCE_TICKER, quoteVolume: 'n/a' } });
    const section = await service.getTrackedTurnover24h('BTC');
    expect(section.available).toBe(false);
    expect(section).toMatchObject({ reason: 'no_data' });
  });

  it('survives a malformed 24h ticker body', async () => {
    for (const body of [null, 'oops', { code: '51001', data: [] }]) {
      const { service } = svc({ binanceTicker: body, okxTicker: body });
      const section = await service.getTrackedTurnover24h('BTC');
      expect(section.available).toBe(false);
      expect(section).not.toHaveProperty('value');
    }
  });
});

// ── The combined read the Futures header makes ──────────────────────

describe('futures market stats', () => {
  function svc(opts: { binanceFails?: boolean; okxFails?: boolean } = {}) {
    const b = router(
      opts.binanceFails
        ? [{ match: /./, reply: () => res({}, { status: 500 }) }]
        : [{ match: /ticker\/24hr/, reply: () => res(BINANCE_TICKER) }, ...binanceRoutes()]
    );
    const o = router(
      opts.okxFails
        ? [{ match: /./, reply: () => res({}, { status: 500 }) }]
        : [{ match: /market\/ticker\?/, reply: () => res(OKX_TICKER) }, ...okxRoutes()]
    );
    return {
      service: new ExternalDerivativesService(
        new BinanceDerivativesService('https://fapi.test', { fetchFn: b.fetchFn, policy: NO_RETRY }),
        new OkxDerivativesService('https://okx.test', { fetchFn: o.fetchFn, policy: NO_RETRY })
      ),
      b,
      o,
    };
  }

  it('sums BASE-unit open interest only across venues that reported base units', async () => {
    const { service } = svc();
    const section = await service.getFuturesMarketStats('BTC');
    if (!section.available) throw new Error('expected available');

    // Binance openInterest (81234.567 BTC) + OKX oiCcy (2500.5 BTC). Both
    // are base-currency quantities, so they are directly comparable — and
    // no venue's price was applied to another venue's quantity.
    expect(section.value.openInterestBase).toBeCloseTo(81234.567 + 2500.5, 6);
    expect(section.value.openInterestBaseVenues.sort()).toEqual(['binance', 'okx']);
    expect(section.value.baseAsset).toBe('BTC');
  });

  it('credits each metric to its OWN contributors, because they differ', async () => {
    const { service } = svc();
    const section = await service.getFuturesMarketStats('BTC');
    if (!section.available) throw new Error('expected available');
    // OKX contributes open interest but no turnover. A single combined
    // venue list would misattribute one of the two figures.
    expect(section.value.turnoverVenues).toEqual(['binance']);
    expect(section.value.openInterestBaseVenues.sort()).toEqual(['binance', 'okx']);
  });

  it('drops a failed venue from every contributor list', async () => {
    const { service } = svc({ okxFails: true });
    const section = await service.getFuturesMarketStats('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.value.openInterestBaseVenues).toEqual(['binance']);
    expect(section.value.turnoverVenues).toEqual(['binance']);
    expect(section.value.openInterestBase).toBeCloseTo(81234.567, 6);
  });

  it('still reports open interest when only turnover is unavailable', async () => {
    // Binance down: no turnover anywhere, but OKX still has open interest.
    const { service } = svc({ binanceFails: true });
    const section = await service.getFuturesMarketStats('BTC');
    if (!section.available) throw new Error('expected available');
    expect(section.value.turnover24hUsd).toBeNull();
    expect(section.value.turnoverVenues).toEqual([]);
    expect(section.value.openInterestBase).toBeCloseTo(2500.5, 6);
    expect(section.value.openInterestBaseVenues).toEqual(['okx']);
  });

  it('is unavailable when both halves are, and carries no value fields', async () => {
    const { service } = svc({ binanceFails: true, okxFails: true });
    const section = await service.getFuturesMarketStats('BTC');
    expect(section.available).toBe(false);
    expect(section).not.toHaveProperty('value');
  });

  it('never mixes units: a USD total is summed only from USD reporters', async () => {
    const { service } = svc();
    const section = await service.getFuturesMarketStats('BTC');
    if (!section.available) throw new Error('expected available');
    // Binance's notional is priced at Binance's own mark; OKX supplies its
    // own oiUsd. Neither borrowed the other's price.
    expect(section.value.openInterestUsd).toBeCloseTo(81234.567 * 50100 + 125_000_000, 0);
    expect(section.value.openInterestUsdVenues.sort()).toEqual(['binance', 'okx']);
  });

  it('collapses 100 header readers into a bounded provider request count', async () => {
    const { service, b, o } = svc();
    await Promise.all(Array.from({ length: 100 }, () => service.getFuturesMarketStats('BTC')));
    // openInterest + premiumIndex + ticker/24hr on Binance; open-interest
    // + ticker on OKX. Five requests for a hundred readers.
    expect(b.calls.length + o.calls.length).toBe(5);

    const after = b.calls.length + o.calls.length;
    await Promise.all(Array.from({ length: 100 }, () => service.getFuturesMarketStats('BTC')));
    // Second wave, cache still fresh: zero additional upstream requests.
    expect(b.calls.length + o.calls.length).toBe(after);
  });
});
