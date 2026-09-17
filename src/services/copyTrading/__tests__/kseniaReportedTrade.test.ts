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

/**
 * ROI · 7D IS A ROLLING WINDOW, AND A DROP IS NOT A LOST TRADE.
 *
 * Reported from production: "ROI 7D was ~51% yesterday and is +41.9% today,
 * even though yesterday's trade counts and today already has one."
 *
 * Both figures are right. The window is the last seven days, so rolling from
 * the 16th to the 17th drops 2026-09-10 (+11.343%) out of it and brings
 * 2026-09-17 (+2.344%) in — a net −8.999pp that has nothing to do with the
 * owner-reported trade, which is still fully inside the window on the 17th.
 *
 * This is pinned because the obvious "fix" — making the number stop falling —
 * would mean inventing a figure, and because the next person to look at a
 * ~9pp overnight drop deserves to find the arithmetic written down.
 */
test('ROI 7D falls between 16 and 17 Sep because a day rolls OUT, not because the trade left', () => {
  const addDays = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const windowOf = (data: any) => {
    const end = data.simulation.simulatedAt.slice(0, 10);
    const cutoff = addDays(end, -7);
    return data.dailyResults.filter((row: any) => row.date > cutoff && row.date <= end);
  };
  const on = (steps: number) => withKseniaReportedTrade(
    summarizeStrategy(kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), steps))) as any,
  ) as any;

  const sixteenth = on(10);
  const seventeenth = on(11);
  expect(sixteenth.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-16');
  expect(seventeenth.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-17');

  // The two figures the owner actually saw.
  expect(sixteenth.economics.periods['7D'].roi).toBeCloseTo(50.9208, 3);
  expect(seventeenth.economics.periods['7D'].roi).toBeCloseTo(41.9214, 3);

  const before = windowOf(sixteenth);
  const after = windowOf(seventeenth);
  expect(before[0].date).toBe('2026-09-10');
  expect(after[0].date).toBe('2026-09-11');

  // The whole of the drop is the day that aged out, less the day that arrived.
  const rolledOut = before[0].dailyReturn * 100;
  const rolledIn = after[after.length - 1].dailyReturn * 100;
  expect(after[after.length - 1].date).toBe('2026-09-17');
  // Within the 4-decimal rounding the published `roi` already carries, so the
  // residual here is that rounding and nothing else.
  expect(sixteenth.economics.periods['7D'].roi - rolledOut + rolledIn)
    .toBeCloseTo(seventeenth.economics.periods['7D'].roi, 3);

  // And the reported trade is still inside the 17 Sep window, carrying its
  // +7.8pp on top of that day's canonical return.
  const sixteenthDay = after.find((row: any) => row.date === '2026-09-16');
  expect(sixteenthDay).toBeDefined();
  const canonical: any = summarizeStrategy(
    kseniaReviewResponse(advanceKseniaReview(createKseniaReviewState(), 11)) as any,
  );
  const canonicalDay = canonical.dailyResults.find((row: any) => row.date === '2026-09-16');
  expect(sixteenthDay.dailyReturn).toBeCloseTo(canonicalDay.dailyReturn + 0.078, 9);
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
