import { adminOpenAllowed, dueSlot, instantOf, isDaytime, localTime, nextSlotAt, slotKeyAt, watchScheduleFromEnv } from '../depositWatchSchedule';

const s = watchScheduleFromEnv({});
const kyiv = (day: string, hh: number, mm = 0) => instantOf(day, hh * 60 + mm, 'Europe/Kyiv');

describe('deposit watcher daytime schedule (Europe/Kyiv)', () => {
  it('defaults: slots 12:00/16:00/20:00, day 07:00–22:00, dedupe 45 min (clamped 30–60)', () => {
    expect(s.slotMinutes).toEqual([720, 960, 1200]);
    expect([s.dayStartMinutes, s.nightStartMinutes]).toEqual([420, 1320]);
    expect(s.dedupeMs).toBe(45 * 60_000);
    expect(watchScheduleFromEnv({ DEPOSIT_WATCHER_DEDUPE_MINUTES: '5' }).dedupeMs).toBe(30 * 60_000);
    expect(watchScheduleFromEnv({ DEPOSIT_WATCHER_DEDUPE_MINUTES: '600' }).dedupeMs).toBe(60 * 60_000);
    // A night-time slot in configuration is dropped, never scheduled.
    expect(watchScheduleFromEnv({ DEPOSIT_WATCHER_SLOTS: '03:00,13:00,23:30' }).slotMinutes).toEqual([780]);
  });

  it('converts Kyiv wall time to UTC across summer and winter time', () => {
    expect(new Date(kyiv('2026-07-01', 12)).toISOString()).toBe('2026-07-01T09:00:00.000Z'); // EEST +3
    expect(new Date(kyiv('2026-12-01', 12)).toISOString()).toBe('2026-12-01T10:00:00.000Z'); // EET +2
    expect(localTime(Date.parse('2026-10-25T09:30:00Z'), 'Europe/Kyiv')).toEqual({ day: '2026-10-25', minutes: 11 * 60 + 30 }); // DST end day
  });

  it('no automatic slot at night or before the first slot; the latest passed slot is due in daytime', () => {
    expect(dueSlot(kyiv('2026-09-26', 3), s)).toBeNull();
    expect(dueSlot(kyiv('2026-09-26', 23), s)).toBeNull();
    expect(dueSlot(kyiv('2026-09-26', 21, 59), s)!.key).toBe('2026-09-26@1200');
    expect(dueSlot(kyiv('2026-09-26', 9), s)).toBeNull();
    expect(dueSlot(kyiv('2026-09-26', 12), s)!.key).toBe('2026-09-26@720');
    expect(dueSlot(kyiv('2026-09-26', 13, 30), s)!.key).toBe('2026-09-26@720'); // missed while asleep: same day, before 16:00
    expect(dueSlot(kyiv('2026-09-26', 17), s)!.key).toBe('2026-09-26@960');
    expect(slotKeyAt(kyiv('2026-09-26', 12, 1), s)).toBe('2026-09-26@720');
  });

  it('next slot skips the night to tomorrow 12:00', () => {
    expect(nextSlotAt(kyiv('2026-09-26', 8), s)).toBe(kyiv('2026-09-26', 12));
    expect(nextSlotAt(kyiv('2026-09-26', 12), s)).toBe(kyiv('2026-09-26', 16));
    expect(nextSlotAt(kyiv('2026-09-26', 20, 5), s)).toBe(kyiv('2026-09-27', 12));
    expect(nextSlotAt(kyiv('2026-09-26', 23), s)).toBe(kyiv('2026-09-27', 12));
  });

  it('admin-open: first opening after 07:00, once per Kyiv day, never at night', () => {
    expect(adminOpenAllowed(kyiv('2026-09-26', 6, 59), null, s)).toBe(false);
    expect(adminOpenAllowed(kyiv('2026-09-26', 7), null, s)).toBe(true);
    expect(adminOpenAllowed(kyiv('2026-09-26', 15), kyiv('2026-09-26', 7, 30), s)).toBe(false);
    expect(adminOpenAllowed(kyiv('2026-09-27', 7, 5), kyiv('2026-09-26', 7, 30), s)).toBe(true);
    expect(adminOpenAllowed(kyiv('2026-09-26', 22, 10), null, s)).toBe(false);
    expect(isDaytime(localTime(kyiv('2026-09-26', 21, 59), 'Europe/Kyiv'), s)).toBe(true);
  });
});
