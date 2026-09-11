import { buildTradingSessionState, TRADING_SESSIONS, type TradingSessionId } from '../../pages/home/tradingSessions';

const HOUR = 3_600_000;
const at = (iso: string) => buildTradingSessionState(new Date(iso));
const session = (iso: string, id: TradingSessionId) => at(iso).sessions.find(row => row.id === id)!;
const isoWindow = (iso: string, id: TradingSessionId) => {
  const window = session(iso, id).window!;
  return [new Date(window.start).toISOString(), new Date(window.end).toISOString()];
};

test('central indicative weekday configuration uses IANA zones and representative local windows', () => {
  expect(TRADING_SESSIONS.map(row => [row.id, row.zone, row.localHours])).toEqual([
    ['asia', 'Asia/Tokyo', '09:00–18:00'], ['europe', 'Europe/London', '08:00–17:00'], ['usa', 'America/New_York', '08:00–17:00'],
  ]);
  expect(TRADING_SESSIONS.flatMap(row => row.hubs.map(hub => hub.zone))).toEqual([
    'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'Europe/Zurich', 'America/New_York',
  ]);
});

test('Asia is active at UTC midnight and hub clocks use their own timezones', () => {
  const state = at('2026-01-12T00:00:00.000Z');
  expect(state.activeSessions.map(row => row.id)).toEqual(['asia']);
  const asia = state.sessions[0];
  expect(asia.localDate).toBe('2026-01-12');
  expect(asia.localTime).toBe('09:00');
  expect(asia.hubs.map(hub => [hub.name, hub.localTime])).toEqual([['Tokyo', '09:00'], ['Hong Kong', '08:00'], ['Singapore', '08:00']]);
  expect(asia.progress).toBe(0);
  expect(asia.elapsedMs).toBe(0);
  expect(asia.closesInMs).toBe(9 * HOUR);
  expect(asia.opensInMs).toBeNull();
  expect(state.nextSession.id).toBe('europe');
});

test('a session becomes active exactly at open and closed exactly at close', () => {
  const before = session('2026-01-12T07:59:59.999Z', 'europe');
  expect(before.status).toBe('UPCOMING');
  expect(before.opensInMs).toBe(1);
  expect(before.progress).toBe(0);
  expect(session('2026-01-12T08:00:00.000Z', 'europe').status).toBe('ACTIVE');
  expect(session('2026-01-12T16:59:59.999Z', 'europe').closesInMs).toBe(1);
  const closed = session('2026-01-12T17:00:00.000Z', 'europe');
  expect(closed.status).toBe('CLOSED');
  expect(closed.progress).toBe(1);
  expect(closed.elapsedMs).toBe(9 * HOUR);
  expect(closed.closesInMs).toBeNull();
  expect(closed.opensInMs).toBe(15 * HOUR);
});

test('midnight changes the local calendar without using the UTC weekday as the local weekday', () => {
  const before = session('2026-01-11T14:59:59.999Z', 'asia');
  const after = session('2026-01-11T15:00:00.000Z', 'asia');
  expect(before.localDate).toBe('2026-01-11');
  expect(before.status).toBe('CLOSED');
  expect(before.window).toBeNull();
  expect(after.localDate).toBe('2026-01-12');
  expect(after.localTime).toBe('00:00');
  expect(after.status).toBe('UPCOMING');
  expect(after.opensInMs).toBe(9 * HOUR);
  expect(at('2026-01-11T15:00:00.000Z').nextSession.id).toBe('asia');
});

test.each([
  ['2026-01-12T12:00:00Z', 'europe', '2026-01-12T08:00:00.000Z', '2026-01-12T17:00:00.000Z'],
  ['2026-07-13T12:00:00Z', 'europe', '2026-07-13T07:00:00.000Z', '2026-07-13T16:00:00.000Z'],
  ['2026-01-12T14:00:00Z', 'usa', '2026-01-12T13:00:00.000Z', '2026-01-12T22:00:00.000Z'],
  ['2026-07-13T14:00:00Z', 'usa', '2026-07-13T12:00:00.000Z', '2026-07-13T21:00:00.000Z'],
] as const)('IANA DST resolves %s %s without fixed UTC offsets', (instant, id, start, end) => {
  expect(isoWindow(instant, id)).toEqual([start, end]);
});

test.each([
  ['2026-03-09T13:00:00Z', '2026-03-09T12:00:00.000Z', '2026-03-09T17:00:00.000Z'],
  ['2026-03-23T13:00:00Z', '2026-03-23T12:00:00.000Z', '2026-03-23T17:00:00.000Z'],
  ['2026-10-26T13:00:00Z', '2026-10-26T12:00:00.000Z', '2026-10-26T17:00:00.000Z'],
] as const)('US/EU mismatch week expands the actual overlap on %s', (instant, start, end) => {
  const overlap = at(instant).overlaps.find(row => row.sessionIds.includes('usa'))!;
  expect([new Date(overlap.start).toISOString(), new Date(overlap.end).toISOString()]).toEqual([start, end]);
  expect(overlap.end - overlap.start).toBe(5 * HOUR);
});

