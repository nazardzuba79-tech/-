import { createHash } from 'crypto';
import { CopyPerformanceService, decodePerformanceState, encodePerformanceState, PERFORMANCE_SCENARIOS } from '../CopyPerformanceService';
import { createReviewSyntheticState } from '../canonical/reviewSyntheticHistory';
import { createKseniaReviewState, kseniaReviewResponse } from '../canonical/kseniaReview';
import { toResponse } from '../canonical/SyntheticCopyTradingEngine';
import { resolveStrategyOwner, KSENIA_EXTERNAL_OWNER_ID } from '../strategyOwner';
import { nazarPresentationResponse, NAZAR_PRESENTATION_REVISION } from '../nazarPresentation';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date('2026-09-06T12:00:00Z');
function database() {
  const rows = new Map<string, any>();
  const delegate = {
    findUnique: jest.fn(async ({ where }: any) => { const row = rows.get(where.id); return row ? { ...row } : null; }),
    create: jest.fn(async ({ data }: any) => {
      if (rows.has(data.id)) throw Object.assign(new Error('unique race'), { code: 'P2002' });
      const row = { ...data, revision: 0 }; rows.set(data.id, row); return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, ...data, revision: row.revision + 1 }); return { count: 1 };
    }),
  };
  return { db: { copyPerformanceScenario: delegate } as any, rows, delegate };
}

test('September6 storage stays byte-identical; only Nazar read response uses the explicit synthetic presentation revision', async () => {
  const { db, rows, delegate } = database();
  const service = new CopyPerformanceService(db, now);
  const nazar = await service.get('nazar');
  const ksenia = await service.get('ksenia');
  const persistedNazar = decodePerformanceState(rows.get(PERFORMANCE_SCENARIOS.nazar.id).stateText);
  expect(hash(toResponse(persistedNazar))).toBe('2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2');
  expect(nazar).toEqual(nazarPresentationResponse(persistedNazar));
  expect(nazar).toMatchObject({ provenance: 'MODELED', presentationRevision: NAZAR_PRESENTATION_REVISION });
  expect(hash(ksenia)).toBe('ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4');
  expect((ksenia as any).traderEarnings365).toBe(1_275_547);
  expect(nazar.trader.name).toBe('Nazar');
  expect(ksenia.trader.name).toBe('Ksenia');
  expect([...rows.keys()].sort()).toEqual(['ksenia-performance-v1', 'nazar-performance-v8']);
  const restarted = new CopyPerformanceService(db, now);
  expect(hash(await restarted.get('nazar'))).toBe(hash(nazar));
  expect(hash(await restarted.get('ksenia'))).toBe(hash(ksenia));
  expect(delegate.updateMany).not.toHaveBeenCalled();
  for (const row of rows.values()) expect(encodePerformanceState(decodePerformanceState(row.stateText))).toBe(row.stateText);
});

