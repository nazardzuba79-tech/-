/**
 * Stock figures. Market numbers follow VOLTEX's international convention
 * (lib/formatNumber.ts: "76,714.60" in every language); dates and words
 * follow the reader's language.
 *
 * Prices arrive as decimal strings and are printed from the string itself, so
 * nothing the provider sent is rounded away: a quote of 0.000123 stays
 * 0.000123 and 12.3456 keeps all four places. The currency only sets the
 * minimum places (ISO 4217 minor units: USD 2, JPY 0), never a cap.
 */
import { localeOf, type Lang } from '../../lib/i18n';

const DECIMAL = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/;
const minorUnits = new Map<string, number>();

/** ISO 4217 minor units of a currency, from Intl (USD 2, JPY 0); 2 when unknown. */
export function currencyDigits(currency: string): number {
  let digits = minorUnits.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().minimumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    minorUnits.set(currency, digits);
  }
  return digits;
}

/** "184.25", "38,512.7", "0.000123"; "—" for anything that is not a provider decimal. */
export function formatStockPrice(raw: string | null | undefined, currency: string): string {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return '—';
  const [whole, fraction = ''] = raw.split('.');
  const significant = fraction.replace(/0+$/, '');
  const places = Math.max(currencyDigits(currency), significant.length);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return places ? `${grouped}.${significant.padEnd(places, '0')}` : grouped;
}

/** Volume of one candle. Index volume is absent, never zero. */
export function formatStockVolume(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) return '—';
  return Number(raw).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}

/** Signed percentage, or "—" when the service did not supply one. */
export function formatStockChange(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function changeTone(value: number | null | undefined): 'up' | 'down' | 'flat' {
  return typeof value !== 'number' || !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down';
}

/** A provider timestamp in the reader's language and time zone, with the zone named. */
export function formatStockTime(ms: number | null | undefined, lang: Lang, timeZone?: string): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(localeOf(lang), {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short',
  }).format(ms);
}

/** Short date for the loaded-history span. */
export function formatStockDay(ms: number, lang: Lang, timeZone?: string): string {
  return new Intl.DateTimeFormat(localeOf(lang), { day: '2-digit', month: 'short', timeZone }).format(ms);
}

const COUNTRY_CODES: Record<string, string> = {
  'United States': 'US', Russia: 'RU', Japan: 'JP', 'Hong Kong': 'HK', China: 'CN', 'South Korea': 'KR', India: 'IN',
};

/** The catalogue's English country name in the reader's language (Intl), else as given. */
export function countryName(country: string, lang: Lang): string {
  const code = COUNTRY_CODES[country];
  if (!code) return country;
  try {
    return new Intl.DisplayNames([localeOf(lang)], { type: 'region' }).of(code) ?? country;
  } catch {
    return country;
  }
}

export function countryCode(country: string): string | null {
  return COUNTRY_CODES[country] ?? null;
}

/** Common short names of the ISO 10383 market identifiers in the catalogue. */
const EXCHANGE_NAMES: Record<string, string> = {
  XNGS: 'Nasdaq GS', XNMS: 'Nasdaq GM', XNCM: 'Nasdaq CM', XNYS: 'NYSE', PINX: 'OTC Pink', OTCB: 'OTCQB', OTCQ: 'OTCQX',
  MISX: 'MOEX', XJPX: 'JPX', XHKG: 'HKEX', XSHG: 'SSE', XSHE: 'SZSE', XKRX: 'KRX', XNSE: 'NSE', XBOM: 'BSE',
};

export function exchangeName(mic: string): string {
  return EXCHANGE_NAMES[mic] ?? mic;
}
