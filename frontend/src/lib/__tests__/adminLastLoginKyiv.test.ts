import { formatLastLoginAt, kyivDayDifference } from '../../pages/admin/lastLoginLabel';

describe('Последний вход uses the Europe/Kyiv calendar', () => {
  test('the calendar day changes at Kyiv midnight, even two minutes apart', () => {
    const now = new Date('2026-09-24T21:01:00Z'); // 25 Sep 00:01 Kyiv
    expect(formatLastLoginAt('2026-09-24T20:59:00Z', now)).toBe('Вчера, 23:59');
    expect(formatLastLoginAt('2026-09-24T21:00:00Z', now)).toBe('Сегодня, 00:00');
    expect(kyivDayDifference(new Date('2026-09-24T20:59:00Z'), now)).toBe(1);
  });

  test('yesterday is based on dates, even when more than 24 hours elapsed', () => {
    const now = new Date('2026-09-25T20:50:00Z'); // 25 Sep 23:50 Kyiv
    expect(formatLastLoginAt('2026-09-23T21:05:00Z', now)).toBe('Вчера, 00:05');
  });

  test('older login uses its Kyiv date and time, including year boundaries', () => {
    expect(formatLastLoginAt('2025-12-31T22:30:00Z', new Date('2026-01-03T12:00:00Z')))
      .toBe('01.01.2026, 00:30');
    expect(formatLastLoginAt('2025-12-31T20:30:00Z', new Date('2026-01-03T12:00:00Z')))
      .toBe('31.12.2025, 22:30');
  });

  test('spring DST jump uses summer offset and still recognizes the same calendar day', () => {
    const now = new Date('2026-03-29T01:30:00Z'); // 04:30 EEST
    expect(formatLastLoginAt('2026-03-28T21:59:00Z', now)).toBe('Вчера, 23:59');
    expect(formatLastLoginAt('2026-03-28T22:00:00Z', now)).toBe('Сегодня, 00:00');
    expect(formatLastLoginAt('2026-03-29T00:30:00Z', now)).toBe('Сегодня, 02:30');
    expect(formatLastLoginAt('2026-03-29T01:00:00Z', now)).toBe('Сегодня, 04:00');
  });

  test('autumn DST repeats 03:30 without changing its calendar date', () => {
    const now = new Date('2026-10-25T22:05:00Z'); // 26 Oct 00:05 EET
    expect(formatLastLoginAt('2026-10-25T00:30:00Z', now)).toBe('Вчера, 03:30');
    expect(formatLastLoginAt('2026-10-25T01:30:00Z', now)).toBe('Вчера, 03:30');
    expect(formatLastLoginAt('2026-10-25T21:59:00Z', now)).toBe('Вчера, 23:59');
    expect(formatLastLoginAt('2026-10-25T22:00:00Z', now)).toBe('Сегодня, 00:00');
  });

  test('no timestamp or invalid timestamp remains unavailable', () => {
    expect(formatLastLoginAt(null)).toBe('—');
    expect(formatLastLoginAt('not-a-date')).toBe('—');
  });
});
