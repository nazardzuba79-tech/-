import { shiftListingDate } from '../../../shared/listingSchedule';

describe('listing calendar reschedule', () => {
  test.each([
    ['2026-11-15T13:00:00Z', 'Europe/Kyiv', 1, '2026-11-16T13:00:00Z'],
    ['2026-11-25T13:00:00Z', 'Europe/Kyiv', 3, '2026-11-28T13:00:00Z'],
    ['2026-10-24T12:00:00Z', 'Europe/Kyiv', 1, '2026-10-25T13:00:00Z'],
    ['2026-03-28T13:00:00Z', 'Europe/Kyiv', 1, '2026-03-29T12:00:00Z'],
    ['2026-12-31T13:00:42.123Z', 'Europe/Kyiv', 2, '2027-01-02T13:00:42.123Z'],
  ])('%s +%s days uses local calendar', (at, zone, days, expected) => {
    expect(shiftListingDate(at, zone, days as number)).toBe(expected);
  });
  test('DST gaps/folds and invalid inputs are refused', () => {
    expect(shiftListingDate('2026-03-28T01:30:00Z', 'Europe/Kyiv', 1)).toBeNull();
    expect(shiftListingDate('2026-10-24T00:30:00Z', 'Europe/Kyiv', 1)).toBeNull();
    expect(shiftListingDate('2026-11-15T13:00:00Z', 'Bad/Zone', 1)).toBeNull();
    expect(shiftListingDate('bad', 'UTC', 1)).toBeNull();
    expect(shiftListingDate('2026-11-15T13:00:00Z', 'UTC', 4)).toBeNull();
  });
});
