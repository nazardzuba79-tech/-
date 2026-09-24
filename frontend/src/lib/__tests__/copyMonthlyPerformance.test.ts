import { buildMonthlyPerformance, monthlyPercent, periodDrawdown, periodReturn, type MonthlyPerformanceDay } from '../monthlyCopyPerformance';

/**
 * The month-by-month table's arithmetic, on hand-made histories whose
 * answers can be checked on paper. The same function is also checked
 * against the server's own monthly summaries for Nazar and Ksenia, over
 * real HTTP, in src/services/copyTrading/__tests__/monthlyCopyPerformanceContract.test.ts.
 */

const day = (date: string, dailyReturn: number, realizedPnl = 0, numberOfTrades = 1): MonthlyPerformanceDay =>
  ({ date, dailyReturn, realizedPnl, numberOfTrades });
const TWR = 'DAILY_TWR' as const;
const SIMPLE = 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN' as const;

describe('the return of a month', () => {
  it('compounds daily factors for DAILY_TWR — never the plain sum', () => {
    const table = buildMonthlyPerformance([day('2026-03-02', 0.10), day('2026-03-03', -0.05), day('2026-03-04', 0.02)], TWR);
    // (1.10 × 0.95 × 1.02) − 1 = 6.59%, where the sum would say 7.00%.
    expect(table.cells['2026-03'].roi).toBeCloseTo(6.59, 10);
    expect(table.cells['2026-03'].roi).not.toBeCloseTo(7, 2);
  });

  it('sums daily returns for the cash-flow-adjusted simple return, as the profile and the server do', () => {
    const table = buildMonthlyPerformance([day('2026-03-02', 0.10), day('2026-03-03', -0.05), day('2026-03-04', 0.02)], SIMPLE);
    expect(table.cells['2026-03'].roi).toBeCloseTo(7, 10);
    expect(periodReturn([0.10, -0.05, 0.02], SIMPLE)).toBeCloseTo(7, 10);
    expect(periodReturn([0.10, -0.05, 0.02], TWR)).toBeCloseTo(6.59, 10);
  });

  it('prints a positive month green, a negative month red, and a flat month as a neutral 0.00%', () => {
    const table = buildMonthlyPerformance([
      day('2026-01-10', 0.0604), day('2026-02-10', -0.0346), day('2026-03-10', 0), day('2026-03-11', 0),
    ], SIMPLE);
    expect(monthlyPercent(table.cells['2026-01'].roi)).toEqual({ text: '+6.04%', tone: 'positive' });
    expect(monthlyPercent(table.cells['2026-02'].roi)).toEqual({ text: '-3.46%', tone: 'negative' });
    // A month WITH history that returned nothing is a real 0.00% — not «—».
    expect(table.cells['2026-03'].roi).toBe(0);
    expect(monthlyPercent(table.cells['2026-03'].roi)).toEqual({ text: '0.00%', tone: 'neutral' });
  });

  it('never paints a figure that rounds to zero as a gain or a loss', () => {
    expect(monthlyPercent(-0.004)).toEqual({ text: '0.00%', tone: 'neutral' });
    expect(monthlyPercent(0.004)).toEqual({ text: '0.00%', tone: 'neutral' });
    expect(monthlyPercent(0.005)).toEqual({ text: '+0.01%', tone: 'positive' });
  });
});

describe('what the table covers', () => {
  it('marks the running month as partial and counts only the days that exist', () => {
    const table = buildMonthlyPerformance([day('2026-09-01', 0.01), day('2026-09-02', 0.02), day('2026-09-24', -0.005)], SIMPLE);
    const september = table.cells['2026-09'];
    expect(september.partial).toBe(true);
    expect(september.calendarDays).toBe(3);
    expect(september.roi).toBeCloseTo(2.5, 10);
    expect(september.lastDate).toBe('2026-09-24');
    expect(table.latestKey).toBe('2026-09');
  });

  it('a fully covered month is not partial', () => {
    const days = Array.from({ length: 28 }, (_, i) => day(`2026-02-${String(i + 1).padStart(2, '0')}`, 0.001));
    expect(buildMonthlyPerformance(days, SIMPLE).cells['2026-02'].partial).toBe(false);
  });

  it('puts 31 December and 1 January in different months AND different years', () => {
    const table = buildMonthlyPerformance([day('2025-12-31', 0.03), day('2026-01-01', -0.01)], SIMPLE);
    expect(table.years).toEqual([2025, 2026]);
    expect(table.cells['2025-12'].roi).toBeCloseTo(3, 10);
    expect(table.cells['2026-01'].roi).toBeCloseTo(-1, 10);
    expect(table.cells['2025'].roi).toBeCloseTo(3, 10);
    expect(table.cells['2026'].roi).toBeCloseTo(-1, 10);
    expect(table.cells['2025-12'].lastDate).toBe('2025-12-31');
    expect(table.cells['2026-01'].firstDate).toBe('2026-01-01');
  });

  it('leaves months with no history out entirely, so the screen prints «—» — including a whole year in a gap', () => {
    const table = buildMonthlyPerformance([day('2023-11-05', 0.01), day('2025-02-03', 0.02)], SIMPLE);
    expect(table.years).toEqual([2023, 2024, 2025]);
    expect(table.cells['2023-10']).toBeUndefined();
    expect(table.cells['2023-12']).toBeUndefined();
    expect(table.cells['2024']).toBeUndefined();
    expect(table.cells['2024-06']).toBeUndefined();
    expect(Object.keys(table.cells).sort()).toEqual(['2023', '2023-11', '2025', '2025-02']);
  });

  it('builds nothing from no history', () => {
    expect(buildMonthlyPerformance([], SIMPLE)).toEqual({ methodology: SIMPLE, years: [], cells: {}, latestKey: null });
    expect(buildMonthlyPerformance(undefined, undefined).years).toEqual([]);
  });

  it('sorts an out-of-order history before grouping, and ignores a malformed row', () => {
    const table = buildMonthlyPerformance([
      day('2026-05-03', 0.02), day('2026-05-01', 0.01), { date: '2026/05/02', dailyReturn: 0.5, realizedPnl: 0 },
      { date: '2026-05-04', dailyReturn: Number.NaN, realizedPnl: 0 },
    ], SIMPLE);
    expect(table.cells['2026-05'].calendarDays).toBe(2);
    expect(table.cells['2026-05'].firstDate).toBe('2026-05-01');
    expect(table.cells['2026-05'].roi).toBeCloseTo(3, 10);
  });
});

