import { CopyPerformanceService, type PerformanceStrategy } from '../CopyPerformanceService';
import { summarizeStrategy } from '../marketplaceSummary';
import { redactTradeHistory } from '../tradeHistoryVisibility';
import { withKseniaReportedTrade } from '../kseniaReportedTrade';
import { withKseniaReportedWeek } from '../kseniaReportedWeek';
import { DAILY_PROGRESSION_EFFECTIVE_FROM } from '../canonical/dailyProgression';

/**
 * ONE NEW CLOSED TRADE PER STRATEGY PER UTC DAY.
 *
 * The owner's rule is a cadence and these are its arithmetic. Every case
 * below reads the REAL service — the same object the marketplace route holds
 * — against a controllable clock and an in-memory scenario table, so what is
 * asserted is what the endpoint would serve on that date.
 *
 * Not 0: a quiet session used to emit no execution at all, leaving the newest
 * trade days behind the chart. Not 2: the generators used to add a second row
 * for a win-rate ratio. Exactly 1, every day, for both strategies.
 */

jest.setTimeout(900_000);

function scenarioTable() {
  const rows = new Map<string, any>();
  return { copyPerformanceScenario: {
    async findUnique({ where }: any) { const row = rows.get(where.id); return row ? { ...row } : null; },
    async create({ data }: any) {
      if (rows.has(data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      rows.set(data.id, { ...data, revision: 0 }); return { ...data };
    },
    async updateMany({ where, data }: any) {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, stateText: data.stateText, simulatedAt: data.simulatedAt,
        revision: row.revision + data.revision.increment });
      return { count: 1 };
    },
  } } as any;
}

/** A service whose clock the case moves, exactly as the calendar would. */
function clocked(start: string) {
  const clock = { now: start };
  return { clock, service: new CopyPerformanceService(scenarioTable(), () => new Date(clock.now)) };
}

const STRATEGIES: PerformanceStrategy[] = ['nazar', 'ksenia'];
/** The dates the owner named, all on or after the cadence date. */
const DAYS = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
const day = (iso: string) => iso.slice(0, 10);
const closedOn = (data: any, date: string) =>
  data.trades.filter((trade: any) => day(trade.closedAt) === date).length;
const latestClose = (data: any) =>
  data.trades.map((trade: any) => day(trade.closedAt)).sort().slice(-1)[0];

it('the cadence starts on a date, so no published day is rewritten', () => {
  // A flag would have restated a year of already-shown results. The rule is
  // a boundary instead: strictly before it, the generators are untouched.
  expect(DAILY_PROGRESSION_EFFECTIVE_FROM).toBe('2026-09-22');
  expect(DAYS.every(date => date >= DAILY_PROGRESSION_EFFECTIVE_FROM)).toBe(true);
});

