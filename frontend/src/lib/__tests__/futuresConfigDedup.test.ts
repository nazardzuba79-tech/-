import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { futuresConfigStore } from '../futuresConfigStore';
import { api } from '../api';

/**
 * ONE read of `/futures/config` per tab.
 *
 * Measured on the shipped build against `scripts/qa-perf-harness.cjs`: a
 * cold `/futures` fetched this static endpoint **three times inside ~250 ms
 * with a 0 ms spread** — `FuturesPage`, `FuturesOrderForm` and
 * `FuturesTickerBar` each calling `api.getFuturesConfig()` from their own
 * mount effect, with no cache between them. Two more call sites did the
 * same on `/markets` and the homepage.
 *
 * Two properties are asserted here, and the second is the one that keeps
 * the first true a year from now:
 *
 *   1. The store coalesces: concurrent callers share ONE request, later
 *      callers are served from memory, a failure stays a failure and never
 *      becomes a default config.
 *   2. NOBODY ELSE CALLS THE ENDPOINT. A fourth consumer written the old
 *      way reintroduces exactly the burst this replaced, and no behavioural
 *      test can see that — so the call site itself is what is pinned.
 */

jest.mock('../api', () => ({
  api: { getFuturesConfig: jest.fn() },
}));

const getFuturesConfig = api.getFuturesConfig as jest.MockedFunction<typeof api.getFuturesConfig>;

type Config = Awaited<ReturnType<typeof api.getFuturesConfig>>;

/** Distinctive on every field, so a dropped or defaulted one is visible. */
const CONFIG: Config = {
  symbols: ['AAA/USDT', 'BBB/USDT'],
  minLeverage: 2,
  maxLeverage: 37,
  fundingIntervalHours: 3,
  highLeverageWarningThreshold: 11,
  leverageTiers: [{ notionalCap: 12345, maxLeverage: 37, maintenanceMarginRate: 0.0123, maintenanceAmount: 0 }],
};

