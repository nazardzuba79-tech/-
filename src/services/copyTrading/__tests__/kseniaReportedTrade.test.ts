import { advanceKseniaReview, createKseniaReviewState, kseniaReviewResponse } from '../canonical/kseniaReview';
import { summarizeStrategy } from '../marketplaceSummary';
import { withKseniaReportedTrade } from '../kseniaReportedTrade';
import { validStrategy } from '../../../../frontend/src/lib/copyMarketplaceStore';

test('Ksenia owner-reported BTC short adds 7.8pp and 1754 USDT without inventing execution fields', () => {
  const state = advanceKseniaReview(createKseniaReviewState(), 10);
  const base: any = summarizeStrategy(kseniaReviewResponse(state));
  const before = JSON.parse(JSON.stringify(base));
  const result: any = withKseniaReportedTrade(base);

  expect(base).toEqual(before);
  expect(result.economics.periods['7D'].roi).toBe(Number((before.economics.periods['7D'].roi + 7.8).toFixed(4)));
  expect(result.economics.periods.ALL.masterPnl).toBe(Number((before.economics.periods.ALL.masterPnl + 1754).toFixed(4)));

  const beforeDay = before.dailyResults.find((day: any) => day.date === '2026-09-16');
  const afterDay = result.dailyResults.find((day: any) => day.date === '2026-09-16');
  expect(afterDay.dailyReturn).toBe(Number((beforeDay.dailyReturn + 0.078).toFixed(12)));
  expect(afterDay.realizedPnl).toBe(Number((beforeDay.realizedPnl + 1754).toFixed(4)));

  expect(result.tradeHistoryCount).toBe(before.tradeHistoryCount + 1);
  expect(result.tradeStats.ALL.totalTrades).toBe(before.tradeStats.ALL.totalTrades + 1);
  expect(result.tradeStats.ALL.winningTrades).toBe(before.tradeStats.ALL.winningTrades + 1);
  expect(result.tradeStats.ALL.holdingTimeTotalMinutes).toBeUndefined();

  const reported = result.trades.find((trade: any) => trade.id === 'KS-REPORTED-20260916-BTC');
  expect(reported).toMatchObject({
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
    expect(reported[key]).toBeUndefined();
  }
});

test('reported Ksenia trade stays in newest-first order after newer canonical trades exist', () => {
  // This is the production rollover that broke the entire Ksenia card on
  // 2026-09-17: the reported trade closes on the 16th, while the canonical
  // model now has a real row from the 17th. Prepending the older row made the
  // marketplace validator reject the whole strategy as out of order.
  const state = advanceKseniaReview(createKseniaReviewState(), 11);
  const base: any = summarizeStrategy(kseniaReviewResponse(state));
  expect(base.trades.some((trade: any) => String(trade.closedAt).startsWith('2026-09-17'))).toBe(true);

  const result: any = withKseniaReportedTrade(base);
  const times = result.trades.map((trade: any) => trade.id === 'KS-REPORTED-20260916-BTC'
    ? Date.parse('2026-09-16T23:59:59.999Z')
    : Date.parse(trade.closedAt));

  expect(times).toEqual([...times].sort((a, b) => b - a));
  expect(result.trades.some((trade: any) => trade.id === 'KS-REPORTED-20260916-BTC')).toBe(true);
  expect(result.trades).toHaveLength(10);
  // Pin the exact user-visible failure: this section must pass the same
  // network-boundary validator the marketplace uses, otherwise both the card
  // and opened profile fall back to skeleton/“Данные недоступны”.
  expect(validStrategy(result, 'VX-KSENIA')).toBe(true);
});
