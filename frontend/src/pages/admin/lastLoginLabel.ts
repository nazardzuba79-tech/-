const kyivDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function kyivParts(date: Date) {
  const parts = Object.fromEntries(kyivDateTime.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: parts.hour, minute: parts.minute,
  };
}

/** Compare calendar dates, rather than elapsed 24-hour periods. UTC here only
 * numbers the dates; Intl resolves the actual Kyiv offset, including DST. */
export function kyivDayDifference(earlier: Date, now: Date): number {
  const a = kyivParts(earlier), b = kyivParts(now);
  return (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000;
}

export function formatLastLoginAt(lastLoginAt: string | null, now = new Date()): string {
  if (!lastLoginAt) return '—';
  const login = new Date(lastLoginAt);
  if (!Number.isFinite(login.getTime())) return '—';
  const { year, month, day, hour, minute } = kyivParts(login);
  const time = `${hour}:${minute}`;
  const days = kyivDayDifference(login, now);
  if (days === 0) return `Сегодня, ${time}`;
  if (days === 1) return `Вчера, ${time}`;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}, ${time}`;
}
