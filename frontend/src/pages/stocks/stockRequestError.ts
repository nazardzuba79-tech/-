// The transport carries a bounded code; server text and runtime messages never render.
export class StockRequestError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    super('Stock request failed');
    this.code = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,64}$/.test(code) ? code : 'LOCAL_SERVICE_ERROR';
  }
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Войдите, чтобы открыть свой тестовый счёт', AUTH_UNAVAILABLE: 'Проверка сессии временно недоступна',
  MOEX_UNVERIFIED: 'MOEX: реальные данные пока не подтверждены. Торговля заблокирована', SOURCE_BUSY: 'Источник занят — повторите запрос',
  SOURCE_DNS_UNAVAILABLE: 'Источник котировок сейчас недоступен', SOURCE_UNAVAILABLE: 'Источник данных недоступен',
  QUOTE_UNAVAILABLE: 'Подтверждённой цены нет', QUOTE_STALE: 'Котировка устарела — исполнение приостановлено',
  MARKET_CLOSED: 'Торговая сессия закрыта', FX_UNAVAILABLE: 'Нет подтверждённого курса пересчёта', FX_STALE: 'Курс пересчёта устарел',
  INSTRUMENT_UNVERIFIED: 'Инструмент пока не подтверждён источником', INSUFFICIENT_FUNDS: 'Недостаточно свободных тестовых средств',
  INSUFFICIENT_SHARES: 'Недостаточно свободных акций / токенов', RESERVED_FUNDS: 'Баланс не может быть ниже резерва',
  LOCAL_SERVICE_ERROR: 'Нет связи с тестовым счётом', INVALID_DECIMAL: 'Не более 8 знаков после запятой',
  INVALID_AMOUNT: 'Недопустимая сумма', RATE_LIMIT: 'Лимит запросов источника', TOKEN_REQUIRED: 'Обновите страницу и повторите запрос',
};
export function globalStockErrorText(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code] : 'Не удалось выполнить запрос. Повторите попытку.';
}
