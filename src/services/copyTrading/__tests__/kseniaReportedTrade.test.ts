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

/**
 * THE 16 SEP TRADE STILL MOVES ROI 7D ON 17 SEP.
 *
 * This is the owner's report, pinned literally: on 2026-09-17 the reported
 * trade is yesterday's, it is inside the rolling seven-day window, and a
 * newer canonical trade from the 17th already exists above it in the list.
 * None of that may remove its +7.8 percentage points from ROI 7D.
 */
test('on 2026-09-17 Ksenia ROI 7D still carries the 16 Sep +7.8pp beside a newer 17 Sep trade', () => {
  const base: any = summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11)));
  expect(base.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-17');
  // The premise: a canonical trade from the 17th is already present.
  expect(base.trades.some((trade: any) => String(trade.closedAt).startsWith('2026-09-17'))).toBe(true);

  const before = JSON.parse(JSON.stringify(base));
  const result: any = withKseniaReportedTrade(base);

  expect(result.economics.periods['7D'].roi)
    .toBe(Number((before.economics.periods['7D'].roi + 7.8).toFixed(4)));
  expect(result.analytics.roi7).toBe(result.economics.periods['7D'].roi);
  expect(result.economics.periods['7D'].masterPnl)
    .toBe(Number((before.economics.periods['7D'].masterPnl + 1754).toFixed(4)));
  expect(result.tradeStats['7D'].totalTrades).toBe(before.tradeStats['7D'].totalTrades + 1);
  expect(result.tradeStats['7D'].winningTrades).toBe(before.tradeStats['7D'].winningTrades + 1);
  // Counted exactly once.
  expect(withKseniaReportedTrade(result)).toBe(result);
  expect(validStrategy(result, 'VX-KSENIA')).toBe(true);
});

/**
 * THE CARD MUST SURVIVE THE ROW SCROLLING AWAY.
 *
 * The strategy closes a trade every few hours, so about a week after
 * 2026-09-16 the reported row is no longer one of the ten the table renders.
 * The server still deletes the holding-time aggregate for every period that
 * STILL COUNTS that trade, because its duration was never supplied — and the
 * validator used to accept that only while the row was visible. The two
 * drifting apart made the whole section invalid, which is how a live card
 * turns into a skeleton and ROI 7D "disappears".
 *
 * Measured on this fixture: the row is evicted from 2026-09-24, and before
 * this contract was fixed every date from then on failed validation.
 */
test('Ksenia stays valid after the reported row is pushed out of the visible ten', () => {
  const base: any = summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 18)));
  expect(base.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-24');

  const result: any = withKseniaReportedTrade(base);
  // The premise: the row really is gone from the display window...
  expect(result.trades.some((trade: any) => trade.id === 'KS-REPORTED-20260916-BTC')).toBe(false);
  // ...while periods that still contain it report an unknown holding time...
  expect(result.tradeStats.ALL.holdingTimeTotalMinutes).toBeUndefined();
  // ...and the payload declares the trade it is still counting.
  expect(result.reportedPerformance).toHaveLength(1);
  expect(result.reportedPerformance[0]).toMatchObject({
    id: 'KS-REPORTED-20260916-BTC', netPnl: 1754, returnPct: 7.8, closedOn: '2026-09-16',
  });
  for (const key of ['entryPrice','exitPrice','quantity','openedAt','closedAt','fees','funding']) {
    expect(result.reportedPerformance[0][key]).toBeNull();
  }

  // The section must remain usable, or the client drops Ksenia entirely.
  expect(validStrategy(result, 'VX-KSENIA')).toBe(true);
});

/** A payload that merely omits the aggregate, without declaring a reported
 *  trade, is still rejected — the relaxation must not become a hole. */
test('a missing holding-time aggregate without a declared reported trade is still invalid', () => {
  const base: any = summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 18)));
  const result: any = withKseniaReportedTrade(base);
  expect(validStrategy(result, 'VX-KSENIA')).toBe(true);

  const forged = JSON.parse(JSON.stringify(result));
  delete forged.reportedPerformance;
  expect(validStrategy(forged, 'VX-KSENIA')).toBe(false);

  const tampered = JSON.parse(JSON.stringify(result));
  tampered.reportedPerformance[0].netPnl = 99_999;
  expect(validStrategy(tampered, 'VX-KSENIA')).toBe(false);
});

/** The presence of a valid reportedPerformance declaration must not become a
 * blanket waiver for every period. On 2026-09-23 the 16 Sep trade has already
 * left the rolling 7D window, while it remains inside 30D/90D/ALL. Therefore
 * 7D holding time is knowable again and deleting it must invalidate the
 * payload even though the declaration is still present. */
test('reported trade only permits missing holding time in periods that still count it', () => {
  const base: any = summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 17)));
  expect(base.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-23');
  const result: any = withKseniaReportedTrade(base);
  expect(validStrategy(result, 'VX-KSENIA')).toBe(true);
  expect(result.reportedPerformance).toHaveLength(1);
  expect(result.tradeStats['7D'].holdingTimeTotalMinutes).toBeDefined();
  expect(result.tradeStats['30D'].holdingTimeTotalMinutes).toBeUndefined();

  const forged = JSON.parse(JSON.stringify(result));
  delete forged.tradeStats['7D'].holdingTimeTotalMinutes;
  expect(validStrategy(forged, 'VX-KSENIA')).toBe(false);
});
