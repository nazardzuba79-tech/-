import { CopyPerformanceService } from '../CopyPerformanceService';
import { summarizeStrategy } from '../marketplaceSummary';
import { withKseniaReportedTrade } from '../kseniaReportedTrade';
import { KSENIA_REPORTED_WEEK, reportedWeekIsCurrent, withKseniaReportedWeek } from '../kseniaReportedWeek';
import { KSENIA_REVIEW } from '../canonical/kseniaReview';

/**
 * THE 61.9% QUESTION, ANSWERED WITH ARITHMETIC.
 *
 * These are not tests of a number someone chose. They are the derivation
 * the owner asked for — period bounds, the model's own draw, what the card
 * shows, and the gap — pinned so the explanation cannot drift away from the
 * code it explains.
 */

function memoryDb() {
  const rows = new Map<string, any>();
  return { copyPerformanceScenario: {
    findUnique: async ({ where }: any) => rows.get(where.id) ?? null,
    create: async ({ data }: any) => { rows.set(data.id, { ...data, revision: 0 }); return data; },
    updateMany: async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, revision: row.revision + 1, stateText: data.stateText, simulatedAt: data.simulatedAt });
      return { count: 1 };
    } } } as any;
}
const AT = '2026-09-19T12:00:00Z';
async function ksenia(now = AT) {
  const service = new CopyPerformanceService(memoryDb(), () => new Date(now));
  return withKseniaReportedTrade(summarizeStrategy(await service.get('ksenia'))) as any;
}
const sum = (rows: any[]) => rows.reduce((total, row) => total + row.dailyReturn, 0) * 100;
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

