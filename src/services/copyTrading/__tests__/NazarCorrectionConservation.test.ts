import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createSimpleReturnMasterState, advanceSimpleReturnMasterState } from '../reviewPerformanceV8';
import { toResponse } from '../SyntheticCopyTradingEngine';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';

const reference = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/approvedV8Baseline.json'), 'utf8')) as {
  source: string; days: { date: string; return: number; pnl: number }[];
};
const baseline = createSimpleReturnMasterState();
const week = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test('every original weekly and nested anchor budget survives local loss correction', () => {
  expect(reference.source).toBe('a918ba6c7c21e01f93a4d7b86b6ebb07844d3796');
  expect(reference.days.map(day => day.date)).toEqual(baseline.dailyResults.map(day => day.date));
  for (const start of new Set(reference.days.map(day => week(day.date)))) {
    const before = sum(reference.days.filter(day => week(day.date) === start).map(day => day.return));
    const after = sum(baseline.dailyResults.filter(day => week(day.date) === start).map(day => day.dailyReturn));
    expect(after).toBeCloseTo(before, 7);
  }
  for (const [from, to] of [[0, 380], [290, 380], [350, 380], [366, 373], [373, 380]]) {
    expect(sum(baseline.dailyResults.slice(from, to).map(day => day.dailyReturn)))
      // Two independent 0.0001-USDT roundings across 380 days: <0.00001pp.
      .toBeCloseTo(sum(reference.days.slice(from, to).map(day => day.return)), 6);
  }
  expect(Math.round(sum(baseline.dailyResults.map(day => day.realizedPnl)) * 10000))
    .toBe(Math.round(sum(reference.days.map(day => day.pnl)) * 10000));
});

test('yellow ALL curve changes only inside corrected local regimes; no new terminal spike', () => {
  let before = 0, after = 0;
  const deviations = baseline.dailyResults.map((day, i) => {
    before += reference.days[i].return * 100;
    after += day.dailyReturn * 100;
    return Math.abs(before - after);
  });
  // Under 1.5 px on the unchanged 270px ALL plot spanning >3727 percentage
  // points. Week endpoints are independently reconciled above.
  expect(Math.max(...deviations) / 3727 * 270).toBeLessThan(1.5);
  expect(baseline.dailyResults.at(-1)!.dailyReturn).toBeLessThanOrEqual(reference.days.at(-1)!.return + 1e-7);
  expect(Math.min(...reference.days.map(day => day.return))).toBeCloseTo(-.30, 7);
  expect(Math.min(...baseline.dailyResults.map(day => day.dailyReturn))).toBeGreaterThan(-.05);
});

test('future win rate is ledger-derived, varies naturally and remains centered near 92.7%', () => {
  const displayed = new Set<string>();
  const advance = (state: typeof baseline, days: number): typeof baseline => days > 365
    ? advanceSimpleReturnMasterState(advanceSimpleReturnMasterState(state, 365), days - 365)
    : advanceSimpleReturnMasterState(state, days);
  for (const days of [1, 7, 30, 90, 365, 400]) {
    const after = advance(baseline, days);
    const wins = after.trades.filter(trade => trade.netPnl > 0).length;
    const losses = after.trades.filter(trade => trade.netPnl < 0).length;
    const rate = wins / (wins + losses) * 100;
    const ui = selectSyntheticPeriod(toResponse(after), 'ALL');
    expect(ui.winRate).toBe(rate);
    expect(rate).toBeGreaterThan(91.8);
    expect(rate).toBeLessThan(93.2);
    displayed.add(rate.toFixed(1));
    expect(after.trades.slice(0, 471)).toEqual(baseline.trades);
    expect(after.dailyResults.slice(0, 380)).toEqual(baseline.dailyResults);
    const split = advance(JSON.parse(JSON.stringify(advanceSimpleReturnMasterState(baseline, 1))), days - 1);
    expect(split).toEqual(after);
  }
  expect(displayed.size).toBeGreaterThan(1);
});