describe.each(STRATEGIES)('%s', (strategy) => {
  it('adds exactly one closed trade on each new UTC day', async () => {
    const { clock, service } = clocked(`${DAYS[0]}T09:00:00Z`);
    let previousTotal: number | null = null;
    const roi7: number[] = [];
    for (const date of DAYS) {
      clock.now = `${date}T09:00:00Z`;
      const data: any = await service.get(strategy);

      // The day the owner is looking at holds one closed trade, and it is
      // the newest one in the book.
      expect(closedOn(data, date)).toBe(1);
      expect(latestClose(data)).toBe(date);
      // +1 against yesterday's total. The first iteration establishes it.
      if (previousTotal !== null) expect(data.trades.length - previousTotal).toBe(1);
      previousTotal = data.trades.length;

      // Everything the profile reads moves with it: the daily series, the
      // chart's own last point, and the rolling window's end.
      expect(day(data.simulation.simulatedAt)).toBe(date);
      expect(data.dailyResults[data.dailyResults.length - 1].date).toBe(date);
      expect(data.equityHistory[data.equityHistory.length - 1].date).toBe(date);
      expect(data.dailyResults[data.dailyResults.length - 1].numberOfTrades).toBe(1);
      roi7.push(data.economics.periods['7D'].roi);

      // No day is produced twice, and none is skipped.
      const dates = data.dailyResults.map((result: any) => result.date);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates[dates.length - 1] > dates[dates.length - 2]).toBe(true);
    }
    // A rolling 7D that ends on a new day every day is a different number
    // every day. A frozen window would repeat.
    expect(new Set(roi7).size).toBe(roi7.length);
  });

  it('a second request on the same day adds nothing at all', async () => {
    const { service } = clocked('2026-09-24T09:00:00Z');
    const first: any = await service.get(strategy);
    const repeats = await Promise.all(Array.from({ length: 5 }, () => service.get(strategy)));
    for (const again of repeats as any[]) {
      expect(again).toBe(first);                                 // the cached projection
      expect(again.trades.length).toBe(first.trades.length);
      expect(closedOn(again, '2026-09-24')).toBe(1);
    }
  });

  it('a later hour of the same day still adds nothing', async () => {
    const { clock, service } = clocked('2026-09-24T00:30:00Z');
    const morning: any = await service.get(strategy);
    clock.now = '2026-09-24T23:45:00Z';
    const night: any = await service.get(strategy);
    expect(night.trades.length).toBe(morning.trades.length);
    expect(day(night.simulation.simulatedAt)).toBe('2026-09-24');
  });

  it('three unrequested days are caught up as exactly three trades, one per day', async () => {
    // The owner's case: nobody opened Copy Trading for three days. The next
    // request must produce the missing calendar, not one lump and not none.
    const { clock, service } = clocked('2026-09-22T09:00:00Z');
    const before: any = await service.get(strategy);
    clock.now = '2026-09-25T09:00:00Z';
    const after: any = await service.get(strategy);

    expect(after.trades.length - before.trades.length).toBe(3);
    for (const date of ['2026-09-23', '2026-09-24', '2026-09-25']) expect(closedOn(after, date)).toBe(1);
    expect(latestClose(after)).toBe('2026-09-25');
    expect(day(after.simulation.simulatedAt)).toBe('2026-09-25');

    // The day it had already produced is byte-identical: catching up appends.
    const existing = after.dailyResults.find((result: any) => result.date === '2026-09-22');
    expect(existing).toEqual(before.dailyResults.find((result: any) => result.date === '2026-09-22'));
  });

  it('reaches the same ledger whether it caught up in one step or five', async () => {
    // Determinism is what makes the cadence a calendar rather than a counter:
    // a process that was up all week and one that just started must agree.
    const stepwise = clocked('2026-09-22T09:00:00Z');
    for (const date of DAYS) { stepwise.clock.now = `${date}T09:00:00Z`; await stepwise.service.get(strategy); }
    const stepwiseFinal: any = await stepwise.service.get(strategy);
    const oneShot: any = await clocked('2026-09-26T09:00:00Z').service.get(strategy);
    expect(oneShot.trades).toEqual(stepwiseFinal.trades);
    expect(oneShot.dailyResults).toEqual(stepwiseFinal.dailyResults);
  });

  it('every aggregate the UI shows is read off that same ledger', async () => {
    // Nothing is drawn by hand beside the trades: the counts, the PnL and the
    // win/loss split of the newest day are the newest day's one execution.
    const { service } = clocked('2026-09-26T09:00:00Z');
    const data: any = await service.get(strategy);
    const last = data.dailyResults[data.dailyResults.length - 1];
    const trade = data.trades.find((row: any) => day(row.closedAt) === last.date);
    expect(last.numberOfTrades).toBe(1);
    expect(last.wins + last.losses).toBe(1);
    expect(last.realizedPnl).toBeCloseTo(trade.netPnl, 4);
    expect(last.fees).toBeCloseTo(trade.fees, 4);
    expect(trade.netPnl).not.toBe(0);                     // a closed trade, never a placeholder
    expect(Number.isFinite(data.analytics.allTime.totalTrades)).toBe(true);
    expect(data.analytics.allTime.totalTrades).toBe(data.trades.length);
  });

  it('the public payload carries the aggregates and none of the executions', async () => {
    // The same chain the marketplace route runs, in the same order.
    const { service } = clocked('2026-09-26T09:00:00Z');
    const raw: any = await service.get(strategy);
    const summary = summarizeStrategy(raw) as any;
    const wire: any = redactTradeHistory(strategy === 'ksenia'
      ? withKseniaReportedWeek(withKseniaReportedTrade(summary)) : summary);

    expect(wire.trades).toEqual([]);
    expect(wire.tradeVisibility).toMatchObject({ mode: 'HIDDEN', reason: 'OWNER_RESTRICTED' });
    // Hidden is not zero: the counts still describe the whole ledger. Ksenia's
    // count is one higher than the engine's, because the owner-reported trade
    // of 2026-09-16 is folded into the aggregates before the rows are removed.
    const reported = strategy === 'ksenia' ? 1 : 0;
    expect(wire.tradeHistoryCount).toBe(raw.trades.length + reported);
    expect(wire.tradeStats.ALL.totalTrades).toBe(raw.trades.length + reported);
    // Every cadence day inside the rolling window contributes exactly one.
    // Days before the cadence date keep whatever the published history had,
    // which is the point of starting the rule on a date rather than a flag.
    for (const date of DAYS) expect(closedOn(raw, date)).toBe(1);
    expect(raw.trades.filter((trade: any) => day(trade.closedAt) >= DAYS[0]).length).toBe(DAYS.length);
    expect(wire.dailyResults[wire.dailyResults.length - 1].date).toBe('2026-09-26');
    expect(JSON.stringify(wire)).not.toContain('entryPrice');
  });
});
