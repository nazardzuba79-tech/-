import { setup, actor, key, outcome, M, H, H0 } from '../native/testing/liveFixture';
import { NativeFundingSchedule, scheduleWithFixedRate } from '../native/fundingModel';
import { replayNativeDemoAsync } from '../native/replay';

/**
 * THE SERVICE PRICES EVERY REPLAY BY THE REPOSITORY'S SCHEDULE.
 *
 * The engine tests prove the arithmetic; this proves the wiring: the
 * schedule the repository pins is the one the account is replayed with (on
 * a refresh, on a checkpoint continuation and on a full replay alike), the
 * terminal is told which version is in force, and a repository that ships
 * no schedule leaves every account on the legacy model.
 */
type Fixture = ReturnType<typeof setup> & { scheduleReads: () => number };
function fixture(schedule?: NativeFundingSchedule): Fixture {
  const f = setup({ at: H0 + 8 * H - M });
  let reads = 0;
  if (schedule) Object.assign(f.repo, { fundingSchedule: async () => { reads++; return schedule; } });
  return { ...f, scheduleReads: () => reads };
}
async function heldAcrossOneBoundary(f: Fixture) {
  await f.service.initialize(actor, key());
  await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
  f.clock.t = H0 + 8 * H + 2 * M;
  return f.refresh();
}
const fundingOf = (f: Fixture) => f.repo.row!.snapshot.events.filter((e) => e.kind === 'FUNDING');

describe('the native service replays with the pinned funding schedule', () => {
  jest.setTimeout(60_000);

  test('a pinned fixed rate prices the boundary after its start: 1 x 50 000 x 0.0001 = 5', async () => {
    const schedule = scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', H0 + 8 * H);
    const f = fixture(schedule);
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f)).toEqual([expect.objectContaining({ time: H0 + 8 * H, quantity: '1', price: '50000', cashflow: '-5', fundingRate: '0.0001', fundingModel: 'TEST_FIXED_V1' })]);
    const p = view.positions[0];
    expect(p.fundingNet).toBe('-5');
    expect(Number(p.tradingPnl) - Number(p.feesPaid) + Number(p.fundingNet)).toBeCloseTo(Number(p.netPnl), 10);
    expect(view.model.fundingModel.active).toMatchObject({ version: 'TEST_FIXED_V1', kind: 'FIXED_RATE', rate: '0.0001' });
    // Another instance replaying the stored journal with the same schedule reaches the same account.
    const row = f.repo.row!;
    for (const checkpoint of [undefined, row.checkpoint]) {
      const again = await replayNativeDemoAsync({ deposit: row.deposit, instructions: row.commands, asOf: f.clock.now(), checkpoint, funding: schedule }, f.bars);
      expect(outcome(again.snapshot)).toEqual(outcome(row.snapshot));
    }
    // A second refresh at the same time pays nothing more.
    await f.refresh();
    expect(fundingOf(f)).toHaveLength(1);
  });

  test('before its start the legacy model still prices, and the view names the upcoming version', async () => {
    const f = fixture(scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', H0 + 16 * H));
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f).map((e) => e.cashflow)).toEqual(['-50']); // -0.001 x 1 x 50 000
    expect(fundingOf(f)[0]).not.toHaveProperty('fundingRate');
    expect(view.model.fundingModel.active.version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(view.model.fundingModel.upcoming).toMatchObject({ version: 'TEST_FIXED_V1', effectiveFrom: H0 + 16 * H });
  });

  test('a repository without a schedule keeps every account on the legacy model', async () => {
    const f = fixture();
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f).map((e) => e.cashflow)).toEqual(['-50']);
    expect(view.model.fundingModel.active.version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(view.model.fundingModel.upcoming).toBeNull();
  });

  test('the schedule is read once per process, not once per request', async () => {
    const f = fixture(scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', H0 + 8 * H));
    await heldAcrossOneBoundary(f);
    await f.service.state(actor); await f.refresh();
    expect(f.scheduleReads()).toBe(1);
  });

  test('a schedule that cannot be read fails the request closed and is retried on the next one', async () => {
    const f = setup({ at: H0 + 8 * H - M });
    let fail = true;
    Object.assign(f.repo, { fundingSchedule: async () => { if (fail) throw new Error('db down'); return scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', H0 + 8 * H); } });
    await expect(f.service.initialize(actor, key())).rejects.toThrow('db down');
    expect(f.repo.row).toBeNull();
    fail = false;
    await f.service.initialize(actor, key());
    expect(f.repo.row).not.toBeNull();
  });
});
