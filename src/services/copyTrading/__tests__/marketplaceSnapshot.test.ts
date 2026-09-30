import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService, type PerformanceStrategy } from '../CopyPerformanceService';
import { MarketplaceSnapshots, decodeMarketplaceSnapshot, encodeMarketplaceSnapshot, marketplaceSection,
  marketplaceSnapshotId, INLINE_REFRESH_BUDGET_MS, DAILY_REFRESH_OFFSET_MS } from '../marketplaceSnapshot';
import { validStrategy } from '../../../../frontend/src/lib/copyMarketplaceStore';

/**
 * WHY THE CARDS HUNG, PINNED.
 *
 * Production logged 42.29 s for the first marketplace request of 2026-09-28:
 * the day's append and Nazar's replay ran inside the request, synchronously,
 * on a 0.1-CPU container, and the browser abandons at 15 s. These cases hold
 * the append FOREVER — slower than any budget — and require the marketplace
 * to answer anyway, with real, previously confirmed data and nothing made up.
 */

jest.setTimeout(180_000);

function table() {
  const rows = new Map<string, any>();
  const delegate = {
    findUnique: jest.fn(async ({ where }: any) => { const row = rows.get(where.id); return row ? { ...row } : null; }),
    create: jest.fn(async ({ data }: any) => {
      if (rows.has(data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const row = { ...data, revision: 0 }; rows.set(data.id, row); return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment }); return { count: 1 };
    }),
  };
  const db = {
    copyPerformanceScenario: delegate,
    copyStrategyOwner: { async findUnique({ where }: any) { return { traderId: where.traderId, publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia', ownerUserId: null, premium: true }; } },
    user: { async findUnique() { return { avatarUrl: null, kycStatus: 'NOT_STARTED' }; } },
    session: { async findUnique({ where }: any) { return { id: where.id, userId: 'viewer', revokedAt: null, lastSeenAt: new Date() }; },
      async update({ where }: any) { return { id: where.id }; } },
  } as any;
  return { db, rows, delegate };
}
const at = (day: string) => () => new Date(`${day}T12:00:00Z`);
const bearer = () => `Bearer ${jwt.sign({ sub: 'viewer', sid: 'session-1' }, process.env.JWT_SECRET as string, { expiresIn: '1h' })}`;
const never = <T>() => new Promise<T>(() => {});

/** Yesterday's process: builds and publishes both sections for `day`. */
async function publishDay(db: any, day: string) {
  const service = new CopyPerformanceService(db, at(day));
  const snapshots = new MarketplaceSnapshots(db, service, { now: at(day), build: null });
  const nazar = await snapshots.section('nazar');
  const ksenia = await snapshots.section('ksenia');
  return { nazar, ksenia };
}

let yesterday: { nazar: any; ksenia: any };
let shared: ReturnType<typeof table>;
beforeAll(async () => {
  shared = table();
  yesterday = await publishDay(shared.db, '2026-09-27');
});
function cloneTable() {
  const copy = table();
  for (const [id, row] of shared.rows) copy.rows.set(id, { ...row });
  return copy;
}

it('publishes each strategy beside its ledger row, never inside it', () => {
  expect([...shared.rows.keys()].sort()).toEqual([
    'ksenia-performance-v1', 'ksenia-performance-v1:marketplace',
    'nazar-performance-v8', 'nazar-performance-v8:marketplace',
  ]);
  for (const strategy of ['nazar', 'ksenia'] as PerformanceStrategy[]) {
    const stored = decodeMarketplaceSnapshot(strategy, shared.rows.get(marketplaceSnapshotId(strategy)).stateText);
    expect(stored?.day).toBe('2026-09-27');
    expect(JSON.stringify(stored?.section)).toBe(JSON.stringify(yesterday[strategy]));
    // The published copy is small: it is the wire section, not the ledger.
    expect(shared.rows.get(marketplaceSnapshotId(strategy)).stateText.length).toBeLessThan(200_000);
  }
});

it('a process that has just started serves today\'s published section without replaying history', async () => {
  const { db } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const get = jest.spyOn(service, 'get').mockImplementation(never);
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null });
  const started = Date.now();
  expect(JSON.stringify(await snapshots.section('nazar'))).toBe(JSON.stringify(yesterday.nazar));
  expect(JSON.stringify(await snapshots.section('ksenia'))).toBe(JSON.stringify(yesterday.ksenia));
  expect(Date.now() - started).toBeLessThan(1_500);
  expect(get).not.toHaveBeenCalled();
});

it('a new UTC day whose append never finishes still answers at once, with the last confirmed day, over real HTTP', async () => {
  const { db } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  const get = jest.spyOn(service, 'get').mockImplementation(never);
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: null });
  const server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const started = Date.now();
  const response = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());
  expect(response.status).toBe(200);
  expect(Date.now() - started).toBeLessThan(2_000);
  const body = JSON.parse(JSON.stringify(response.body));
  expect(body.errors).toEqual({});
  expect(validStrategy(body.nazar, 'VX-001')).toBe(true);
  expect(validStrategy(body.ksenia, 'VX-KSENIA')).toBe(true);
  // Real, previously confirmed figures — the day says which day they are,
  // and the client marks a section older than today as stale on its own.
  expect(body.nazar.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
  expect(body.ksenia.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
  expect(JSON.stringify(body.nazar)).toBe(JSON.stringify(JSON.parse(JSON.stringify(yesterday.nazar))));
  // The day's work was started — after the answer, one strategy at a time.
  await new Promise(resolve => setImmediate(resolve));
  expect(get.mock.calls.map(call => call[0])).toEqual(['nazar']);
});

