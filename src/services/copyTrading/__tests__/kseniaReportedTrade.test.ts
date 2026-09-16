import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse } from '../canonical/kseniaReview';
import { summarizeStrategy } from '../marketplaceSummary';
import { withKseniaReportedTrade } from '../kseniaReportedTrade';

test('Ksenia owner-reported BTC short adds 7.8pp and 1754 USDT without inventing execution fields', () => {
  const state = advanceKseniaReview(createKseniaReviewState(), 10);
  const base: any = summarizeStrategy(kseniaReviewResponse(state));
  const before = JSON.parse(JSON.stringify(base));
  const result: any = withKseniaReportedTrade(base);

  expect(base).toEqual(before);
  expect(result.economics.periods['7D'].roi).toBeCloseTo(before.economics.periods['7D'].roi + 7.8, 8);
  expect(result.economics.periods.ALL.masterPnl).toBeCloseTo(before.economics.periods.ALL.masterPnl + 1754, 8);

  const beforeDay = before.dailyResults.find((day: any) => day.date === '2026-09-16');
  const afterDay = result.dailyResults.find((day: any) => day.date === '2026-09-16');
  expect(afterDay.dailyReturn).toBeCloseTo(beforeDay.dailyReturn + 0.078, 10);
  expect(afterDay.realizedPnl).toBeCloseTo(beforeDay.realizedPnl + 1754, 8);

  expect(result.tradeHistoryCount).toBe(before.tradeHistoryCount + 1);
  expect(result.tradeStats.ALL.totalTrades).toBe(before.tradeStats.ALL.totalTrades + 1);
  expect(result.tradeStats.ALL.winningTrades).toBe(before.tradeStats.ALL.winningTrades + 1);
  expect(result.tradeStats.ALL.holdingTimeTotalMinutes).toBeUndefined();

  expect(result.trades[0]).toMatchObject({
    id: 'KS-REPORTED-20260916-BTC',
    symbol: 'BTCUSDT · 10x',
    marketSymbol: 'BTCUSDT',
    side: 'SHORT',
    leverage: 10,
    netPnl: 1754,
    returnPct: 7.8,
    source: 'OWNER_REPORTED',
    openedOn: '2026-09-15',
    closedOn: '2026-09-16',
  });
  for (const key of ['entryPrice','exitPrice','quantity','holdingTimeMinutes','grossPnl','fees','funding','riskR']) {
    expect(result.trades[0][key]).toBeUndefined();
  }
});
