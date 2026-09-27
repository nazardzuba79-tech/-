/**
 * IDLE DATABASE BUDGET — the backend's background loops on a completely idle
 * exchange, over a simulated day.
 *
 * Every background loop index.ts starts is built from its real class, on a
 * recording Prisma client that answers "empty" to everything, and started
 * through the very function production uses (createServerBackground). The
 * clock is simulated, so 24 hours run in seconds. Every Prisma call is
 * counted and attributed to the service that issued it (from its stack), so
 * the scheduled work — funding at 00/08/16 UTC, the deposit watcher's
 * daytime slots — is reported separately from the table sweeps.
 *
 * This counts Prisma operations on a fixture, not SQL on Neon, and says
 * nothing about Neon billing. Run in a checkout of the previous main (which
 * has no createServerBackground) the same file measures the loops as main
 * started them, which is how the BEFORE figures in the PR were produced.
 * Set IDLE_BUDGET_REPORT=<path> to write the measured figures as JSON.
 */
import BigNumber from 'bignumber.js';
import { writeFileSync } from 'fs';
import { LiquidationEngine } from '../futures/LiquidationEngine';
import { FuturesProtectionService } from '../futures/FuturesProtectionService';
import { CfdLiquidationEngine } from '../cfd/CfdLiquidationEngine';
import { PriceWatcherService } from '../services/PriceWatcherService';
import { FundingRateService } from '../futures/FundingRateService';
import { FuturesMarketRegistry } from '../futures/FuturesMarketRegistry';
import { PrivateTradingService } from '../private-trading/service';
import { PrivateTradingStore } from '../private-trading/store';
import { createNativeLimitPass } from '../private-trading/native/limitPass';
import { DepositWatchService } from '../services/deposits/DepositWatchService';
import { DepositWatchScheduler } from '../services/deposits/DepositWatchScheduler';

// Absent on the previous main: the harness then starts the loops the way
// main's index.ts did, one by one.
let createServerBackground: ((parts: any) => { start(): void; stop(): Promise<void>; coordinator: any }) | null = null;
try { createServerBackground = require('../serverBackground').createServerBackground; } catch { createServerBackground = null; }
const MODE = createServerBackground ? 'after' : 'before';

