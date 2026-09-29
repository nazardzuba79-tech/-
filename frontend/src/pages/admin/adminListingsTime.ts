/* Pure (no import.meta, no network) so it is unit-tested outside Vite. */

/* ---- Time zones: the admin types a wall-clock time in a chosen zone; the config stores the UTC instant. ---- */

export const LISTING_TIME_ZONES = ['Europe/Kyiv', 'UTC', 'Europe/Moscow', 'Europe/Warsaw', 'Europe/London', 'Asia/Dubai', 'America/New_York'] as const;

/** Offset of `timeZone` from UTC at `instant`, in ms (e.g. +3 h for Kyiv in summer). */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** `2026-10-01T15:00` in `timeZone` → `2026-10-01T12:00:00Z`. Handles DST by re-checking the offset. */
export function zonedWallTimeToUtc(wall: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

/** The reverse, for filling the form: UTC instant → wall-clock time in `timeZone`. */
export function utcToZonedWallTime(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return '';
  const local = new Date(instant + zoneOffsetMs(instant, timeZone));
  return local.toISOString().slice(0, 16);
}

/** «UTC+3», «UTC−5», «UTC» for a zone at an instant. */
export function utcOffsetLabel(instant: number, timeZone: string): string {
  const minutes = Math.round(zoneOffsetMs(instant, timeZone) / 60_000);
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}