test('canonical bootstrap remains the reviewed fixed model, never old main initialization', () => {
  expect(hash(toResponse(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')))))
    .toBe('5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2');
  expect(hash(kseniaReviewResponse(createKseniaReviewState())))
    // Original generator before review's historical JSONB transport rounded
    // sub-machine numeric tails. Published persistence is checked separately.
    .toBe('5a8b19f7004bf6563d3c6ed0c7b463b0c9847d3f4744cb0da7b7be53339c6e31');
});

test.each(['nazar', 'ksenia'] as const)('%s persists append-only after restart, serializes precise money, and cannot roll back time', async strategy => {
  const { db, rows, delegate } = database();
  let date = now();
  await new CopyPerformanceService(db, () => date).get(strategy);
  const id = PERFORMANCE_SCENARIOS[strategy].id;
  const original = decodePerformanceState(rows.get(id).stateText);
  date = new Date('2026-12-05T12:00:00Z'); // +90days
  const response = await new CopyPerformanceService(db, () => date).get(strategy);
  const next = decodePerformanceState(rows.get(id).stateText);
  expect(next.trades.slice(0, original.trades.length)).toEqual(original.trades);
  expect(next.dailyResults.slice(0, original.dailyResults.length)).toEqual(original.dailyResults);
  expect(next.equityHistory.slice(0, original.equityHistory.length)).toEqual(original.equityHistory);
  for (const field of ['trades', 'dailyResults', 'equityHistory', 'aumHistory'] as const) {
    expect(JSON.stringify(next[field].slice(0, original[field].length))).toBe(JSON.stringify(original[field]));
  }
  for (const field of ['masterDays', 'masterCashFlows', 'copiedTrades', 'performanceFeeEvents', 'followerAllocationEvents'] as const) {
    expect(JSON.stringify(next.cashflow[field].slice(0, original.cashflow[field].length))).toBe(JSON.stringify(original.cashflow[field]));
  }
  expect(next.cashflow.copiedTrades.slice(0, original.cashflow.copiedTrades.length)).toEqual(original.cashflow.copiedTrades);
  expect(next.cashflow.performanceFeeEvents.slice(0, original.cashflow.performanceFeeEvents.length)).toEqual(original.cashflow.performanceFeeEvents);
  expect(next.dailyResults).toHaveLength(original.dailyResults.length + 90);
  expect(next.trades.length).toBeGreaterThan(original.trades.length);
  const serialized = rows.get(id).stateText;
  date = now();
  expect(hash(await new CopyPerformanceService(db, () => date).get(strategy))).toBe(hash(response));
  expect(rows.get(id).stateText).toBe(serialized);
  expect(delegate.updateMany).toHaveBeenCalledTimes(1);
});

test('independent instances race safely on first creation and on append; no stale overwrite', async () => {
  const { db, rows, delegate } = database();
  await Promise.all([new CopyPerformanceService(db, now).get('nazar'), new CopyPerformanceService(db, now).get('nazar')]);
  expect(rows.size).toBe(1);
  expect(delegate.create).toHaveBeenCalledTimes(2);
  const later = () => new Date('2026-09-13T12:00:00Z');
  const responses = await Promise.all([new CopyPerformanceService(db, later).get('nazar'), new CopyPerformanceService(db, later).get('nazar')]);
  expect(hash(responses[0])).toBe(hash(responses[1]));
  expect(rows.get(PERFORMANCE_SCENARIOS.nazar.id).revision).toBe(1);
  expect(delegate.updateMany).toHaveBeenCalledTimes(2);
});

test('invalid persisted history fails closed and is never replaced', async () => {
  const { db, rows, delegate } = database();
  rows.set(PERFORMANCE_SCENARIOS.nazar.id, { stateText: '{"version":3}', revision: 1, simulatedAt: now() });
  await expect(new CopyPerformanceService(db, now).get('nazar')).rejects.toThrow('refusing to regenerate');
  expect(delegate.create).not.toHaveBeenCalled();
  expect(delegate.updateMany).not.toHaveBeenCalled();
});

test('stable same-environment identity exposes only allowed fields and dynamically follows avatar/KYC changes', async () => {
  const db: any = { copyStrategyOwner: { findUnique: jest.fn().mockResolvedValue({ publicName: 'Ksenia', ownerUserId: KSENIA_EXTERNAL_OWNER_ID, premium: true }) },
    user: { findUnique: jest.fn().mockResolvedValue({ avatarUrl: 'data:image/png;base64,YWJj', kycStatus: 'NOT_STARTED', email: 'private', id: 'private' }) } };
  const first = await resolveStrategyOwner(db, 'VX-KSENIA');
  expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: KSENIA_EXTERNAL_OWNER_ID }, select: { avatarUrl: true, kycStatus: true } });
  expect(Object.keys(first!).sort()).toEqual(['traderId', 'displayName', 'avatarUrl', 'avatarVersion', 'verified', 'premium'].sort());
  expect(first).toMatchObject({ displayName: 'Ksenia', verified: false });
  db.user.findUnique.mockResolvedValue({ avatarUrl: 'data:image/png;base64,ZGVm', kycStatus: 'APPROVED' });
  const next = await resolveStrategyOwner(db, 'VX-KSENIA');
  expect(next!.avatarVersion).not.toBe(first!.avatarVersion);
  expect(next!.verified).toBe(true);
  db.user.findUnique.mockResolvedValue({ avatarUrl: 'https://untrusted.test/photo.svg', kycStatus: 'NOT_STARTED' });
  expect(await resolveStrategyOwner(db, 'VX-KSENIA')).toMatchObject({ avatarUrl: null, verified: false });
  db.copyStrategyOwner.findUnique.mockResolvedValue({ publicName: 'Nazar', premium: true, ownerUserId: null });
  const calls = db.user.findUnique.mock.calls.length;
  expect(await resolveStrategyOwner(db, 'VX-001')).toMatchObject({ displayName: 'Nazar', avatarUrl: null, verified: false });
  expect(db.user.findUnique).toHaveBeenCalledTimes(calls);
  expect(await resolveStrategyOwner(db, 'arbitrary-user')).toBeNull();
});
