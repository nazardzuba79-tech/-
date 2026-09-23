import { CopyPerformanceService, decodePerformanceState, encodePerformanceState, PERFORMANCE_SCENARIOS } from '../CopyPerformanceService';

/**
 * The stored state is written compressed and read in either form.
 *
 * Production (2026-09-23): the first Copy Trading request of the day rewrote
 * both 8 MB rows through Prisma, ~120 MB of native memory per write, inside a
 * 512 MB container shared with the market collector — the container was
 * killed, the append never persisted, and every visit repeated it. These
 * tests pin the storage contract that removes that: the row is small, the
 * JSON inside it is exactly what was stored before, and a legacy row still
 * written as plain JSON is read, advanced and rewritten compressed.
 */
jest.setTimeout(300_000);

function table(initial: Record<string, { stateText: string; simulatedAt: Date }> = {}) {
  const rows = new Map<string, any>(Object.entries(initial).map(([id, r]) => [id, { id, ...r, revision: 0 }]));
  return { rows, db: { copyPerformanceScenario: {
    async findUnique({ where }: any) { const row = rows.get(where.id); return row ? { ...row } : null; },
    async create({ data }: any) {
      if (rows.has(data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      rows.set(data.id, { ...data, revision: 0 }); return { ...data };
    },
    async updateMany({ where, data }: any) {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, stateText: data.stateText, simulatedAt: data.simulatedAt, revision: row.revision + data.revision.increment });
      return { count: 1 };
    },
  } } as any };
}

test('a stored row is compressed, and decodes to exactly the state that was written', async () => {
  const { rows, db } = table();
  await new CopyPerformanceService(db, () => new Date('2026-09-23T09:00:00Z')).get('nazar');
  const stored: string = rows.get(PERFORMANCE_SCENARIOS.nazar.id).stateText;
  const state = decodePerformanceState(stored);
  const plain = JSON.stringify(state);
  expect(stored.startsWith('gz1:')).toBe(true);
  expect(stored.length).toBeLessThan(plain.length / 4);
  expect(JSON.stringify(decodePerformanceState(encodePerformanceState(state)))).toBe(plain);
});

test('a legacy plain-JSON row is read as it is, advanced by a day, and rewritten compressed with the same history', async () => {
  const seed = table();
  await new CopyPerformanceService(seed.db, () => new Date('2026-09-22T12:00:00Z')).get('ksenia');
  const id = PERFORMANCE_SCENARIOS.ksenia.id;
  const legacyState = decodePerformanceState(seed.rows.get(id).stateText);
  const legacyText = JSON.stringify(legacyState);
  expect(legacyText.startsWith('{')).toBe(true);
  const { rows, db } = table({ [id]: { stateText: legacyText, simulatedAt: new Date(legacyState.simulatedAt) } });
  await new CopyPerformanceService(db, () => new Date('2026-09-23T09:00:00Z')).get('ksenia');
  const next = rows.get(id);
  expect(next.revision).toBe(1);
  expect(next.stateText.startsWith('gz1:')).toBe(true);
  const advanced = decodePerformanceState(next.stateText);
  expect(advanced.trades.length).toBeGreaterThan(legacyState.trades.length);
  expect(advanced.trades.slice(0, legacyState.trades.length)).toEqual(legacyState.trades);
});

test('a corrupted compressed row is refused, never regenerated', () => {
  expect(() => decodePerformanceState('gz1:not-gzip')).toThrow('refusing to regenerate history');
});
