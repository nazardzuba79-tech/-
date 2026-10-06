/** Russian presentation only. Stored profile IDs, zones and request values stay unchanged. */
export const LISTING_PROFILE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  CALM_TREND: 'Спокойный тренд',
  IMPULSE_TREND: 'Импульсный тренд',
  PULLBACK_TREND: 'Тренд с откатами',
  COMPRESSION_BREAKOUT: 'Сжатие и пробой',
});

const TIME_ZONE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'Europe/Kyiv': 'Киев',
  UTC: 'Всемирное время (UTC)',
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
  return LISTING_PROFILE_LABELS[profile] ?? 'Неизвестный характер движения';
}

export const LISTING_REVISION_CONFLICT = 'Черновик уже изменён в другом окне или другим администратором. Обновите список и повторите.';

const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  revision_conflict: LISTING_REVISION_CONFLICT,
  DRAFT_REVISION_REQUIRED: 'Обновите список и снова откройте черновик: не указана его текущая версия.',
  STORE_NOT_CONFIGURED: 'Листинги не подключены: хранилище Cloudflare не настроено на сервере. Создание и публикация недоступны.',
  STORE_AUTH_FAILED: 'Листинги не подключены: ключ хранилища на сервере и в Cloudflare не совпадает. Создание и публикация недоступны.',
  RESERVED_TICKER: 'Этот тикер зарезервирован. Выберите другой.',
  TICKER_ON_MARKET: 'Такая торговая пара уже существует. Выберите другой тикер.',
  TICKER_LOCKED: 'Тикер опубликованного листинга нельзя изменить.',
  HISTORY_LOCKED: 'Эти параметры уже зафиксированы для защиты опубликованной истории цен. Обновите список и восстановите сохранённые значения.',
  LOGO_TOO_LARGE: 'Логотип не должен превышать 64 КБ.',
  LISTING_TIME_PAST: 'Дата запуска уже прошла или слишком близка. Укажите будущее время с запасом для публикации.',
  LISTING_TIME_TOO_FAR: 'Дата листинга должна быть в пределах ближайшего года.',
  INVALID_PUBLISH_REQUEST: 'Не удалось подготовить публикацию. Обновите список и заново откройте подтверждение.',
  not_found: 'Листинг не найден. Обновите список.',
  unsupported_interval: 'Этот интервал графика недоступен. Выберите другой.',
  PREVIEW_INTERVAL_TOO_FINE: 'В выбранном отрезке больше 360 свечей. Выберите более крупный интервал.',
  INVALID_PREVIEW_HORIZON: 'Выберите доступный период предпросмотра.',
  DEMO_ONLY: 'Для ограниченного демонстрационного сценария исполнение заявок недоступно.',
});

const INVALID_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  symbol: 'Тикер: от 2 до 10 латинских букв или цифр; первый символ — буква.',
  name: 'Название: от 2 до 40 символов, без угловых скобок и управляющих символов.',
  logo: 'Выберите логотип в формате PNG, JPEG, WebP или SVG размером до 64 КБ.',
  initialPrice: 'Начальная цена: положительное число не больше 1 000 000, до 10 знаков после запятой.',
  ownerAllocation: 'Количество токенов для владельца: неотрицательное число, до 18 цифр в целой части и до 8 после запятой.',
  listingAt: 'Проверьте дату и время листинга.',
  displayTimeZone: 'Выберите допустимый часовой пояс.',
  seed: 'Код варианта: от 8 до 64 строчных латинских букв, цифр или дефисов; первый символ — буква или цифра.',
  seedMode: 'Выберите автоматический или ручной режим кода варианта.',
  tradable: 'Проверьте настройку спотовой торговли.',
  simulationProfile: 'Прежний характер свечей назначается сервером и не редактируется в этой форме.',
  simulationProgram: 'Не удалось сохранить настройки. Изменения не применены. Проверьте движение цены, этапы и точную настройку свечей.',
});

// Only known validation text may cross the API/UI boundary. Never display arbitrary diagnostics.
const MOVEMENT_ERRORS = [
  'Введите положительное число, не более 10 знаков после запятой',
  'Максимальная цена должна быть выше начальной цены',
  'Цель за первые сутки выше максимальной цены',
  'Рост за первые сутки должен быть больше нуля и не выше 100000%',
  'Минимальная глубина отката не может быть больше максимальной',
  'Цель этапа должна оставлять не менее 3% до максимальной цены для колебаний и теней',
  'Цена в конце роста или восстановления должна быть выше цены в начале этапа',
  'Для боковика цена в начале и конце этапа должна совпадать',
  'Цена в конце отката должна быть ниже цены в начале этапа',
  'Цель этапа в конце первых суток не совпадает с ростом за первые 24 часа',
  'Один из этапов должен заканчиваться ровно через 24 часа с целью первых суток',
  'Общая продолжительность роста должна быть от 24 до 720 часов',
  'Время запуска должно совпадать с границей 10 секунд',
] as const;

/** Never echo a server stack, HTML or English error into the form. Codes stay on the original error object. */
export function listingRequestError(error: { status: number; code: string | null; message: string }): string {
  const { status, code } = error;
  if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  if (code === 'INVALID_SCENARIO') return MOVEMENT_ERRORS.find(message => message === error.message)
    ?? 'Не удалось сохранить настройки. Изменения не применены. Проверьте движение цены и этапы.';
  if (code === 'INVALID_CONFIG') {
    const field = error.message.split(':', 1)[0].trim().split('.')[0];
    if (field === 'simulationProgram') {
      const reason = error.message.slice(error.message.indexOf(':') + 1).trim();
      const known = MOVEMENT_ERRORS.find(message => message === reason);
      if (known) return known;
    }
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
