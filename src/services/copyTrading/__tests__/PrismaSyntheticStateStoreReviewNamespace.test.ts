import type { PrismaClient } from '@prisma/client';
import { PrismaSyntheticStateStore } from '../PrismaSyntheticStateStore';
import { createInitialState } from '../SyntheticCopyTradingEngine';
import { SyntheticCopyTradingService } from '../SyntheticCopyTradingService';
import { SYNTHETIC_COPY_CONFIG } from '../syntheticConfig';
import type { SyntheticCopyState } from '../types';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const LEGACY_ID = 'nazara-v1';
const REVIEW_ID = 'nazara-review-v6';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface StoredRow {
  id: string;
  seed: number;
  simulatedAt: string;
  mode: SyntheticCopyState['mode'];
  state: SyntheticCopyState;
}

// A test-only legacy record with 93 persisted sessions. Its contents are
// deliberately retained byte-for-byte; this is not a migration of real data.
function legacy93DayState(): SyntheticCopyState {
  const generated = createInitialState(NOW);
  const equityHistory = generated.equityHistory.slice(-94);
  const initialEquityDate = equityHistory[0].date;
  return {
    ...generated,
    version: 1,
    mode: 'FAST_FORWARD',
    initialEquityDate,
    trades: generated.trades.filter(trade => trade.closedAt.slice(0, 10) > initialEquityDate),
    dailyResults: generated.dailyResults.slice(-93),
    equityHistory,
    aumHistory: generated.aumHistory.slice(-94),
  };
}

function prismaFixture() {
  const state = legacy93DayState();
  const rows = new Map<string, StoredRow>([[LEGACY_ID, {
    id: LEGACY_ID, seed: state.seed, simulatedAt: state.simulatedAt, mode: state.mode, state: clone(state),
  }]]);
  const legacyBytes = JSON.stringify(rows.get(LEGACY_ID));
  const accessedModels: string[] = [];
  type WriteData = Omit<StoredRow, 'id' | 'simulatedAt'> & { simulatedAt: Date };
  const findUnique = jest.fn(async ({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id);
    return row ? clone(row) : null;
  });
  const upsert = jest.fn(async ({ where, create, update }: {
    where: { id: string };
    create: WriteData & { id: string };
    update: WriteData;
  }) => {
    expect(create.id).toBe(where.id);
    const values = rows.has(where.id) ? update : create;
    const row: StoredRow = {
      id: where.id,
      seed: values.seed,
      simulatedAt: values.simulatedAt.toISOString(),
      mode: values.mode,
      state: clone(values.state),
    };
    rows.set(where.id, row);
    return clone(row);
  });
  const model = new Proxy({ findUnique, upsert }, {
    get(target, property) {
      if (property !== 'findUnique' && property !== 'upsert') {
        throw new Error(`Unexpected synthetic table operation: ${String(property)}`);
      }
      return target[property];
    },
  });
  const prisma = new Proxy({}, {
    get(_target, property) {
      accessedModels.push(String(property));
      if (property !== 'syntheticCopyTradingState') {
        throw new Error(`Unexpected real Prisma model access: ${String(property)}`);
      }
      return model;
    },
  }) as PrismaClient;
  const assertArchived = () => {
    expect(JSON.stringify(rows.get(LEGACY_ID))).toBe(legacyBytes);
    expect(rows.get(LEGACY_ID)!.state.version).toBe(1);
    expect(rows.get(LEGACY_ID)!.state.dailyResults).toHaveLength(93);
    expect(accessedModels.every(name => name === 'syntheticCopyTradingState')).toBe(true);
  };
  return { prisma, rows, state, findUnique, upsert, accessedModels, assertArchived };
}