const OWNER = '00000000-0000-4000-8000-00000000a11a';
const START = new Date('2026-09-28T00:30:00Z'); // Kyiv 03:30: night, no deposit slot
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const READS = new Set(['findMany', 'findUnique', 'findFirst', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', '$queryRaw', '$queryRawUnsafe']);
const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe']);
const SOURCES: Array<[RegExp, string]> = [
  [/FundingRateService/, 'funding'],
  [/deposits\//, 'deposit-watcher'],
  [/FuturesMarketRegistry/, 'futures-registry'],
  [/FuturesProtectionService/, 'futures-protection'],
  [/CfdLiquidationEngine/, 'cfd-liquidation'],
  [/LiquidationEngine/, 'futures-liquidation'],
  [/PriceWatcherService/, 'spot-conditional'],
  [/native\/limitPass/, 'native-limit-pass'],
  [/private-trading\//, 'private-owner-pass'],
];
const SCHEDULED = new Set(['funding', 'deposit-watcher']);
// Neon suspends compute after 5 idle minutes (its default suspend timeout).
const NEON_AWAKE_MS = 5 * MINUTE;

interface Op { at: number; source: string; model: string; op: string; kind: 'read' | 'write' | 'tx' }

function sourceOf(stack: string): string {
  const frames = stack.split('\n').filter((l) => l.includes('/src/') && !l.includes('__tests__'));
  for (const frame of frames) for (const [re, name] of SOURCES) if (re.test(frame)) return name;
  return 'other';
}

/** A Prisma client that answers "nothing there" and records every call. */
function recordingPrisma(overrides: Record<string, (args: any) => any>) {
  const ops: Op[] = [];
  const record = (model: string, op: string, kind: Op['kind']) =>
    ops.push({ at: Date.now(), source: sourceOf(new Error().stack ?? ''), model, op, kind });
  const empty: Record<string, () => unknown> = {
    findMany: () => [], groupBy: () => [], findUnique: () => null, findFirst: () => null, count: () => 0,
    aggregate: () => ({ _sum: {}, _count: {} }), updateMany: () => ({ count: 0 }), deleteMany: () => ({ count: 0 }), createMany: () => ({ count: 0 }),
  };
  const delegate = (model: string) => new Proxy({}, {
    get: (_t, op: string) => async (args: any) => {
      record(model, op, READS.has(op) ? 'read' : WRITES.has(op) ? 'write' : 'read');
      const custom = overrides[`${model}.${op}`];
      if (custom) return custom(args);
      if (op in empty) return empty[op]();
      if (op === 'create' || op === 'update') return { id: `${model}-row`, ...(args?.data ?? {}) };
      if (op === 'upsert') return { id: `${model}-row`, ...(args?.create ?? {}) };
      throw new Error(`recording prisma: no answer for ${model}.${op}`);
    },
  });
  const client: any = new Proxy({}, {
    get: (_t, key: string) => {
      if (key === 'then') return undefined;
      if (key === '$transaction') return async (arg: any) => {
        record('$', 'BEGIN', 'tx');
        try { return Array.isArray(arg) ? await Promise.all(arg) : await arg(client); }
        finally { record('$', 'COMMIT', 'tx'); }
      };
      if (key === '$queryRaw' || key === '$queryRawUnsafe') return async () => { record('$raw', key, 'read'); return overrides[key]?.(null) ?? []; };
      if (key === '$executeRaw' || key === '$executeRawUnsafe') return async () => { record('$raw', key, 'write'); return 0; };
      if (key.startsWith('$')) return async () => undefined;
      return delegate(key);
    },
  });
  return { client, ops };
}

function build(scenario: 'empty' | 'owner-session') {
  const overrides: Record<string, (args: any) => any> = {
    // The deposit watcher as shipped: paused until an admin resumes it.
    'depositWatchState.findUniqueOrThrow': () => ({ id: 'tron', enabled: false, providerStatus: null, lastScheduledRunAt: null, lastAdminOpenRunAt: null, lastSuccessAt: null }),
  };
  if (scenario === 'owner-session') {
    // The owner's legacy private account exists with a live session and
    // nothing open: the most the owner pass can read while idle.
    const session = { userId: OWNER, sessionId: 'session-1', expiresAt: START.getTime() + 30 * 24 * HOUR };
    overrides['privateTradingAccount.findUnique'] = () => ({ userId: OWNER, state: { session, positions: [], orders: [], scenarios: [] } });
    overrides['user.findUnique'] = () => ({ role: 'ADMIN', blockedAt: null });
    overrides['session.findUnique'] = () => ({ userId: OWNER, revokedAt: null });
  }
  const { client: prisma, ops } = recordingPrisma(overrides);
  const config = () => ({ enabled: true, ownerId: OWNER });
  const mark = { getMarkPrice: async () => new BigNumber('100'), getIndexPrice: async () => new BigNumber('100'), recordFuturesTrade() {} } as any;
  const tickers = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].map((pair) => ({ pair, lastPrice: '100', quoteVolume24h: '1000000000', volume24h: '1' }));
  const marketData = { getTickers: async () => tickers, getTicker: async () => ({ lastPrice: '100' }) } as any;
  const cfdQuotes = { isConfigured: () => true, maxQuoteAgeMs: 5000, getQuotes: async () => [], getFreshQuote: async () => { throw new Error('none'); } } as any;

  const futuresMarketRegistry = new FuturesMarketRegistry(marketData, prisma, null);
  const parts = {
    futuresMarketRegistry,
    fundingRateService: new FundingRateService(prisma, mark, () => futuresMarketRegistry.list()),
    liquidationEngine: new LiquidationEngine(prisma, mark),
    futuresProtectionService: new FuturesProtectionService(prisma, {} as any, mark),
    cfdLiquidationEngine: new CfdLiquidationEngine(prisma, cfdQuotes),
    priceWatcherService: new PriceWatcherService(prisma, {} as any, marketData),
    privateTradingService: new PrivateTradingService(new PrivateTradingStore(prisma, config), null),
    nativeLimitPass: createNativeLimitPass(prisma, {} as any, config),
  };
  const deposits = new DepositWatchScheduler(new DepositWatchService(prisma, async () => { throw new Error('not configured'); }));
  return { parts, deposits, ops };
}

function start(parts: any, deposits: DepositWatchScheduler) {
  let background: { stop(): Promise<void>; coordinator: any } | null = null;
  if (createServerBackground) {
    const b = createServerBackground(parts);
    b.start();
    background = b;
  } else {
    // main's index.ts, in its order.
    parts.futuresMarketRegistry.start();
    parts.fundingRateService.startScheduler();
    parts.liquidationEngine.startScheduler();
    parts.futuresProtectionService.startScheduler();
    parts.cfdLiquidationEngine.startScheduler();
    parts.priceWatcherService.startScheduler(5_000);
    parts.privateTradingService.start();
    parts.nativeLimitPass.start();
  }
  deposits.start();
  return async () => {
    deposits.stop();
    if (background) await background.stop();
    else {
      parts.futuresMarketRegistry.stop(); parts.fundingRateService.stopScheduler(); parts.liquidationEngine.stopScheduler();
      parts.futuresProtectionService.stopScheduler(); parts.cfdLiquidationEngine.stopScheduler(); parts.priceWatcherService.stopScheduler();
      parts.privateTradingService.stop(); await parts.nativeLimitPass.stop();
    }
  };
}

async function advance(ms: number) {
  for (let done = 0; done < ms; done += MINUTE) await jest.advanceTimersByTimeAsync(Math.min(MINUTE, ms - done));
}

function tally(ops: Op[], from: number, to: number) {
  const inWindow = ops.filter((o) => o.at >= from && o.at < to);
  const bySource: Record<string, { reads: number; writes: number; tx: number }> = {};
  for (const o of inWindow) {
    const s = (bySource[o.source] ??= { reads: 0, writes: 0, tx: 0 });
    if (o.kind === 'read') s.reads++; else if (o.kind === 'write') s.writes++; else s.tx++;
  }
  const sum = (pick: (s: { reads: number; writes: number; tx: number }) => number, filter: (name: string) => boolean) =>
    Object.entries(bySource).filter(([name]) => filter(name)).reduce((n, [, s]) => n + pick(s), 0);
  // A sweep that runs within NEON_AWAKE_MS after scheduled work (funding, a
  // deposit slot) finds the database already awake: it costs queries, not a
  // wake. Anything else a sweep does while idle is a wake of its own.
  const scheduledAt = inWindow.filter((o) => SCHEDULED.has(o.source)).map((o) => o.at);
  const piggybacked = (at: number) => scheduledAt.some((t) => at >= t && at - t <= NEON_AWAKE_MS);
  const own = inWindow.filter((o) => !SCHEDULED.has(o.source) && o.kind !== 'tx' && !piggybacked(o.at));
  return {
    bySource,
    wakesOfTheirOwn: own.length,
    watchers: { reads: sum((s) => s.reads, (n) => !SCHEDULED.has(n)), writes: sum((s) => s.writes, (n) => !SCHEDULED.has(n)) },
    scheduled: { reads: sum((s) => s.reads, (n) => SCHEDULED.has(n)), writes: sum((s) => s.writes, (n) => SCHEDULED.has(n)), tx: sum((s) => s.tx, (n) => SCHEDULED.has(n)) },
  };
}

async function measure(scenario: 'empty' | 'owner-session') {
  jest.useFakeTimers({ now: START, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const { parts, deposits, ops } = build(scenario);
  const t0 = Date.now();
  const stop = start(parts, deposits);
  await advance(30 * MINUTE);
  const firstHalfHour = tally(ops, t0, t0 + 30 * MINUTE);
  await advance(24 * HOUR - 30 * MINUTE);
  const timersAtRest = jest.getTimerCount();
  const steady = tally(ops, t0 + 30 * MINUTE, t0 + 24 * HOUR);
  const day = tally(ops, t0, t0 + 24 * HOUR);
  await stop();
  jest.useRealTimers();
  const steadyHours = 23.5;
  return {
    scenario,
    firstHalfHour,
    steadyPerHour: { reads: steady.watchers.reads / steadyHours, writes: steady.watchers.writes / steadyHours },
    steady,
    day,
    timersAtRest,
  };
}

const report: Record<string, unknown> = { mode: MODE, start: START.toISOString() };
afterAll(() => {
  if (process.env.IDLE_BUDGET_REPORT) writeFileSync(process.env.IDLE_BUDGET_REPORT, JSON.stringify(report, null, 2));
});

describe(`idle database budget over a simulated day (${MODE})`, () => {
  beforeAll(() => { jest.spyOn(console, 'info').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => jest.restoreAllMocks());

  for (const scenario of ['empty', 'owner-session'] as const) {
    it(`${scenario}: sweeps stop reading an empty database once they have proven it empty`, async () => {
      const result = await measure(scenario);
      report[scenario] = result;
      if (MODE !== 'after') return; // BEFORE is measured, not asserted.

      // After the start-up recovery scans and the grace window, the table
      // sweeps never touch the database on their own account for the rest
      // of the day. Their only reads are the reconciliation re-check that
      // rides each funding boundary, inside the minutes funding has already
      // woken the database for: one sweep per loop per boundary.
      expect(result.steady.wakesOfTheirOwn).toBe(0);
      const loops = Object.keys(result.steady.bySource).filter((name) => !['funding', 'deposit-watcher'].includes(name));
      expect(loops.sort()).toEqual(['cfd-liquidation', 'futures-liquidation', 'futures-protection', 'native-limit-pass', 'private-owner-pass', 'spot-conditional']);
      // The listing refresh no longer re-reads positions every 15 minutes.
      expect(result.steady.bySource['futures-registry']).toBeUndefined();
      // A sleeping backend holds only the handful of scheduling timers
      // (listing refresh, funding boundary, deposit slot, reconciliation).
      expect(result.timersAtRest).toBeLessThanOrEqual(4);
    }, 300_000);
  }
});