it('the refresh then publishes the new day, and the next request carries it', async () => {
  const { db, rows } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: null });
  const first = await snapshots.section('nazar');
  expect(first.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
  // Let the background refresh finish, then ask again.
  await service.get('nazar');
  await new Promise(resolve => setTimeout(resolve, 50));
  const second = await snapshots.section('nazar');
  expect(second.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-28');
  expect(second.dailyResults.at(-1)!.date).toBe('2026-09-28');
  // History before the new day is byte-identical.
  expect(JSON.stringify(second.dailyResults.slice(0, first.dailyResults.length))).toBe(JSON.stringify(first.dailyResults));
  expect(decodeMarketplaceSnapshot('nazar', rows.get(marketplaceSnapshotId('nazar')).stateText)?.day).toBe('2026-09-28');
});

it('where this process has already done the day\'s work inside the budget, it waits for today', async () => {
  const { db } = cloneTable();
  let day = '2026-09-28';
  const now = () => new Date(`${day}T12:00:00Z`);
  const service = new CopyPerformanceService(db, now);
  const snapshots = new MarketplaceSnapshots(db, service, { now, build: null, inlineBudgetMs: 60_000 });
  // No measurement yet in this process: the confirmed day answers first.
  expect((await snapshots.section('nazar')).simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
  await service.get('nazar');
  await new Promise(resolve => setTimeout(resolve, 50));
  day = '2026-09-29';
  // Measured, and well inside the budget: the first answer of the day is the day.
  expect((await snapshots.section('nazar')).simulation.simulatedAt.slice(0, 10)).toBe('2026-09-29');
});

it('never runs two refreshes at once, and runs Nazar before Ksenia', async () => {
  const { db } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  let active = 0; let peak = 0; const order: string[] = [];
  const release: (() => void)[] = [];
  jest.spyOn(service, 'get').mockImplementation(async (strategy: PerformanceStrategy) => {
    active++; peak = Math.max(peak, active); order.push(strategy);
    await new Promise<void>(resolve => release.push(resolve));
    active--;
    return yesterday[strategy] as any;
  });
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: null });
  await snapshots.section('nazar');
  await snapshots.section('ksenia');
  for (let i = 0; i < 10 && release.length < 2; i++) { release.shift()?.(); await new Promise(r => setImmediate(r)); }
  release.forEach(fn => fn());
  expect(peak).toBe(1);
  expect(order).toEqual(['nazar', 'ksenia']);
});

