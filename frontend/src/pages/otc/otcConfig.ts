/**
 * OTC page data, from the owner's approved design (OTC.zip, 2026-09-30,
 * lib/otc/config.ts). Tiers, the two currency lists and the country
 * directory; nothing here prices, routes or executes anything.
 */

export type TierId = 'otc-convert' | 'cash-exchange' | 'private-otc';

export interface OtcTier {
  id: TierId;
  name: string;
  minUsd: number;
  accent?: boolean;
}

export const TIERS: readonly OtcTier[] = [
  { id: 'otc-convert', name: 'OTC Convert', minUsd: 10_000 },
  { id: 'cash-exchange', name: 'Cash Exchange', minUsd: 50_000, accent: true },
  { id: 'private-otc', name: 'Private OTC', minUsd: 100_000 },
];

export type CurrencyKind = 'fiat' | 'crypto';
export interface OtcCurrency { code: string; kind: CurrencyKind }

export const FIAT_CURRENCIES: readonly OtcCurrency[] = [
  'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AED', 'RUB', 'CHF', 'UAH', 'KZT', 'BYN', 'CAD', 'AUD', 'CNY', 'HKD', 'PLN', 'TRY',
].map((code) => ({ code, kind: 'fiat' as const }));

export const CRYPTO_CURRENCIES: readonly OtcCurrency[] = ['USDT', 'USDC', 'BTC', 'ETH'].map((code) => ({ code, kind: 'crypto' as const }));

/** «Отдаёте» — crypto and fiat. «Получаете» — fiat only. */
export const FROM_CURRENCIES: readonly OtcCurrency[] = [...CRYPTO_CURRENCIES, ...FIAT_CURRENCIES];
export const TO_CURRENCIES: readonly OtcCurrency[] = FIAT_CURRENCIES;

/** Pairs the form can express: every «from» against every other «to». */
export const PAIR_COUNT = FROM_CURRENCIES.reduce(
  (n, from) => n + TO_CURRENCIES.filter((to) => to.code !== from.code).length, 0,
);

/**
 * The country directory for the Cash Exchange selector, as ISO 3166 codes so
 * every language names them itself (Intl.DisplayNames). A reference list
 * only: it does not imply an office, a partner or confirmed cash pickup in
 * any of these countries — availability is confirmed by the manager per
 * request, as the page says. The design's 62 countries come first; the rest
 * make its «100+ стран в справочнике» true.
 */
export const COUNTRY_CODES: readonly string[] = [
  'RU', 'KZ', 'UA', 'BY', 'CH', 'AE', 'TR', 'PL', 'DE', 'FR', 'IT', 'ES', 'GB', 'CZ', 'AT', 'NL', 'PT', 'GR', 'CY', 'RO',
  'BG', 'MD', 'GE', 'AM', 'AZ', 'UZ', 'KG', 'US', 'CA', 'AU', 'SG', 'TH', 'ID', 'MY', 'CN', 'HK', 'JP', 'KR', 'VN', 'PH',
  'IN', 'PK', 'BD', 'LK', 'NP', 'MN', 'TW', 'KH', 'LA', 'MM', 'BN', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IL', 'IQ',
  'YE', 'EG',
  'BE', 'SE', 'NO', 'DK', 'FI', 'IE', 'LU', 'HU', 'SK', 'SI', 'HR', 'RS', 'EE', 'LV', 'LT', 'IS', 'MT', 'ME', 'AL', 'MK',
  'BA', 'MC', 'LI', 'AD', 'TJ', 'TM', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'PA', 'CR', 'DO', 'NZ', 'ZA', 'NG', 'KE',
  'MA', 'TN', 'GH', 'MV', 'MU', 'SC',
];

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** What every CTA hands to the deposit flow: the chosen parameters only. */
export interface OtcRequest {
  tier: TierId;
  country?: string;
  fromCurrency: string;
  toCurrency: string;
  amount: string;
}