test('the overlap returns to four hours after both regions switch DST', () => {
  for (const instant of ['2026-03-30T13:00:00Z', '2026-11-02T14:00:00Z']) {
    const state = at(instant);
    expect(state.activeSessions.map(row => row.id)).toEqual(['europe', 'usa']);
    const overlap = state.overlaps[0];
    expect(overlap.sessionIds).toEqual(['europe', 'usa']);
    expect(overlap.end - overlap.start).toBe(4 * HOUR);
    expect(overlap.startsInMs).toBe(0);
    expect(overlap.progress).toBeCloseTo(.25);
  }
});

test('Asia/Europe overlap reflects London DST while Tokyo stays unchanged', () => {
  const winter = at('2026-01-12T08:30:00Z').overlaps[0];
  const summer = at('2026-07-13T08:00:00Z').overlaps[0];
  expect(winter.sessionIds).toEqual(['asia', 'europe']);
  expect(winter.end - winter.start).toBe(HOUR);
  expect(summer.end - summer.start).toBe(2 * HOUR);
  expect(winter.progress).toBe(.5);
  expect(summer.progress).toBe(.5);
  expect(isoWindow('2026-07-13T08:00:00Z', 'asia')).toEqual(['2026-07-13T00:00:00.000Z', '2026-07-13T09:00:00.000Z']);
});

test('zero-duration closing boundary is not an active overlap and next overlap uses a true intersection', () => {
  const justBefore = at('2026-01-12T08:59:59.999Z');
  expect(justBefore.overlaps[0].endsInMs).toBe(1);
  const state = at('2026-01-12T09:00:00.000Z');
  expect(state.overlaps).toEqual([]);
  expect(state.nextOverlap?.sessionIds).toEqual(['europe', 'usa']);
  expect(state.nextOverlap?.startsInMs).toBe(4 * HOUR);
  expect(state.nextOverlap?.progress).toBe(0);
  expect(new Date(state.nextOverlap!.start).toISOString()).toBe('2026-01-12T13:00:00.000Z');
});

test('next region excludes the session that has just opened and selects the earliest strictly future opening', () => {
  expect(at('2026-01-12T07:59:59Z').nextSession.id).toBe('europe');
  expect(at('2026-01-12T08:00:00Z').nextSession.id).toBe('usa');
  expect(at('2026-01-12T13:00:00Z').nextSession.id).toBe('asia');
  expect(new Date(at('2026-01-12T13:00:00Z').nextSession.nextOpen).toISOString()).toBe('2026-01-13T00:00:00.000Z');
});

test('weekends have no active regional windows or overlaps, but preserve next Monday countdowns', () => {
  const state = at('2026-01-10T12:00:00Z');
  expect(state.activeSessions).toEqual([]);
  expect(state.overlaps).toEqual([]);
  expect(state.sessions.every(row => row.status === 'CLOSED' && row.window === null && row.progress === 0)).toBe(true);
  expect(state.nextSession.id).toBe('asia');
  expect(state.nextSession.opensInMs).toBe(36 * HOUR);
  expect(new Date(state.nextOverlap!.start).toISOString()).toBe('2026-01-12T08:00:00.000Z');
  expect(state.nextOverlap!.startsInMs).toBe(44 * HOUR);
});

test('Friday next opening resolves Monday across a DST weekend instead of adding a fixed UTC day', () => {
  const spring = session('2026-03-06T23:00:00Z', 'usa');
  expect(new Date(spring.nextOpen).toISOString()).toBe('2026-03-09T12:00:00.000Z');
  const autumn = session('2026-10-30T23:00:00Z', 'usa');
  expect(new Date(autumn.nextOpen).toISOString()).toBe('2026-11-02T13:00:00.000Z');
});

test('countdown/progress use the supplied instant exactly and never mutate the input Date', () => {
  const now = new Date('2026-01-12T04:30:00.500Z');
  const first = buildTradingSessionState(now);
  expect(first.sessions[0].progress).toBeCloseTo(.5 + .5 / (9 * 3600));
  expect(first.sessions[0].elapsedMs).toBe(4.5 * HOUR + 500);
  expect(first.sessions[0].closesInMs).toBe(4.5 * HOUR - 500);
  expect(buildTradingSessionState(now)).toEqual(first);
  expect(now.toISOString()).toBe('2026-01-12T04:30:00.500Z');
  expect(() => buildTradingSessionState(new Date(NaN))).toThrow(RangeError);
});
