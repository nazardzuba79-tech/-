/** Pure IANA calendar arithmetic, shared by the admin preview and authoritative store. */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000;
}

export function utcToZonedWallTime(iso: string, timeZone: string): string {
  const instant = Date.parse(iso);
  return Number.isFinite(instant) ? new Date(instant + zoneOffsetMs(instant, timeZone)).toISOString().slice(0, 16) : '';
}

/** A gap or fold is refused, never silently shifted or resolved to an arbitrary offset. */
export function zonedWallTimeToUtc(wall: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!Number.isFinite(guess) || new Date(guess).toISOString().slice(0, 16) !== wall) return null;
  try {
    const offsets = new Set<number>();
    for (let h = -48; h <= 48; h += 6) offsets.add(zoneOffsetMs(guess + h * 3_600_000, timeZone));
    const candidates = [...offsets].map(offset => guess - offset)
      .filter(at => utcToZonedWallTime(new Date(at).toISOString(), timeZone) === wall);
    return candidates.length === 1 ? new Date(candidates[0]).toISOString().replace('.000Z', 'Z') : null;
  } catch { return null; }
}

/** Add local calendar days, preserving wall-clock hour, seconds and milliseconds across DST. */
export function shiftListingDate(iso: string, zone: string, days: number): string | null {
  if (![1, 2, 3].includes(days) || !Number.isFinite(Date.parse(iso))) return null;
  try {
    const wall = utcToZonedWallTime(iso, zone);
    const date = new Date(wall + ':00Z');
    date.setUTCDate(date.getUTCDate() + days);
    const next = zonedWallTimeToUtc(date.toISOString().slice(0, 16), zone);
    if (!next) return null;
    const remainder = ((Date.parse(iso) % 60_000) + 60_000) % 60_000;
    return new Date(Date.parse(next) + remainder).toISOString().replace('.000Z', 'Z');
  } catch { return null; }
}
