import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService, type PerformanceStrategy } from '../CopyPerformanceService';
import { MarketplaceSnapshots, decodeMarketplaceSnapshot, encodeMarketplaceSnapshot, marketplaceSection,
  marketplaceSnapshotId } from '../marketplaceSnapshot';
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
