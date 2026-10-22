import { zonedWallTimeToUtc } from '../../pages/admin/adminListingsTime';

describe('listing wall-clock time safety', () => {
  test.each([
    ['2026-02-30T12:00', 'UTC'],
    ['2026-13-01T12:00', 'UTC'],
    ['2026-10-01T24:00', 'UTC'],
    ['2026-03-29T03:30', 'Europe/Kyiv'],
    ['2026-10-25T03:30', 'Europe/Kyiv'],
    ['2026-03-08T02:30', 'America/New_York'],
    ['2026-11-01T01:30', 'America/New_York'],
    ['2026-10-01T12:00', 'Not/AZone'],
  ])('rejects impossible or ambiguous %s in %s', (wall, zone) => {
    expect(zonedWallTimeToUtc(wall, zone)).toBeNull();
  });

  test.each([
    ['2026-03-29T02:30', 'Europe/Kyiv', '2026-03-29T00:30:00Z'],
    ['2026-03-29T04:30', 'Europe/Kyiv', '2026-03-29T01:30:00Z'],
    ['2026-10-25T03:30', 'UTC', '2026-10-25T03:30:00Z'],
    ['2028-02-29T12:00', 'UTC', '2028-02-29T12:00:00Z'],
    ['2026-10-01T12:00', 'Asia/Kathmandu', '2026-10-01T06:15:00Z'],
  ])('preserves unique instant %s in %s', (wall, zone, expected) => {
    expect(zonedWallTimeToUtc(wall, zone)).toBe(expected);
  });
});