it('a section written by another build is served only as a stale answer while this build makes its own', async () => {
  const { db, rows } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const get = jest.spyOn(service, 'get').mockImplementation(never);
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: 'next-build' });
  expect(JSON.stringify(await snapshots.section('nazar'))).toBe(JSON.stringify(yesterday.nazar));
  await new Promise(resolve => setImmediate(resolve));
  expect(get).toHaveBeenCalledWith('nazar');
  expect(rows.has(marketplaceSnapshotId('nazar'))).toBe(true);
});

it('refuses a stored section that does not decode, or claims another strategy, and takes the authoritative path', async () => {
  const { db, rows } = cloneTable();
  rows.get(marketplaceSnapshotId('nazar')).stateText = 'gz1:not-base64-gzip';
  rows.get(marketplaceSnapshotId('ksenia')).stateText = encodeMarketplaceSnapshot('nazar',
    { day: '2026-09-27', build: null, section: yesterday.nazar });
  expect(decodeMarketplaceSnapshot('nazar', rows.get(marketplaceSnapshotId('nazar')).stateText)).toBeNull();
  expect(decodeMarketplaceSnapshot('ksenia', rows.get(marketplaceSnapshotId('ksenia')).stateText)).toBeNull();
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null });
  // The ledger rows are intact, so the authoritative path rebuilds the same bytes.
  expect(JSON.stringify(await snapshots.section('nazar'))).toBe(JSON.stringify(yesterday.nazar));
  expect(JSON.stringify(await snapshots.section('ksenia'))).toBe(JSON.stringify(yesterday.ksenia));
});

it('a slower instance never replaces a later published day with an earlier one', async () => {
  const { db, rows } = cloneTable();
  const later = rows.get(marketplaceSnapshotId('nazar'));
  later.simulatedAt = new Date('2026-09-30T00:00:00Z');
  const before = later.stateText;
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  jest.spyOn(service, 'get').mockResolvedValue(marketplaceSection('nazar', yesterday.nazar as any) as any);
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: 'another' });
  await snapshots.section('nazar');
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(rows.get(marketplaceSnapshotId('nazar')).stateText).toBe(before);
});

it('the day\'s refresh lets the event loop run between its heavy steps', async () => {
  const { db } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  let ticks = 0; let running = true;
  const tick = () => { ticks++; if (running) setImmediate(tick); };
  setImmediate(tick);
  await service.get('nazar'); // decode, append, encode, write, replay
  running = false;
  // Without the yields the whole refresh is one uninterrupted stretch and
  // no other callback — no other request — runs until it is over.
  expect(ticks).toBeGreaterThanOrEqual(4);
});

it('a process that was fast yesterday never waits past the budget when today is slow', async () => {
  const { db } = cloneTable();
  let day = '2026-09-28';
  const now = () => new Date(`${day}T12:00:00Z`);
  const service = new CopyPerformanceService(db, now);
  const snapshots = new MarketplaceSnapshots(db, service, { now, build: null, inlineBudgetMs: 300 });
  // Yesterday's refresh took 10 ms in this process; today's never ends.
  (snapshots as any).lastRefreshMs.set('nazar', 10);
  day = '2026-09-29';
  jest.spyOn(service, 'get').mockImplementation(never);
  const started = Date.now();
  const section = await snapshots.section('nazar');
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  expect(section.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
});

it('both stale sections share elapsed request time and answer before the real client aborts', async () => {
  const { db, delegate } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  const get = jest.spyOn(service, 'get').mockImplementation(never);
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: null });
  // Both refreshes were fast yesterday. Today Nazar stalls, and Ksenia's
  // heavy work remains queued behind it. With serial section reads this
  // exact HTTP request took 20,042 ms: two separate 10 s waits, beyond the
  // browser's actual 15 s abort, even though both confirmed sections exist.
  for (const strategy of ['nazar', 'ksenia']) (snapshots as any).lastRefreshMs.set(strategy, 1);
  const server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const started = Date.now();
  const response = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());
  const elapsed = Date.now() - started;
  expect(response.status).toBe(200);
  expect(elapsed).toBeGreaterThanOrEqual(INLINE_REFRESH_BUDGET_MS - 100);
  expect(elapsed).toBeLessThan(15_000);
  for (const [strategy, id] of [['nazar', 'VX-001'], ['ksenia', 'VX-KSENIA']]) {
    expect(validStrategy(response.body[strategy], id)).toBe(true);
    expect(response.body[strategy].simulation.simulatedAt.slice(0, 10)).toBe('2026-09-27');
  }
  // Reading sections together must not run their heavy replays together.
  expect(get.mock.calls.map(call => call[0])).toEqual(['nazar']);
  expect(delegate.create).not.toHaveBeenCalled();
  expect(delegate.updateMany).not.toHaveBeenCalled();
});

