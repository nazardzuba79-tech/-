import type { SyntheticReturnMethodology } from './syntheticCopyTrading';

/**
 * MONTH-BY-MONTH RETURNS FOR A COPY TRADING STRATEGY — one pure function,
 * for every featured trader.
 *
 * The only input is the strategy's own `dailyResults`, which the marketplace
 * payload already carries in full (from inception, never windowed), plus the
 * server's `monthly` summary rows for the one figure the daily rows do not
 * hold faithfully (the trade count, see below). Nothing here fetches, reads a
 * clock, or invents a value: a month with no daily row has no cell, and the
 * screen prints «—» for it.
 *
 * The return of a month, and of a year, is computed from that period's own
 * daily returns with the strategy's methodology — the same rule the profile's
 * period analytics (`selectSyntheticPeriod`) and daily chart
 * (`dailyReturnChart`) use, and the server's `reviewPeriodReturn`:
 *   CASH_FLOW_ADJUSTED_SIMPLE_RETURN — the sum of daily returns (no
 *     reinvestment), so a year is the sum of its days;
 *   DAILY_TWR — the product of daily factors, (Π(1 + r)) − 1, so a year is
 *     compounded from its days, never the sum of twelve monthly figures.
 *
 * The drawdown follows the server's `reviewPerformanceDrawdown`: the period's
 * own performance index rebased to 100 (additive for the simple return,
 * compounded for TWR), worst fall from a running peak.
 */

export interface MonthlyPerformanceDay {
  date: string;
  dailyReturn: number;
  realizedPnl: number;
  /** On the wire for every day; absent only from an older payload. */
  numberOfTrades?: number;
}

export interface MonthlyPerformanceSummaryRow { period: string; trades: number }

export interface MonthlyPerformanceCell {
  /** `YYYY-MM` for a month, `YYYY` for a year's total. */
  key: string;
  year: number;
  /** 1–12, or null for the year's total. */
  month: number | null;
  /** Percent, e.g. 6.04 for +6.04%. */
  roi: number;
  realizedPnl: number;
  /** Days of the period the strategy has a daily row for. */
  calendarDays: number;
  /** Days with at least one trade (the server's `activeTradingDays` rule); null when unknown. */
  tradingDays: number | null;
  trades: number | null;
  profitableDays: number;
  losingDays: number;
  /** Percent, a positive number. */
  maximumDrawdown: number;
  firstDate: string;
  lastDate: string;
  /** The daily rows do not cover the whole calendar period (inception month, current month, current year). */
  partial: boolean;
}

export interface MonthlyPerformanceTable {
  methodology: SyntheticReturnMethodology;
  /** Every year from the first daily row to the last, in order. */
  years: number[];
  cells: Record<string, MonthlyPerformanceCell>;
  /** The latest month with data — what the detail panel opens on. */
  latestKey: string | null;
}

export const MONTH_NAMES_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function periodReturn(returns: number[], methodology: SyntheticReturnMethodology): number {
  return methodology === 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN'
    ? returns.reduce((total, value) => total + value, 0) * 100
    : (returns.reduce((factor, value) => factor * (1 + value), 1) - 1) * 100;
}