describe('explicit review-only synthetic state version namespace', () => {
  test('omitting the review option retains the existing legacy storage contract', async () => {
    const fixture = prismaFixture();
    const store = new PrismaSyntheticStateStore(fixture.prisma);
    expect(await store.load()).toEqual(fixture.state);
    expect(fixture.findUnique).toHaveBeenCalledWith({ where: { id: LEGACY_ID } });
    await store.save(fixture.state);
    expect(fixture.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: LEGACY_ID } }));
    expect([...fixture.rows.keys()]).toEqual([LEGACY_ID]);
    fixture.assertArchived();
  });

  test('the new review version never falls back to an existing 93-day v1 row', async () => {
    const fixture = prismaFixture();
    const store = new PrismaSyntheticStateStore(fixture.prisma, { scope: 'review' });
    expect(SYNTHETIC_COPY_CONFIG.stateId).toBe(LEGACY_ID);
    expect(SYNTHETIC_COPY_CONFIG.stateVersion).toBe(6);
    expect(await store.load()).toBeNull();
    expect(fixture.findUnique).toHaveBeenCalledTimes(1);
    expect(fixture.findUnique).toHaveBeenCalledWith({ where: { id: REVIEW_ID } });
    expect(fixture.upsert).not.toHaveBeenCalled();
    fixture.assertArchived();
  });

  test('service initialization creates the complete v6 review history without migrating or deleting legacy data', async () => {
    const fixture = prismaFixture();
    const store = new PrismaSyntheticStateStore(fixture.prisma, { scope: 'review' });
    const service = new SyntheticCopyTradingService(store, () => NOW);
    const response = await service.get();
    const stored = fixture.rows.get(REVIEW_ID)!.state;
    expect(stored.version).toBe(6);
    expect(stored).toEqual(createInitialState(NOW));
    expect(response.dailyResults).toHaveLength(stored.dailyResults.length);
    expect(stored.dailyResults.length).toBeGreaterThan(93);
    expect(stored.initialEquityDate < fixture.state.initialEquityDate).toBe(true);
    expect([...fixture.rows.keys()].sort()).toEqual([REVIEW_ID, LEGACY_ID].sort());
    expect(fixture.upsert).toHaveBeenCalledTimes(1);
    expect(fixture.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: REVIEW_ID } }));
    fixture.assertArchived();
  });

  test('same-version reload retains progress and the complete equity prefix instead of reinitializing', async () => {
    const fixture = prismaFixture();
    const service = new SyntheticCopyTradingService(
      new PrismaSyntheticStateStore(fixture.prisma, { scope: 'review' }), () => NOW,
    );
    const initial = await service.get();
    const advanced = await service.advance(7);
    const writeCount = fixture.upsert.mock.calls.length;
    const storedBytes = JSON.stringify(fixture.rows.get(REVIEW_ID));
    const restarted = new SyntheticCopyTradingService(
      new PrismaSyntheticStateStore(fixture.prisma, { scope: 'review' }), () => NOW,
    );
    expect(await restarted.get()).toEqual(advanced);
    expect(fixture.upsert).toHaveBeenCalledTimes(writeCount);
    expect(JSON.stringify(fixture.rows.get(REVIEW_ID))).toBe(storedBytes);
    expect(advanced.dailyResults).toHaveLength(initial.dailyResults.length + 7);
    expect(advanced.equityHistory.slice(0, initial.equityHistory.length)).toEqual(initial.equityHistory);
    expect(fixture.rows.get(REVIEW_ID)!.state.version).toBe(6);
    fixture.assertArchived();
  });

  test('an explicit review reset only updates that review-version row', async () => {
    const fixture = prismaFixture();
    const service = new SyntheticCopyTradingService(
      new PrismaSyntheticStateStore(fixture.prisma, { scope: 'review' }), () => NOW,
    );
    const initial = await service.get();
    await service.advance(1);
    expect(await service.reset()).toEqual(initial);
    expect(fixture.upsert.mock.calls.every(([args]) => args.where.id === REVIEW_ID)).toBe(true);
    expect(fixture.findUnique.mock.calls.every(([args]) => args.where.id === REVIEW_ID)).toBe(true);
    expect([...fixture.rows.keys()].sort()).toEqual([REVIEW_ID, LEGACY_ID].sort());
    fixture.assertArchived();
  });

  test('unsupported scope values fail before any Prisma access rather than silently using legacy storage', () => {
    const fixture = prismaFixture();
    expect(() => new PrismaSyntheticStateStore(fixture.prisma, { scope: 'production' } as never))
      .toThrow('Unsupported synthetic state scope');
    expect(fixture.accessedModels).toEqual([]);
    fixture.assertArchived();
  });
});
