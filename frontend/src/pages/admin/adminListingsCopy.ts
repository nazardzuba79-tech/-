/** Russian presentation only. Stored profile IDs, zones and request values stay unchanged. */
export const LISTING_PROFILE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  CALM_TREND: 'Спокойный тренд',
  IMPULSE_TREND: 'Импульсный тренд',
  PULLBACK_TREND: 'Тренд с откатами',
  COMPRESSION_BREAKOUT: 'Сжатие и пробой',
});

const TIME_ZONE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'Europe/Kyiv': 'Киев',
  UTC: 'Всемирное время',
  'Europe/Moscow': 'Москва',
  'Europe/Warsaw': 'Варшава',
  'Europe/London': 'Лондон',
  'Asia/Dubai': 'Дубай',
  'America/New_York': 'Нью-Йорк',
});

export function listingTimeZoneLabel(zone: string): string {
  return TIME_ZONE_LABELS[zone] ?? 'Другой часовой пояс';
}

export function listingProfileLabel(profile: string): string {
  return LISTING_PROFILE_LABELS[profile] ?? 'Неизвестный профиль симуляции';
}

export const LISTING_REVISION_CONFLICT = 'Черновик уже изменён в другом окне или другим администратором. Обновите список и повторите.';

const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  revision_conflict: LISTING_REVISION_CONFLICT,
  DRAFT_REVISION_REQUIRED: 'Обновите список и снова откройте черновик: не указана его текущая версия.',
  STORE_NOT_CONFIGURED: 'Листинги не подключены: хранилище Cloudflare не настроено на сервере. Создание и публикация недоступны.',
  STORE_AUTH_FAILED: 'Листинги не подключены: ключи хранилища на сервере и в Cloudflare не совпадают. Создание и публикация недоступны.',
  RESERVED_TICKER: 'Этот тикер зарезервирован. Выберите другой.',
  TICKER_ON_MARKET: 'Такая торговая пара уже существует. Выберите другой тикер.',
  TICKER_LOCKED: 'Тикер опубликованного листинга нельзя изменить.',
  HISTORY_LOCKED: 'Эти параметры уже зафиксированы для защиты опубликованной истории цен. Обновите список и восстановите сохранённые значения.',
  LOGO_TOO_LARGE: 'Логотип не должен превышать 64 КБ.',
  LISTING_TIME_PAST: 'Укажите будущее время листинга с учётом минимального интервала до публикации.',
  LISTING_TIME_TOO_FAR: 'Дата листинга должна быть в пределах ближайшего года.',
  INVALID_PUBLISH_REQUEST: 'Не удалось подготовить публикацию. Обновите список и заново откройте подтверждение.',
  not_found: 'Листинг не найден. Обновите список.',
  unsupported_interval: 'Этот интервал графика недоступен. Выберите другой.',
});

const INVALID_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  symbol: 'Тикер: от 2 до 10 латинских букв или цифр; первый символ — буква.',
  name: 'Название: от 2 до 40 символов, без угловых скобок и управляющих символов.',
  logo: 'Выберите логотип в формате PNG, JPEG, WebP или SVG размером до 64 КБ.',
  initialPrice: 'Начальная цена: положительное число не больше 1 000 000, до 10 знаков после запятой.',
  ownerAllocation: 'Количество токенов для владельца: неотрицательное число, до 18 цифр в целой части и до 8 после запятой.',
  listingAt: 'Проверьте дату и время листинга.',
  displayTimeZone: 'Выберите допустимый часовой пояс.',
  seed: 'Код генерации: от 8 до 64 строчных латинских букв, цифр или дефисов; первый символ — буква или цифра.',
  seedMode: 'Выберите автоматический или ручной режим кода генерации.',
  tradable: 'Проверьте настройку спотовой торговли.',
  simulationProfile: 'Профиль симуляции назначается сервером и не редактируется в этой форме.',
});

/** Never echo a server stack, HTML or English error into the form. Codes stay on the original error object. */
export function listingRequestError(error: { status: number; code: string | null; message: string }): string {
  const { status, code } = error;
  if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  if (code === 'INVALID_CONFIG') {
    const field = error.message.split(':', 1)[0].trim();
    return Object.prototype.hasOwnProperty.call(INVALID_FIELDS, field)
      ? INVALID_FIELDS[field]
      : 'Проверьте заполнение полей листинга. Сервер отклонил параметры.';
  }
  if (status === 401) return 'Сессия администратора истекла или недоступна. Войдите снова.';
  if (status === 403) return 'Недостаточно прав для управления листингами.';
  if (status === 409) return 'Данные изменились или конфликтуют с сохранёнными. Обновите список перед повторной попыткой.';
  if (status === 0 || code === 'NETWORK') return 'Нет подтверждения от сервера. Обновите список и проверьте результат перед повторной попыткой.';
  if (status >= 500) return 'Сервис листингов временно недоступен. Результат операции не подтверждён: проверьте список после восстановления связи.';
  return 'Не удалось выполнить запрос. Проверьте поля и обновите список перед повторной попыткой.';
}
