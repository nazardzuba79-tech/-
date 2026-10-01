import { ApiError, getToken, request } from '../../lib/api';

export interface CashSummary {
  id: string; number: string; country: string; cityId: string; asset: string; quantity: string; fiat: string;
  tier: string; status: string; version: number; offerVersion: number; acceptedOfferVersion: number | null;
  acceptedAt: string | null; cancelRequested: boolean; pickupRevision: number; createdAt: string;
  reservedQuantity?: string; reserveStatus?: string; user?: { id: string; email: string };
}
export interface CashOffer { version: number; rate: string; gross: string; fee: string; net: string; fiat: string;
  asset: string; quantity: string; expiresAt: string; acceptedAt: string | null; cashPrecision: number }
export interface CashDetail extends CashSummary { offers: CashOffer[]; reservation: { asset: string; quantity: string; status: string }; completion?: { reference: string; completedAt: string } | null }
export interface CashMessage { id: string; sender: 'USER' | 'ADMIN'; kind: string; text: string; createdAt: string }
export interface CashConfig { enabled: boolean; routes: { country: string; cityId: string; asset: string; fiat: string; cashPrecision: number }[] }
export type CashDraft = { country: string; cityId: string; asset: string; quantity: string; fiat: string; tier: string };
export type CashIntent = CashDraft & { idempotencyKey: string };
export const CASH_STATUSES: Record<string,string> = { RESERVED:'В резерве', OFFERED:'Предложены условия', ACCEPTED:'Условия приняты',
  PICKUP_READY:'Выдача подготовлена', PAYOUT_IN_PROGRESS:'Выдача начата — резерв сохраняется', COMPLETED:'Наличные выданы', CANCELLED:'Отменена', REJECTED:'Отклонена' };
export const dateTime = (value: string) => `${new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))} UTC`;
const ERRORS: Record<string,string> = {
  DIRECTION_NOT_APPROVED:'Это направление пока не подтверждено. Обратитесь в поддержку без резервирования средств.',
  CUSTOMER_REVIEW_REQUIRED:'Для обмена нужны подтверждённые KYC и проверка клиента оператором OTC.',
  INSUFFICIENT_BALANCE:'Недостаточно доступных средств. Пополните обычный баланс и обновите его вручную.',
  PRICE_UNAVAILABLE:'Свежая оценка актива недоступна. Создание заявки не разрешено.',
  BELOW_OTC_MINIMUM:'Сумма ниже минимального объёма выбранной категории OTC.',
  ACTIVE_REQUEST_LIMIT:'Достигнут лимит активных заявок.', VERSION_CHANGED:'Заявка изменилась. Обновите её и проверьте условия заново.',
  OFFER_CHANGED:'Предложение изменилось. Примите новую версию явно.', OFFER_EXPIRED:'Предложение истекло. Запросите новую версию у оператора.',
  INVALID_STATE:'Действие недоступно в текущем состоянии заявки.', INVALID_INPUT:'Проверьте заполненные поля.', INVALID_DECIMAL:'Проверьте количество и точность актива.',
  RESULT_UNKNOWN_CHECK_ORIGINAL_KEY:'Результат операции уточняется. Проверьте исходную попытку; не создавайте новую.',
  IDEMPOTENCY_MISMATCH:'Параметры исходной попытки отличаются. Новая операция не выполнена.',
  WALLET_RECONCILIATION_REQUIRED:'Резервы счёта требуют сверки оператором. Новая заявка недоступна.',
  LEGACY_ORDER_RECONCILIATION_REQUIRED:'Существующие ордера требуют сверки. Новая заявка недоступна.',
  SESSION_REQUIRED:'Войдите в аккаунт заново.', ACCESS_DENIED:'Доступ запрещён.', NOT_FOUND:'Заявка не найдена или недоступна.',
  PAYOUT_BLOCKED:'Начало выдачи заблокировано запросом отмены или изменёнными условиями.',
};
export function cashError(error: unknown): string {
  return error instanceof Error && ERRORS[error.message] || 'Не удалось подтвердить результат. Обновите данные или проверьте исходную попытку.';
}
export function rejectedCreate(error: unknown): boolean {
  return error instanceof ApiError && error.status < 500 && [
    'INVALID_INPUT','INVALID_DECIMAL','DIRECTION_NOT_APPROVED','CUSTOMER_REVIEW_REQUIRED','INSUFFICIENT_BALANCE',
    'BELOW_OTC_MINIMUM','ACTIVE_REQUEST_LIMIT','WALLET_RECONCILIATION_REQUIRED','LEGACY_ORDER_RECONCILIATION_REQUIRED',
  ].includes(error.message);
}
export async function cashRequest<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const data = await request<T>(path, { ...(body === undefined ? {} : { method:'POST',body:JSON.stringify(body) }), signal:AbortSignal.timeout(25000) });
  // request() checks before JSON parsing; also guard a session change during it.
  if (getToken() !== token) throw new DOMException('Session changed','AbortError');
  return data;
}
/** Only a namespace for an account-bound local draft, NEVER authentication. */
export function cashDraftKey(token: string | null): string | null {
  try { const userId = JSON.parse(atob((token ?? '').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
    return typeof userId === 'string' ? `voltex:otc-draft:v1:${encodeURIComponent(userId)}` : null;
  } catch { return null; }
}
