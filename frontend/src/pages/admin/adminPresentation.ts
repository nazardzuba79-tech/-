export const ADMIN_TIME_ZONE = 'Europe/Kyiv';
export function adminDate(value: string | number | Date | null | undefined, dateOnly = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: ADMIN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false } as const : {}) }).format(date);
}
/** Calendar-day filters are Kyiv-local; request boundaries and storage stay UTC. */
export function adminDayBoundary(day: string, end = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [year, month, date] = day.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return undefined;
  const target = Date.UTC(year, month - 1, date + (end ? 1 : 0));
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: ADMIN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instant += target - local;
  }
  return new Date(instant - (end ? 1 : 0)).toISOString();
}
export const ADMIN_ACTIONS: Record<string, string> = {
  KYC_APPROVED: 'Верификация одобрена', KYC_REJECTED: 'Верификация отклонена',
  WITHDRAWAL_APPROVED: 'Вывод одобрен', WITHDRAWAL_SENT: 'Вывод отмечен отправленным', WITHDRAWAL_REJECTED: 'Вывод отклонён',
  TREASURY_WALLET_UPDATED: 'Адрес пополнения изменён', TREASURY_WALLET_RESET: 'Адрес пополнения сброшен',
  BALANCE_ADJUSTED: 'Баланс скорректирован', DEMO_TOP_UP: 'Тестовый баланс пополнен', DEMO_BALANCE_ADJUSTED: 'Тестовый баланс скорректирован',
  USER_REGISTERED: 'Пользователь зарегистрирован', USER_BLOCKED: 'Пользователь заблокирован', USER_UNBLOCKED: 'Пользователь разблокирован', USER_DELETED: 'Пользователь удалён',
  DEPOSIT_CREDITED: 'Пополнение зачислено', DEPOSIT_PACKAGE_CREDITED: 'Пакет пополнений зачислен',
  DEPOSIT_COPY_IGNORED: 'Сигнал копирования просмотрен',
  CONTACT_EMAIL_BLOCKED: 'Email добавлен в спам', CONTACT_EMAIL_UNBLOCKED: 'Email убран из спама',
};
export const adminAction = (value: string) => ADMIN_ACTIONS[value] ?? 'Действие администратора';
export const adminStatus = (value: string) => ({
  PENDING: 'Ожидает проверки', APPROVED: 'Одобрено', REJECTED: 'Отклонено', SENT: 'Отмечено отправленным',
  CREDITED: 'Зачислено', COMPLETED: 'Завершено', PROCESSING: 'В обработке', FAILED: 'Ошибка', CANCELLED: 'Отменено',
  NEW: 'Открыт', PARTIALLY_FILLED: 'Частично исполнен', FILLED: 'Исполнен', NOT_STARTED: 'Не начата',
  BUY: 'Покупка', SELL: 'Продажа', MARKET: 'Рыночный', LIMIT: 'Лимитный', STOP: 'Стоп',
  LONG: 'Лонг', SHORT: 'Шорт', OPEN: 'Открыта', CLOSED: 'Закрыта', LIQUIDATED: 'Ликвидирована',
} as Record<string, string>)[value] ?? 'Статус не распознан';

/** Audit display only. Never applied to the owner's existing test-password column. */
export function maskAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAuditMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /password|secret|token|authorization|cookie|private.?key|seed|database.?url/i.test(key) ? 'Скрыто' : maskAuditMetadata(item)]));
}
