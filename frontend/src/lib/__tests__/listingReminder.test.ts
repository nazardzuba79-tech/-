import { googleCalendarUrl, icsFile, icsStamp, hasLocalReminder, scheduleLocalReminder, cancelLocalReminder, restoreLocalReminders } from '../listingReminder';

/**
 * «Напомнить» beside a counting-down listing (2026-11-04): the calendar
 * links carry the exact UTC opening time and the local reminder survives a
 * reload, drops once the listing has opened, and can be switched off.
 */
const input = { pair: 'QVTR/USDT', name: 'QAVENTRA', openAt: Date.parse('2026-11-06T11:00:00.000Z'), url: 'https://voltextech.net/trade?pair=QVTR%2FUSDT', title: 'Листинг QVTR/USDT на VOLTEX', details: 'QAVENTRA' };

describe('listing reminder', () => {
  let store: Record<string, string> = {};
  beforeEach(() => {
    store = {};
    Object.assign(globalThis, { window: globalThis, localStorage: {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
    } });
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('calendar entries name the opening time in UTC with a one-hour alarm', () => {
    expect(icsStamp(input.openAt)).toBe('20261106T110000Z');
    const url = new URL(googleCalendarUrl(input));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20261106T110000Z/20261106T120000Z');
    expect(url.searchParams.get('text')).toBe(input.title);
    const ics = icsFile(input, Date.parse('2026-11-04T06:00:00.000Z'));
    expect(ics).toContain('DTSTART:20261106T110000Z');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics).toContain('SUMMARY:Листинг QVTR/USDT на VOLTEX');
    expect(ics).toContain('URL:https://voltextech.net/trade?pair=QVTR%2FUSDT');
    expect(ics.split('\r\n')).toContain('END:VCALENDAR');
  });

  test('a local reminder is stored, restored on the next visit, dropped once the listing opened, and can be cancelled', () => {
    jest.setSystemTime(Date.parse('2026-11-04T06:00:00.000Z'));
    scheduleLocalReminder(input);
    expect(hasLocalReminder(input.pair, input.openAt)).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
    cancelLocalReminder(input.pair, input.openAt);
    expect(hasLocalReminder(input.pair, input.openAt)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    scheduleLocalReminder(input);
    restoreLocalReminders(Date.parse('2026-11-06T12:00:00.000Z'));
    expect(hasLocalReminder(input.pair, input.openAt)).toBe(false);
  });
});