it('concurrent cold HTTP requests coalesce each heavy refresh and write each ledger and section once', async () => {
  const { db, delegate, rows } = table();
  const service = new CopyPerformanceService(db, at('2026-09-28'));
  const originalGet = service.get.bind(service);
  let active = 0; let peak = 0;
  const get = jest.spyOn(service, 'get').mockImplementation(async strategy => {
    active++; peak = Math.max(peak, active);
    try { return await originalGet(strategy); }
    finally { active--; }
  });
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-28'), build: null });
  const server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const responses = await Promise.all([0, 1].map(() => request(server)
    .get('/api/v1/copy-trading/marketplace').set('Authorization', bearer())));
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(validStrategy(response.body.nazar, 'VX-001')).toBe(true);
    expect(validStrategy(response.body.ksenia, 'VX-KSENIA')).toBe(true);
    expect(response.body.nazar.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-28');
    expect(response.body.ksenia.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-28');
  }
  expect(peak).toBe(1);
  expect(get.mock.calls.map(call => call[0])).toEqual(['nazar', 'ksenia']);
  expect(delegate.create).toHaveBeenCalledTimes(4); // two ledgers, two sections
  expect(delegate.updateMany).not.toHaveBeenCalled();
  expect(rows.size).toBe(4);
  // The same warm HTTP route is then read-only for this model.
  const warm = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());
  expect(warm.status).toBe(200);
  expect(get).toHaveBeenCalledTimes(2);
  expect(delegate.create).toHaveBeenCalledTimes(4);
  expect(delegate.updateMany).not.toHaveBeenCalled();
});

it('a failed cold strategy leaves its independently confirmed peer available', async () => {
  const { db, delegate, rows } = cloneTable();
  rows.delete(marketplaceSnapshotId('nazar'));
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const get = jest.spyOn(service, 'get').mockRejectedValue(new Error('fixture unavailable'));
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null });
  const server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());
    expect(response.status).toBe(200);
    expect(response.body.nazar).toBeNull();
    expect(response.body.errors).toEqual({ nazar: 'temporarily_unavailable' });
    expect(validStrategy(response.body.ksenia, 'VX-KSENIA')).toBe(true);
    expect(response.body.ksenia).toEqual(JSON.parse(JSON.stringify(yesterday.ksenia)));
    expect(get.mock.calls.map(call => call[0])).toEqual(['nazar']);
    expect(delegate.create).not.toHaveBeenCalled();
    expect(delegate.updateMany).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

it('the opt-in daily refresh has no idle polling and appends each strategy only once at 00:03 UTC', async () => {
  jest.useFakeTimers({ now: new Date('2026-09-27T12:00:00Z'), doNotFake: ['setImmediate', 'hrtime', 'performance'] });
  const { db, delegate, rows } = cloneTable();
  const now = () => new Date();
  const service = new CopyPerformanceService(db, now);
  const get = jest.spyOn(service, 'get');
  const snapshots = new MarketplaceSnapshots(db, service, { now, build: null, dailyRefresh: true });
  try {
    // No visitor, no timer or model reads. Repeated warm visits arm just one.
    expect(jest.getTimerCount()).toBe(0);
    expect(delegate.findUnique).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) await snapshots.section('nazar');
    expect(jest.getTimerCount()).toBe(1);
    expect(get).not.toHaveBeenCalled();
    const reads = delegate.findUnique.mock.calls.length;
    await jest.advanceTimersByTimeAsync(12 * 60 * 60_000 + DAILY_REFRESH_OFFSET_MS - 1);
    expect(delegate.findUnique).toHaveBeenCalledTimes(reads);
    expect(delegate.updateMany).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await (snapshots as any).queue;
    expect(get.mock.calls.map(call => call[0])).toEqual(['nazar', 'ksenia']);
    expect(delegate.updateMany).toHaveBeenCalledTimes(4); // each ledger and section
    for (const strategy of ['nazar', 'ksenia'] as const) {
      expect(decodeMarketplaceSnapshot(strategy, rows.get(marketplaceSnapshotId(strategy)).stateText)?.day).toBe('2026-09-28');
    }
    expect(jest.getTimerCount()).toBe(1); // next day only; no retry/poll loop
    snapshots.stop();
    await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(get).toHaveBeenCalledTimes(2);
    expect(delegate.updateMany).toHaveBeenCalledTimes(4);
  } finally {
    snapshots.stop();
    jest.useRealTimers();
  }
});

