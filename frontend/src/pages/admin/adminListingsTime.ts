/* Shared IANA conversion for UI and authoritative listing schedule. */
import { zoneOffsetMs } from '../../../../src/shared/listingSchedule';
export { zoneOffsetMs, utcToZonedWallTime, zonedWallTimeToUtc, shiftListingDate } from '../../../../src/shared/listingSchedule';
export const LISTING_TIME_ZONES = ['Europe/Kyiv', 'UTC', 'Europe/Moscow', 'Europe/Warsaw', 'Europe/London', 'Asia/Dubai', 'America/New_York'] as const;

/** «UTC+3», «UTC−5», «UTC» for a zone at an instant. */
export function utcOffsetLabel(instant: number, timeZone: string): string {
  const minutes = Math.round(zoneOffsetMs(instant, timeZone) / 60_000);
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
}
