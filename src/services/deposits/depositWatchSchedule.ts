/**
 * The deposit watcher's DAYTIME schedule, in Europe/Kyiv time (owner policy):
 *   - the first scan of the day runs when an admin first opens
 *     Admin → Пополнения at or after 07:00 (once per Kyiv day);
 *   - automatic slots at 12:00, 16:00 and 20:00;
 *   - nothing automatic 22:00–07:00, and no night catch-up: a slot missed
 *     while the API slept runs later the SAME day only if it is still before
 *     22:00 and before the next slot; otherwise the next daytime trigger
 *     simply continues from the checkpoint;
 *   - an automatic or admin-open trigger within DEDUPE minutes of any
 *     successful scan does nothing (NOT_DUE).
 * Manual «Проверить новые поступления» / «Проверить TXID» are not governed here.
 */
export interface WatchSchedule {
  timeZone: string;
  dayStartMinutes: number;   // 07:00
  nightStartMinutes: number; // 22:00
  slotMinutes: number[];     // 12:00, 16:00, 20:00
  dedupeMs: number;          // 30–60 min
}

const hhmm = (value: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? minutes : null;
};

/** Env overrides: DEPOSIT_WATCHER_SLOTS ("12:00,16:00,20:00"),
 * DEPOSIT_WATCHER_DEDUPE_MINUTES (clamped to 30–60). Slots outside the
 * daytime window are dropped, so misconfiguration can never scan at night. */
export function watchScheduleFromEnv(env: Record<string, string | undefined> = process.env): WatchSchedule {
  const dayStartMinutes = 7 * 60, nightStartMinutes = 22 * 60;
  const parsed = (env.DEPOSIT_WATCHER_SLOTS ?? '12:00,16:00,20:00').split(',').map(hhmm)
    .filter((m): m is number => m !== null && m >= dayStartMinutes && m < nightStartMinutes);
  const slotMinutes = [...new Set(parsed.length ? parsed : [720, 960, 1200])].sort((a, b) => a - b);
  const dedupe = Number(env.DEPOSIT_WATCHER_DEDUPE_MINUTES ?? 45);
  return { timeZone: 'Europe/Kyiv', dayStartMinutes, nightStartMinutes, slotMinutes,
    dedupeMs: Math.min(60, Math.max(30, Number.isFinite(dedupe) ? dedupe : 45)) * 60_000 };
}

export interface LocalTime { day: string; minutes: number }

/** Wall-clock date and minute-of-day in `timeZone` for an instant. */
export function localTime(at: number, timeZone: string): LocalTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The UTC instant of `minutes` past midnight on local `day` in `timeZone` (DST-safe). */
export function instantOf(day: string, minutes: number, timeZone: string): number {
  const [y, mo, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const seen = localTime(guess, timeZone);
    const [sy, sm, sd] = seen.day.split('-').map(Number);
    guess += wall - Date.UTC(sy, sm - 1, sd, Math.floor(seen.minutes / 60), seen.minutes % 60);
  }
  return guess;
}

const nextDay = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

export const isDaytime = (t: LocalTime, s: WatchSchedule) => t.minutes >= s.dayStartMinutes && t.minutes < s.nightStartMinutes;

/** The automatic slot that is due now, as a stable key ("2026-09-26@720"),
 * or null (night, or before today's first slot). */
export function dueSlot(now: number, s: WatchSchedule): { key: string; at: number } | null {
  const t = localTime(now, s.timeZone);
  if (!isDaytime(t, s)) return null;
  const passed = s.slotMinutes.filter((m) => m <= t.minutes);
  if (!passed.length) return null;
  const minutes = passed[passed.length - 1];
  return { key: `${t.day}@${minutes}`, at: instantOf(t.day, minutes, s.timeZone) };
}

/** Slot key a past automatic run belongs to (same rule, evaluated at that time). */
export const slotKeyAt = (at: number | null, s: WatchSchedule): string | null => (at === null ? null : dueSlot(at, s)?.key ?? null);

/** Next automatic slot strictly after `now` (skipping the night). */
export function nextSlotAt(now: number, s: WatchSchedule): number {
  let day = localTime(now, s.timeZone).day;
  for (let i = 0; i < 3; i++, day = nextDay(day)) {
    for (const m of s.slotMinutes) {
      const at = instantOf(day, m, s.timeZone);
      if (at > now) return at;
    }
  }
  throw new Error('No deposit watcher slot configured');
}

/** May the admin-open trigger run now? Once per Kyiv day, daytime only. */
export function adminOpenAllowed(now: number, lastAdminOpenAt: number | null, s: WatchSchedule): boolean {
  const t = localTime(now, s.timeZone);
  if (!isDaytime(t, s)) return false;
  return lastAdminOpenAt === null || localTime(lastAdminOpenAt, s.timeZone).day !== t.day;
}
