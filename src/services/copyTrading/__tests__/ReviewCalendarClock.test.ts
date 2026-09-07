import { createReviewCalendarClock } from '../reviewCalendarClock';
import { createReviewSyntheticState } from '../reviewSyntheticHistory';
import { toResponse } from '../SyntheticCopyTradingEngine';
import { createNazarPresentationState } from '../nazarPresentation';

test('review runtime follows injected UTC calendar time without a redeploy and is reload/restart deterministic', () => {
  let time = new Date('2026-09-05T00:00:01Z');
  const clock = createReviewCalendarClock(() => time);
  const baselineJson = clock.snapshot();
  const baseline = JSON.parse(baselineJson);
  time = new Date('2026-09-05T23:59:59Z');
  expect(clock.snapshot()).toBe(baselineJson);
  for (const date of ['2026-09-06', '2026-09-12', '2026-10-05', '2026-12-04']) {
    time = new Date(`${date}T00:00:01Z`);
    const json = clock.snapshot();
    const response = JSON.parse(json);
    const independent = toResponse(createReviewSyntheticState(time));
    expect(response).toEqual(independent);
    expect(createReviewCalendarClock(() => time).snapshot()).toBe(json);
    expect(response.simulation.simulatedAt.slice(0, 10)).toBe(date);
    expect(response.dailyResults.slice(0, 380)).toEqual(baseline.dailyResults);
    expect(response.equityHistory.slice(0, 381)).toEqual(baseline.equityHistory);
    const oldIds = new Set(baseline.trades.map((trade: {id:string}) => trade.id));
    expect(response.trades.filter((trade: {id:string}) => oldIds.has(trade.id))).toEqual(baseline.trades);
    expect(response.analytics.totalTrades).toBeGreaterThan(471);
    expect(clock.snapshot()).toBe(json);
  }
  time = new Date('2026-09-05T12:00:00Z');
  expect(clock.snapshot()).toBe(baselineJson);
});

test('review clock uses UTC rather than the browser local date and rejects pre-baseline dates', () => {
  const sameUtcDay = createReviewCalendarClock(() => new Date('2026-09-06T01:30:00+03:00'));
  expect(JSON.parse(sameUtcDay.snapshot()).simulation.simulatedAt.slice(0,10)).toBe('2026-09-05');
  expect(() => createReviewCalendarClock(() => new Date('2026-09-04T23:59:59Z')).snapshot()).toThrow();
});

test('explicit presentation clock uses one replayed ledger and appends it deterministically, without changing the default clock', () => {
  let time = new Date('2026-09-05T12:00:00Z');
  const presentation = createReviewCalendarClock(() => time, createNazarPresentationState);
  const original = createReviewCalendarClock(() => time);
  const first = presentation.snapshot();
  expect(first).not.toBe(original.snapshot());
  expect(JSON.parse(original.snapshot())).toEqual(toResponse(createReviewSyntheticState(time)));
  for (const date of ['2026-09-05', '2026-09-06', '2026-09-12', '2026-10-05', '2026-12-04']) {
    time = new Date(date + 'T12:00:00Z');
    const snapshot = presentation.snapshot();
    expect(JSON.parse(snapshot)).toEqual(toResponse(createNazarPresentationState(time)));
    expect(snapshot).toBe(createReviewCalendarClock(() => time, createNazarPresentationState).snapshot());
    expect(presentation.snapshot()).toBe(snapshot);
  }
  time = new Date('2026-09-05T12:00:00Z');
  expect(presentation.snapshot()).toBe(first);
});