/** A promise the test resolves by hand, so "in flight" is a real state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  futuresConfigStore._resetForTests();
  getFuturesConfig.mockReset();
});

describe('the store coalesces every consumer onto one request', () => {
  it('three consumers mounting together produce ONE fetch', async () => {
    const gate = deferred<Config>();
    getFuturesConfig.mockReturnValue(gate.promise);

    // Exactly what a cold /futures does: three components mount in the same
    // tick and each declares it needs the config.
    futuresConfigStore.ensure();
    futuresConfigStore.ensure();
    futuresConfigStore.ensure();
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);

    gate.resolve(CONFIG);
    await gate.promise;
    await Promise.resolve();

    expect(getFuturesConfig).toHaveBeenCalledTimes(1);
    expect(futuresConfigStore.getState().config).toEqual(CONFIG);
  });

  it('a consumer arriving mid-flight joins it rather than racing it', async () => {
    const gate = deferred<Config>();
    getFuturesConfig.mockReturnValue(gate.promise);

    const first = futuresConfigStore.load();
    const second = futuresConfigStore.load();
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);

    gate.resolve(CONFIG);
    // Both callers get the same resolved value, not two different objects.
    expect(await first).toBe(await second);
    expect(await first).toEqual(CONFIG);
  });

  it('a consumer arriving later is served from memory, with no network at all', async () => {
    getFuturesConfig.mockResolvedValue(CONFIG);
    await futuresConfigStore.load();
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);

    // Navigating away and back: new mounts, same tab.
    futuresConfigStore.ensure();
    futuresConfigStore.ensure();
    futuresConfigStore.ensure();
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);
    expect(futuresConfigStore.getState().config).toEqual(CONFIG);
  });

  it('every field reaches the consumers exactly as the server sent it', async () => {
    getFuturesConfig.mockResolvedValue(CONFIG);
    await futuresConfigStore.load();
    const { config } = futuresConfigStore.getState();
    // Not `toEqual(CONFIG)` alone: each field is named, so a store that
    // quietly reshaped or dropped one cannot pass by being deep-equal to
    // its own output.
    expect(config!.symbols).toEqual(['AAA/USDT', 'BBB/USDT']);
    expect(config!.minLeverage).toBe(2);
    expect(config!.maxLeverage).toBe(37);
    expect(config!.fundingIntervalHours).toBe(3);
    expect(config!.highLeverageWarningThreshold).toBe(11);
    expect(config!.leverageTiers).toEqual(CONFIG.leverageTiers);
  });

  it('keeps object identity when a re-read returns the same payload', async () => {
    getFuturesConfig.mockResolvedValue(CONFIG);
    await futuresConfigStore.load();
    const first = futuresConfigStore.getState().config;

    getFuturesConfig.mockResolvedValue({ ...CONFIG });
    await futuresConfigStore.refresh();
    // A consumer keying an effect on `config` must not be re-run because
    // an unchanged config was read again.
    expect(futuresConfigStore.getState().config).toBe(first);
  });

  it('adopts a genuinely changed payload', async () => {
    getFuturesConfig.mockResolvedValue(CONFIG);
    await futuresConfigStore.load();

    getFuturesConfig.mockResolvedValue({ ...CONFIG, symbols: ['ZZZ/USDT'] });
    await futuresConfigStore.refresh();
    expect(futuresConfigStore.getState().config!.symbols).toEqual(['ZZZ/USDT']);
  });
});

describe('a failure stays a failure', () => {
  it('never substitutes a default config', async () => {
    getFuturesConfig.mockRejectedValue(new Error('network'));
    await expect(futuresConfigStore.load()).rejects.toThrow('network');

    const state = futuresConfigStore.getState();
    // `null` is UNKNOWN. Not an empty symbol list, not a zero funding
    // interval, not an empty tier table — each of which would look like a
    // real answer to a consumer.
    expect(state.config).toBeNull();
    expect(state.failed).toBe(true);
    expect(state.loaded).toBe(true);
  });

  it('rejects for every joined caller, not just the first', async () => {
    getFuturesConfig.mockRejectedValue(new Error('network'));
    const a = futuresConfigStore.load();
    const b = futuresConfigStore.load();
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);
    await expect(a).rejects.toThrow('network');
    await expect(b).rejects.toThrow('network');
  });

  it('retries on the next mount, and not before', async () => {
    getFuturesConfig.mockRejectedValueOnce(new Error('network'));
    await expect(futuresConfigStore.load()).rejects.toThrow('network');
    expect(getFuturesConfig).toHaveBeenCalledTimes(1);

    // Retry is explicit: it happens because a consumer mounted, never on a
    // timer. Three mounts still cost one request.
    getFuturesConfig.mockResolvedValue(CONFIG);
    futuresConfigStore.ensure();
    futuresConfigStore.ensure();
    expect(getFuturesConfig).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(futuresConfigStore.getState().config).toEqual(CONFIG);
  });

  it('keeps the last good answer when a later read fails, flagged stale', async () => {
    getFuturesConfig.mockResolvedValue(CONFIG);
    await futuresConfigStore.load();

    getFuturesConfig.mockRejectedValue(new Error('later failure'));
    await expect(futuresConfigStore.refresh()).rejects.toThrow('later failure');

    const state = futuresConfigStore.getState();
    expect(state.config).toEqual(CONFIG);
    expect(state.failed).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else if (/\.tsx?$/.test(p) && !p.includes('__tests__')) out.push(relative(frontend, p));
  };
  walk(resolve(frontend, 'src'));
  return out.sort();
}

describe('nobody fetches /futures/config except the store', () => {
  it('the endpoint has exactly one client method, and one caller', () => {
    const callers = sources().filter(
      (f) => f !== 'src/lib/api.ts' && /\bapi\s*\.?\s*\n?\s*\.?getFuturesConfig\s*\(/.test(stripComments(read(f))),
    );
    // The assertion that fails the moment a fourth consumer is written the
    // old way — which is the only way this regression can come back.
    expect(callers).toEqual(['src/lib/futuresConfigStore.ts']);

    // And the endpoint itself is still reached through the one client
    // method, not by a hand-rolled fetch somewhere.
    const rawFetchers = sources().filter(
      (f) => f !== 'src/lib/api.ts' && /['"`][^'"`]*\/futures\/config/.test(stripComments(read(f))),
    );
    expect(rawFetchers).toEqual([]);
  });

  it('the three /futures consumers read it through the shared hook', () => {
    for (const file of [
      'src/pages/FuturesPage.tsx',
      'src/components/FuturesOrderForm.tsx',
      'src/components/FuturesTickerBar.tsx',
      'src/pages/markets-bolt/components.tsx',
    ]) {
      expect(read(file)).toContain('useFuturesConfig');
    }
    // The homepage needs the value itself inside a larger effect, so it
    // takes the imperative form of the same single request.
    expect(read('src/pages/home/useHomeMarket.ts')).toContain('futuresConfigStore');
    expect(read('src/pages/home/useHomeMarket.ts')).toContain('.load()');
  });

  it('and the store schedules nothing — no timer, no polling loop', () => {
    const src = stripComments(read('src/lib/futuresConfigStore.ts'));
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
