import type { Lang } from '../../../lib/i18n';
import { STOCK_MESSAGES } from './stockMessages';

export type StockMessage = keyof typeof STOCK_MESSAGES;
export type StockParams = Record<string, string | number | null | undefined>;
export type StockTranslator = (message: StockMessage, params?: StockParams) => string;
const columns: Record<Exclude<Lang, 'ru'>, number> = { en: 0, es: 1, zh: 2, hi: 3, ja: 4, ko: 5 };
// A bounded, Stocks-only table uses the existing language selection. Static
// loading preserves mounted forms/dialogs while the shared provider changes lang.
export function stockText(lang: Lang, message: StockMessage, params: StockParams = {}): string {
  const text = lang === 'ru' ? message : STOCK_MESSAGES[message][columns[lang]];
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token);
}
export function stockTranslator(lang: Lang): StockTranslator { return (message, params) => stockText(lang, message, params); }
export function stockOrderLabel(status: string, s: StockTranslator): string {
  const labels: Record<string, StockMessage> = { OPEN: 'Открыт', PARTIAL: 'Частично исполнен', FILLED: 'Исполнен', CANCELLED: 'Отменён', PARTIAL_CANCELLED: 'Исполнен частично, остаток отменён' };
  return Object.prototype.hasOwnProperty.call(labels, status) ? s(labels[status]) : status;
}
export type StockNotice = { kind: 'order'; status: string; filled: string; asset: string } | { kind: 'text'; message: 'Остаток заявки отменён' | 'Баланс обновлён; история сохранена' };
export function stockNoticeText(notice: StockNotice, s: StockTranslator): string {
  return notice.kind === 'text' ? s(notice.message) : stockOrderLabel(notice.status, s) + ' · ' + notice.filled + ' ' + notice.asset;
}

// Presentation-only allowlist. Preserve native attribution and unknown policy text.
export function stockFxPolicyText(policy: string | undefined, s: StockTranslator): string | undefined {
  const known: Record<string, StockMessage> = {
    'observed USDT per USDC': 'Наблюдаемый курс USDT за USDC',
    'daily official reference, not live RUB FX': 'Официальный дневной справочный курс, не текущий курс RUB',
    'RUB per USDC: daily reference × observed stablecoin legs': 'RUB за USDC: дневной справочный курс × наблюдаемые курсы стейблкоинов',
  };
  return policy !== undefined && Object.prototype.hasOwnProperty.call(known, policy) ? s(known[policy]) : policy;
}
