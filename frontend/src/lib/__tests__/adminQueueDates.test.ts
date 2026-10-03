import { adminQueueDateBounds } from '../../pages/admin/adminQueueDates';

test('summer dates cover the full Europe/Kyiv calendar day instead of UTC day', () => {
  expect(adminQueueDateBounds('2026-10-03', '2026-10-03')).toEqual({ from: '2026-10-02T21:00:00.000Z', to: '2026-10-03T20:59:59.999Z' });
});
test.each([['2026-03-29', 23], ['2026-10-25', 25]])('DST day %s spans the correct %s hours', (day, hours) => {
  const bounds = adminQueueDateBounds(day, day);
  expect(Date.parse(bounds.to!) - Date.parse(bounds.from!) + 1).toBe(Number(hours) * 3_600_000);
});
test('optional bounds stay omitted, and malformed deep-link filters are never silently discarded', () => {
  expect(adminQueueDateBounds('', '')).toEqual({});
  expect(adminQueueDateBounds('bad', '2026-02-31')).toEqual({ from: 'bad', to: '2026-02-31' });
});
