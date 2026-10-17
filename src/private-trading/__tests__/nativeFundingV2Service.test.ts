import { setup, actor, key, outcome, M, H, H0 } from '../native/testing/liveFixture';
import { NATIVE_CURRENT_FUNDING, NativeFundingSchedule, scheduleWith } from '../native/fundingModel';
import { replayNativeDemoAsync } from '../native/replay';

/**
 * THE SERVICE PRICES EVERY REPLAY BY THE REPOSITORY'S SCHEDULE.
 *
 * The engine tests prove the arithmetic; this proves the wiring: the
 * schedule the repository pins is the one the account is replayed with (on
 * a refresh, on a checkpoint continuation and on a full replay alike), the
 * terminal is told the rates the next settlement uses, and a repository that
 * ships no schedule leaves every account on the original model.
 */
type Fixture = ReturnType<typeof setup> & { scheduleReads: () => number };
function fixture(schedule?: NativeFundingSchedule): Fixture {
  const f = setup({ at: H0 + 8 * H - M });
  let reads = 0;
  if (schedule) Object.assign(f.repo, { fundingSchedule: async () => { reads++; return schedule; } });
  return { ...f, scheduleReads: () => reads };
}
async function heldAcrossOneBoundary(f: Fixture, side: 'LONG' | 'SHORT' = 'LONG') {
  await f.service.initialize(actor, key());
  await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side, type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
  f.clock.t = H0 + 8 * H + 2 * M;
  return f.refresh();
}
const fundingOf = (f: Fixture) => f.repo.row!.snapshot.events.filter((e) => e.kind === 'FUNDING');

describe('the native service replays with the pinned funding schedule', () => {
  jest.setTimeout(60_000);

  test('V2 prices the boundary after its start: LONG 1 × 50 000 × −0.0001 = −5', async () => {
    const schedule = scheduleWith(NATIVE_CURRENT_FUNDING, H0 + 8 * H);
    const f = fixture(schedule);
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f)).toEqual([expect.objectContaining({ time: H0 + 8 * H, quantity: '1', price: '50000', cashflow: '-5', fundingRate: '-0.0001', fundingModel: 'VOLTEX_FIXED_V2' })]);
    const p = view.positions[0];
    expect(p.fundingNet).toBe('-5');
    expect(Number(p.tradingPnl) - Number(p.feesPaid) + Number(p.fundingNet)).toBeCloseTo(Number(p.netPnl), 10);
    expect(view.model.funding).toMatchObject({ longCashflow: '-0.0001', shortCashflow: '0.0004', version: 'VOLTEX_FIXED_V2' });
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

  test('a SHORT receives 1 × 50 000 × 0.0004 = +20 under V2', async () => {
    const f = fixture(scheduleWith(NATIVE_CURRENT_FUNDING, H0 + 8 * H));
    await heldAcrossOneBoundary(f, 'SHORT');
    expect(fundingOf(f).map((e) => [e.cashflow, e.fundingRate])).toEqual([['20', '0.0004']]);
  });

  test('before its start V1 still prices, and the terminal is told the next settlement is V2', async () => {
    const f = fixture(scheduleWith(NATIVE_CURRENT_FUNDING, H0 + 16 * H));
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f).map((e) => e.cashflow)).toEqual(['-50']); // −0.001 × 1 × 50 000
    expect(fundingOf(f)[0]).not.toHaveProperty('fundingRate');
    expect(view.model.fundingModel.current.version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(view.model.fundingModel.next).toMatchObject({ version: 'VOLTEX_FIXED_V2', settlesAt: H0 + 16 * H });
    expect(view.model.funding).toMatchObject({ longCashflow: '-0.0001', shortCashflow: '0.0004' });
  });

  test('a repository without a schedule keeps every account on the original model', async () => {
    const f = fixture();
    const view = await heldAcrossOneBoundary(f);
    expect(fundingOf(f).map((e) => e.cashflow)).toEqual(['-50']);
    expect(view.model.fundingModel.current.version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(view.model.funding).toMatchObject({ longCashflow: '-0.001', shortCashflow: '0.004' });
  });

  test('the schedule is read once per process, not once per request', async () => {
    const f = fixture(scheduleWith(NATIVE_CURRENT_FUNDING, H0 + 8 * H));
    await heldAcrossOneBoundary(f);
    await f.service.state(actor); await f.refresh();
    expect(f.scheduleReads()).toBe(1);
  });

  test('a schedule that cannot be read fails the request closed and is retried on the next one', async () => {
    const f = setup({ at: H0 + 8 * H - M });
    let fail = true;
    Object.assign(f.repo, { fundingSchedule: async () => { if (fail) throw new Error('db down'); return scheduleWith(NATIVE_CURRENT_FUNDING, H0 + 8 * H); } });
    await expect(f.service.initialize(actor, key())).rejects.toThrow('db down');
    expect(f.repo.row).toBeNull();
    fail = false;
    await f.service.initialize(actor, key());
    expect(f.repo.row).not.toBeNull();
  });
});
