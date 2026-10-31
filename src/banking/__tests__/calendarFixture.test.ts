import { addCalendarMonthsClamped, completedCalendarMonths } from '../math';
import { bankingFixtureNow, monthsAfter, monthsBefore } from '../testing/calendarFixture';

/**
 * Issue #654: the Banking referral fixture dated a placement "n months ago" with
 * setUTCMonth, which overflows on month ends (31 Oct − 1 month = "31 Sep" = 1 Oct),
 * so on such days a one-month placement had completed no month and nothing settled.
 * The fixture now uses production's clamped rule. These tables pin that, on every
 * day that can break, in several process time zones, for both directions.
 */
const overflowing = (now: Date, n: number) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - n); return d; };
const day = (d: Date) => d.toISOString().slice(0, 10);

const NOWS = [
  // the 28th–31st, short and long months
  '2026-10-28T09:00:00Z', '2026-10-29T09:00:00Z', '2026-10-30T09:00:00Z', '2026-10-31T05:25:00Z',
  '2026-11-30T12:00:00Z', '2026-12-31T23:59:59Z', '2027-01-31T00:00:00Z',
  // February: common and leap years, the day after
  '2027-02-28T12:00:00Z', '2027-03-01T00:00:00Z', '2027-03-31T12:00:00Z',
  '2028-02-29T12:00:00Z', '2028-03-29T12:00:00Z', '2028-03-31T12:00:00Z',
  // January → December across the year boundary, and the first instant of a year
  '2027-01-01T00:00:00Z', '2027-01-15T12:00:00Z',
  // European and US DST change days
  '2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z', '2026-11-01T06:30:00Z',
];
const SPANS = [1, 2, 3, 6, 12, 24, 25];

describe.each(['UTC', 'Europe/Kyiv', 'America/New_York', 'Pacific/Auckland'])('in process TZ %s', zone => {
  const previous = process.env.TZ;
  beforeAll(() => { process.env.TZ = zone; });
  afterAll(() => { process.env.TZ = previous; });

  test.each(NOWS)('on %s a placement opened n months before has completed exactly n months', iso => {
    const now = new Date(iso);
    for (const n of SPANS) {
      const opened = monthsBefore(now, n);
      expect({ n, completed: completedCalendarMonths(opened, now) }).toEqual({ n, completed: n });
      // One more month is never complete yet: the fixture is not "more than n months" either.
      expect({ n, next: addCalendarMonthsClamped(opened, n + 1) > now }).toEqual({ n, next: true });
      // Maturity uses the same clamp, and is never before the opening day.
      expect(monthsAfter(opened, n).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });
});

test('the defect: the overflowing helper completes one month fewer on the 31st after a 30-day month', () => {
  const now = new Date('2026-10-31T05:25:00Z');
  expect(day(overflowing(now, 1))).toBe('2026-10-01');
  expect(completedCalendarMonths(overflowing(now, 1), now)).toBe(0);
  expect(day(monthsBefore(now, 1))).toBe('2026-09-30');
  expect(completedCalendarMonths(monthsBefore(now, 1), now)).toBe(1);
});

test.each([
  ['2026-10-31T00:00:00Z', 1, '2026-09-30'], ['2026-03-31T00:00:00Z', 1, '2026-02-28'],
  ['2028-03-31T00:00:00Z', 1, '2028-02-29'], ['2028-03-30T00:00:00Z', 1, '2028-02-29'],
  ['2027-01-31T00:00:00Z', 2, '2026-11-30'], ['2027-01-15T00:00:00Z', 1, '2026-12-15'],
  ['2027-02-28T00:00:00Z', 12, '2026-02-28'], ['2028-02-29T00:00:00Z', 12, '2027-02-28'],
  ['2026-12-31T00:00:00Z', 1, '2026-11-30'], ['2026-05-31T00:00:00Z', 3, '2026-02-28'],
])('%s minus %i month(s) is %s', (now, n, expected) => {
  expect(day(monthsBefore(new Date(now), n))).toBe(expected);
});

test('BANKING_TEST_NOW pins the clock and refuses anything that is not an ISO date or UTC instant', () => {
  expect(bankingFixtureNow({ BANKING_TEST_NOW: '2026-10-31' }).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  expect(bankingFixtureNow({ BANKING_TEST_NOW: '2027-02-28T12:00:00Z' }).toISOString()).toBe('2027-02-28T12:00:00.000Z');
  for (const bad of ['31.10.2026', '2026-10-31T12:00:00+03:00', 'tomorrow', '2026-13-01'])
    expect(() => bankingFixtureNow({ BANKING_TEST_NOW: bad })).toThrow(/BANKING_TEST_NOW/);
  const before = Date.now(), real = bankingFixtureNow({}).getTime();
  expect(real).toBeGreaterThanOrEqual(before);
});