export function periodDrawdown(returns: number[], methodology: SyntheticReturnMethodology): number {
  let index = 100;
  let peak = 100;
  let maximum = 0;
  for (const value of returns) {
    index = methodology === 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN' ? index + value * 100 : index * (1 + value);
    peak = Math.max(peak, index);
    if (peak > 0) maximum = Math.max(maximum, (peak - index) / peak);
  }
  return maximum * 100;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysInYear(year: number) {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

function cell(key: string, year: number, month: number | null, days: MonthlyPerformanceDay[],
  methodology: SyntheticReturnMethodology, trades: number | null): MonthlyPerformanceCell {
  const returns = days.map(day => day.dailyReturn);
  const counted = days.every(day => Number.isFinite(day.numberOfTrades));
  const expected = month === null ? daysInYear(year) : daysInMonth(year, month);
  return {
    key, year, month,
    roi: periodReturn(returns, methodology),
    realizedPnl: days.reduce((total, day) => total + (Number.isFinite(day.realizedPnl) ? day.realizedPnl : 0), 0),
    calendarDays: days.length,
    tradingDays: counted ? days.filter(day => (day.numberOfTrades as number) > 0).length : null,
    trades,
    profitableDays: days.filter(day => day.dailyReturn > 0).length,
    losingDays: days.filter(day => day.dailyReturn < 0).length,
    maximumDrawdown: periodDrawdown(returns, methodology),
    firstDate: days[0].date,
    lastDate: days[days.length - 1].date,
    partial: days.length < expected,
  };
}

/**
 * The whole table for one strategy. `monthly` is the server's own per-month
 * summary; only its trade count is read, because it counts every closed
 * trade (Ksenia's reported trade included), which the per-day
 * `numberOfTrades` does not. Without it the count falls back to the daily
 * rows, and without those it is unknown (null), never guessed.
 */
export function buildMonthlyPerformance(
  dailyResults: readonly MonthlyPerformanceDay[] | null | undefined,
  methodology: SyntheticReturnMethodology | null | undefined,
  monthly?: readonly MonthlyPerformanceSummaryRow[] | null,
): MonthlyPerformanceTable {
  const method: SyntheticReturnMethodology = methodology ?? 'DAILY_TWR';
  const days = (dailyResults ?? [])
    .filter(day => day && typeof day.date === 'string' && DATE.test(day.date) && Number.isFinite(day.dailyReturn))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byMonth = new Map<string, MonthlyPerformanceDay[]>();
  const byYear = new Map<number, MonthlyPerformanceDay[]>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const year = Number(day.date.slice(0, 4));
    if (!byMonth.has(month)) byMonth.set(month, []);
    if (!byYear.has(year)) byYear.set(year, []);
    byMonth.get(month)!.push(day);
    byYear.get(year)!.push(day);
  }
  const reported = new Map((monthly ?? [])
    .filter(row => row && typeof row.period === 'string' && Number.isInteger(row.trades) && row.trades >= 0)
    .map(row => [row.period, row.trades]));

  const cells: Record<string, MonthlyPerformanceCell> = {};
  for (const [key, group] of byMonth) {
    const counted = group.every(day => Number.isFinite(day.numberOfTrades));
    const trades = reported.get(key) ?? (counted ? group.reduce((total, day) => total + (day.numberOfTrades as number), 0) : null);
    cells[key] = cell(key, Number(key.slice(0, 4)), Number(key.slice(5, 7)), group, method, trades);
  }
  for (const [year, group] of byYear) {
    const months = [...byMonth.keys()].filter(key => key.startsWith(`${year}-`));
    const known = months.every(key => cells[key].trades !== null);
    const trades = known ? months.reduce((total, key) => total + (cells[key].trades as number), 0) : null;
    cells[String(year)] = cell(String(year), year, null, group, method, trades);
  }

  const first = days.length ? Number(days[0].date.slice(0, 4)) : null;
  const last = days.length ? Number(days[days.length - 1].date.slice(0, 4)) : null;
  const years = first === null || last === null ? [] : Array.from({ length: last - first + 1 }, (_, index) => first + index);
  return { methodology: method, years, cells, latestKey: days.length ? days[days.length - 1].date.slice(0, 7) : null };
}

export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** «+6.04%», «-3.46%», «0.00%». The tone follows the figure as printed, so
 * a return that rounds to zero is never painted as a gain or a loss. */
export function monthlyPercent(value: number): { text: string; tone: 'positive' | 'negative' | 'neutral' } {
  if (!Number.isFinite(value)) return { text: '—', tone: 'neutral' };
  const rounded = Math.round(value * 100) / 100;
  if (rounded > 0) return { text: `+${rounded.toFixed(2)}%`, tone: 'positive' };
  if (rounded < 0) return { text: `${rounded.toFixed(2)}%`, tone: 'negative' };
  return { text: '0.00%', tone: 'neutral' };
}