describe('the two periods, stated separately', () => {
  it('names the calendar week and the rolling 7D window, and their bounds', async () => {
    const data = await ksenia();
    const end = data.simulation.simulatedAt.slice(0, 10);
    expect(end).toBe('2026-09-19');

    // The engine's own week key: Sunday-start, UTC. See kseniaReview.ts,
    // which keys the weekly regime on `dateAt(date, -getUTCDay())`.
    const weekStart = new Date(Date.parse(`${end}T00:00:00Z`) - dayOf(end) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(weekStart).toBe('2026-09-13');
    expect(dayOf(weekStart)).toBe(0);          // Sunday
    expect(dayOf(end)).toBe(6);                // Saturday

    // Rolling 7D: strictly after end-7, up to and including end.
    const cutoff = new Date(Date.parse(`${end}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(cutoff).toBe('2026-09-12');

    const calendar = data.dailyResults.filter((r: any) => r.date >= weekStart && r.date <= end);
    const rolling = data.dailyResults.filter((r: any) => r.date > cutoff && r.date <= end);
    expect(calendar).toHaveLength(7);
    expect(rolling).toHaveLength(7);

    // TODAY they coincide — and only because today is a Saturday, which is
    // the one weekday on which a Sunday-start week and a trailing seven
    // days cover the same dates. They are not the same window in general,
    // and must not be assumed to be.
    expect(calendar.map((r: any) => r.date)).toEqual(rolling.map((r: any) => r.date));
    expect(KSENIA_REPORTED_WEEK.periodStart).toBe(weekStart);
    expect(KSENIA_REPORTED_WEEK.periodEnd).toBe(end);
    expect(KSENIA_REPORTED_WEEK.timezone).toBe('UTC');
  }, 600_000);

  it('they stop coinciding the very next day', async () => {
    const data = await ksenia('2026-09-20T12:00:00Z');
    const end = data.simulation.simulatedAt.slice(0, 10);
    expect(end).toBe('2026-09-20');
    expect(dayOf(end)).toBe(0);                 // Sunday: a NEW week begins
    const weekStart = new Date(Date.parse(`${end}T00:00:00Z`) - dayOf(end) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(weekStart).toBe('2026-09-20');
    const calendar = data.dailyResults.filter((r: any) => r.date >= weekStart && r.date <= end);
    const cutoff = new Date(Date.parse(`${end}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const rolling = data.dailyResults.filter((r: any) => r.date > cutoff && r.date <= end);
    expect(calendar).toHaveLength(1);           // one day into the new week
    expect(rolling).toHaveLength(7);            // still a trailing seven
  }, 600_000);
});

describe('where ~20% comes from, and how far 61.9% is from it', () => {
  it('derives the published week from the model plus the reported trade', async () => {
    const service = new CopyPerformanceService(memoryDb(), () => new Date(AT));
    const raw: any = summarizeStrategy(await service.get('ksenia'));
    const published: any = withKseniaReportedTrade(raw);
    const inWeek = (rows: any[]) => rows.filter(r => r.date >= '2026-09-13' && r.date <= '2026-09-19');

    const modeled = sum(inWeek(raw.dailyResults));
    const shown = sum(inWeek(published.dailyResults));

    expect(modeled).toBeCloseTo(12.7094, 3);
    expect(shown).toBeCloseTo(20.5094, 3);
    // Exactly the reported trade's 7.8 percentage points, nothing else.
    expect(shown - modeled).toBeCloseTo(7.8, 6);
    // And that is the figure the card and the profile actually read.
    expect(published.economics.periods['7D'].roi).toBeCloseTo(20.5094, 3);
    expect(published.analytics.roi7).toBeCloseTo(20.5094, 3);
    expect(published.weekly.find((w: any) => w.period === '2026-09-13').roi).toBeCloseTo(20.509, 2);

    expect(KSENIA_REPORTED_WEEK.modeledReturnPct).toBeCloseTo(modeled, 3);
    expect(KSENIA_REPORTED_WEEK.publishedReturnPct).toBeCloseTo(shown, 3);
    // The gap the owner is asking about.
    expect(KSENIA_REPORTED_WEEK.returnPct - shown).toBeCloseTo(41.3906, 3);
  }, 600_000);

  it('shows there is no 20% ceiling: the model drew 69.6% the week before', () => {
    // Reproduced from the engine's own generator rather than asserted from
    // memory, so this stays true only while the engine still says so.
    const DAY = 86_400_000;
    const dateAt = (date: string, offset: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
    function random(key: string) {
      let n = KSENIA_REVIEW.seed;
      for (const c of key) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
      return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
    }
    const weeklyTarget = (week: string) => {
      const rng = random('future-week:' + week);
      const regime = rng();
      return { regime, target: (regime < .06 ? -.02 - rng() * .05 : regime < .18 ? rng() * .1
        : regime < .40 ? .1 + rng() * .2 : regime < .77 ? .25 + rng() * .2 : .45 + rng() * .25) * 100 };
    };
    const thisWeek = weeklyTarget('2026-09-13');
    const lastWeek = weeklyTarget(dateAt('2026-09-13', -7));

    expect(thisWeek.target).toBeCloseTo(12.7094, 3);
    expect(lastWeek.target).toBeCloseTo(69.6216, 3);
    // 61.9% sits inside the band the model reached only a week earlier, so
    // the ~20% is this week's draw and not a cap.
    expect(KSENIA_REPORTED_WEEK.returnPct).toBeLessThan(lastWeek.target);
  });
});

describe('nothing is counted twice, and nothing is rewritten', () => {
  it('folds the 2026-09-16 trade in exactly once, however often the day is served', async () => {
    const service = new CopyPerformanceService(memoryDb(), () => new Date(AT));
    const results = await Promise.all([1, 2, 3, 4, 5].map(async () =>
      withKseniaReportedTrade(summarizeStrategy(await service.get('ksenia'))) as any));
    const sixteenth = results.map(r => r.dailyResults.find((d: any) => d.date === '2026-09-16'));
    // Five requests against one cached day: identical every time. A second
    // application would have added another 7.8pp and another 1,754 USDT.
    for (const day of sixteenth) expect(day).toEqual(sixteenth[0]);
    for (const r of results) expect(r.tradeStats.ALL.totalTrades).toBe(results[0].tradeStats.ALL.totalTrades);
    // The overlay deep-copies, so the service's cached response is clean and
    // the next request starts from the model again, not from an overlaid one.
    const cached: any = await service.get('ksenia');
    const cachedDay = cached.dailyResults.find((d: any) => d.date === '2026-09-16');
    expect(cachedDay.realizedPnl).toBeCloseTo(sixteenth[0].realizedPnl - 1754, 4);
  }, 600_000);

  it('makes the reported 61.9% the VISIBLE weekly return, and only that', async () => {
    const before = await ksenia();
    const after: any = withKseniaReportedWeek(before);

    // What the owner asked for: the three places a weekly return is read.
    expect(after.analytics.roi7).toBe(61.9);
    expect(after.economics.periods['7D'].roi).toBe(61.9);
    expect(after.weekly.find((w: any) => w.period === '2026-09-13').roi).toBe(61.9);

    // Declared, with its provenance and the figures it replaced, so the
    // payload says out loud which number is the owner's word.
    expect(after.reportedWeeks).toHaveLength(1);
    expect(after.reportedWeeks[0]).toMatchObject({
      traderId: 'VX-KSENIA', periodStart: '2026-09-13', periodEnd: '2026-09-19', timezone: 'UTC',
      returnPct: 61.9, source: 'OWNER_REPORTED', includesReportedTradeOf20260916: false,
      modeledReturnPct: 12.7094, publishedReturnPct: 20.5094, appliedToVisibleWeeklyRoi: true,
    });
    expect(after.provenance).toBe('SYNTHETIC_REVIEW');
  }, 600_000);

  it('invents no trade, no price, no curve and no P&L to justify it', async () => {
    const before = await ksenia();
    const after: any = withKseniaReportedWeek(before);

    // The engine's history is untouched, byte for byte. A 61.9% week with a
    // fabricated daily curve behind it would be a lie with a shape; this is
    // a reported figure that says so.
    for (const key of ['equityHistory', 'dailyResults', 'aumHistory', 'followers',
      'tradeStats', 'trades', 'monthly', 'traderEarnings365']) {
      expect(after[key]).toEqual((before as any)[key]);
    }
    // Money did not move with the percentage: the weekly PnL beside the ROI
    // is still the engine's, and nothing derived a P&L from 61.9%.
    expect(after.weekly.find((w: any) => w.period === '2026-09-13').pnl)
      .toBe((before as any).weekly.find((w: any) => w.period === '2026-09-13').pnl);
    expect(after.economics.periods['7D'].masterPnl).toBe((before as any).economics.periods['7D'].masterPnl);
    expect(after.analytics.aum).toBe((before as any).analytics.aum);
    // Other windows keep deriving from the model.
    expect(after.analytics.roi30).toBe((before as any).analytics.roi30);
    expect(after.economics.periods['30D'].roi).toBe((before as any).economics.periods['30D'].roi);
    expect(after.economics.periods.ALL.roi).toBe((before as any).economics.periods.ALL.roi);
  }, 600_000);

  it('applies only while the reported period is the current week', async () => {
    // Inside the week: applied.
    expect(reportedWeekIsCurrent('2026-09-13T00:00:00.000Z')).toBe(true);
    expect(reportedWeekIsCurrent('2026-09-19T23:59:59.999Z')).toBe(true);
    // Past it: the rolling 7D window no longer describes that week, so 7D
    // goes back to the model rather than carrying one reported week forward
    // into weeks that have not happened.
    expect(reportedWeekIsCurrent('2026-09-20T00:00:00.000Z')).toBe(false);
    const later: any = withKseniaReportedWeek(await ksenia('2026-09-24T12:00:00Z'));
    expect(later.reportedWeeks[0].appliedToVisibleWeeklyRoi).toBe(false);
    expect(later.analytics.roi7).not.toBe(61.9);
    // It is still on record for the week it belongs to.
    expect(later.reportedWeeks[0].returnPct).toBe(61.9);
  }, 600_000);

  it('applying it twice changes nothing', async () => {
    const once: any = withKseniaReportedWeek(await ksenia());
    expect(withKseniaReportedWeek(once)).toEqual(once);
  }, 600_000);
});

describe('how the model advances', () => {
  it('advances only when the API is called — there is no scheduler', async () => {
    // The service is the only thing that appends a day, and it appends when
    // `get()` runs. Nothing in src/ schedules it: a strategy that is never
    // requested is never advanced, and one requested ten times on the same
    // UTC day is advanced once.
    const db = memoryDb();
    const clock = { now: '2026-09-17T12:00:00Z' };
    const service = new CopyPerformanceService(db, () => new Date(clock.now));

    const first: any = await service.get('ksenia');
    expect(first.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-17');

    // Ten reads on the same day: one state, no extra days.
    const repeated = await Promise.all(Array.from({ length: 10 }, () => service.get('ksenia')));
    for (const response of repeated) expect(response).toBe(first);

    // Move the clock two days and read once: it catches both up, and the
    // day it had already produced is unchanged.
    clock.now = '2026-09-19T12:00:00Z';
    const later: any = await service.get('ksenia');
    expect(later.simulation.simulatedAt.slice(0, 10)).toBe('2026-09-19');
    const seventeenth = later.dailyResults.find((d: any) => d.date === '2026-09-17');
    expect(seventeenth).toEqual(first.dailyResults.find((d: any) => d.date === '2026-09-17'));
    // Days are appended, never rewritten or duplicated.
    const dates = later.dailyResults.map((d: any) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
  }, 600_000);

  it('concurrent first requests produce one history, not two', async () => {
    const db = memoryDb();
    const service = new CopyPerformanceService(db, () => new Date(AT));
    const [a, b, c] = await Promise.all([service.get('ksenia'), service.get('ksenia'), service.get('ksenia')]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    const dates = (a as any).dailyResults.map((d: any) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
  }, 600_000);
});