/** The replay is synchronous: on the 0.1-CPU container nothing else runs
 *  while it does. This stands in for it, holding the event loop. */
function blockingGet(ms: number, calls: { strategy: string; at: number }[]) {
  return async (strategy: PerformanceStrategy) => {
    calls.push({ strategy, at: Date.now() });
    const until = Date.now() + ms;
    while (Date.now() < until) { /* hold the CPU, as the replay does */ }
    return yesterday[strategy] as any;
  };
}

it('after a deploy, the confirmed section is sent before the heavy refresh takes the CPU', async () => {
  const { db } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const calls: { strategy: string; at: number }[] = [];
  jest.spyOn(service, 'get').mockImplementation(blockingGet(300, calls));
  // Stored by the previous build; this process has measured nothing yet.
  const snapshots = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: 'next-build' });
  // When the server finished handing the answer to the network. The client
  // here shares this process, so its own clock would include the replay.
  let sentAt = Infinity;
  const server = express()
    .use((_req, res, next) => { res.once('finish', () => { sentAt = Date.now(); }); next(); })
    .use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const response = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());
  expect(response.status).toBe(200);
  expect(response.body.errors).toEqual({});
  expect(JSON.stringify(response.body.nazar)).toBe(JSON.stringify(JSON.parse(JSON.stringify(yesterday.nazar))));
  expect(validStrategy(response.body.ksenia, 'VX-KSENIA')).toBe(true);
  // The build's own sections are still prepared — after the answer, in order.
  for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
  await (snapshots as any).queue;
  expect(calls.map(call => call.strategy)).toEqual(['nazar', 'ksenia']);
  expect(Number.isFinite(sentAt)).toBe(true);
  for (const call of calls) expect(call.at).toBeGreaterThanOrEqual(sentAt);
});

it('warm-up prepares only the sections this build does not have, one at a time', async () => {
  const { db, rows } = cloneTable();
  const service = new CopyPerformanceService(db, at('2026-09-27'));
  const calls: string[] = [];
  jest.spyOn(service, 'get').mockImplementation(async strategy => { calls.push(strategy); return yesterday[strategy] as any; });
  const current = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null });
  await current.warm();
  expect(calls).toEqual([]);
  const deployed = new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: 'next-build' });
  await deployed.warm();
  expect(calls).toEqual(['nazar', 'ksenia']);
  for (const strategy of ['nazar', 'ksenia'] as const) {
    expect(decodeMarketplaceSnapshot(strategy, rows.get(marketplaceSnapshotId(strategy)).stateText)?.build).toBe('next-build');
  }
  // The first visitor then reads this build's section with no further work.
  await deployed.section('nazar'); await deployed.section('ksenia');
  expect(calls).toEqual(['nazar', 'ksenia']);
});

it('warm-up is opt-in, runs once after start-up and never keeps the process alive', async () => {
  const warm = jest.spyOn(MarketplaceSnapshots.prototype, 'warm').mockResolvedValue();
  const unref = jest.fn();
  const timeout = jest.spyOn(global, 'setTimeout');
  try {
    const { db } = cloneTable();
    const service = new CopyPerformanceService(db, at('2026-09-27'));
    new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null });
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockImplementationOnce(((fn: () => void) => { fn(); return { unref } as any; }) as any);
    new MarketplaceSnapshots(db, service, { now: at('2026-09-27'), build: null, warmOnStartMs: 20_000 });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0][1]).toBe(20_000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
    warm.mockRestore();
  }
});