describe('the year’s total', () => {
  const year = [day('2026-01-15', 0.10), day('2026-02-15', 0.10), day('2026-03-15', -0.05)];

  it('compounds the year from its own days for TWR — not the sum of its months', () => {
    const table = buildMonthlyPerformance(year, TWR);
    const compounded = (1.10 * 1.10 * 0.95 - 1) * 100; // 14.95%
    expect(table.cells['2026'].roi).toBeCloseTo(compounded, 10);
    const summedMonths = ['2026-01', '2026-02', '2026-03'].reduce((total, key) => total + table.cells[key].roi, 0); // 15%
    expect(table.cells['2026'].roi).not.toBeCloseTo(summedMonths, 2);
  });

  it('sums the year from its own days for the simple return', () => {
    expect(buildMonthlyPerformance(year, SIMPLE).cells['2026'].roi).toBeCloseTo(15, 10);
  });

  it('carries the year’s realised PnL, days and trades', () => {
    const table = buildMonthlyPerformance([day('2026-01-15', 0.1, 120, 2), day('2026-02-15', -0.05, -40, 3), day('2026-02-16', 0, 0, 0)], SIMPLE);
    const total = table.cells['2026'];
    expect(total.realizedPnl).toBe(80);
    expect(total.trades).toBe(5);
    expect(total.tradingDays).toBe(2);
    expect(total.profitableDays).toBe(1);
    expect(total.losingDays).toBe(1);
    expect(total.calendarDays).toBe(3);
    expect(total.partial).toBe(true);
  });
});

describe('the month’s detail figures', () => {
  it('trading days are days with a trade; profitable and losing days follow the day’s return', () => {
    const table = buildMonthlyPerformance([
      day('2026-04-01', 0.02, 50, 2), day('2026-04-02', -0.01, -20, 1), day('2026-04-03', 0, 0, 0), day('2026-04-04', 0.01, 10, 1),
    ], SIMPLE);
    const april = table.cells['2026-04'];
    expect(april.tradingDays).toBe(3);
    expect(april.trades).toBe(4);
    expect(april.profitableDays).toBe(2);
    expect(april.losingDays).toBe(1);
    expect(april.realizedPnl).toBe(40);
  });

  it('takes the trade count from the server’s month when it has one, and never guesses one it cannot count', () => {
    const days = [day('2026-04-01', 0.02, 50, 2), day('2026-04-02', 0.01, 10, 1)];
    expect(buildMonthlyPerformance(days, SIMPLE, [{ period: '2026-04', trades: 4 }]).cells['2026-04'].trades).toBe(4);
    const older = [{ date: '2026-04-01', dailyReturn: 0.02, realizedPnl: 50 }];
    const unknown = buildMonthlyPerformance(older, SIMPLE).cells['2026-04'];
    expect(unknown.trades).toBeNull();
    expect(unknown.tradingDays).toBeNull();
    expect(buildMonthlyPerformance(older, SIMPLE).cells['2026'].trades).toBeNull();
  });

  it('maximum drawdown is the period’s own index from 100, additive for the simple return', () => {
    // 100 → 105 → 95 → 97: the fall from 105 to 95 is 9.5238%.
    expect(periodDrawdown([0.05, -0.10, 0.02], SIMPLE)).toBeCloseTo(10 / 105 * 100, 10);
    // Compounded: 100 → 105 → 94.5 → 96.39: from 105 to 94.5 is 10%.
    expect(periodDrawdown([0.05, -0.10, 0.02], TWR)).toBeCloseTo(10, 10);
    // A month that only rises has none; a first-day loss counts from the opening 100.
    expect(periodDrawdown([0.01, 0.02], SIMPLE)).toBe(0);
    expect(periodDrawdown([-0.03], SIMPLE)).toBeCloseTo(3, 10);
  });
});
