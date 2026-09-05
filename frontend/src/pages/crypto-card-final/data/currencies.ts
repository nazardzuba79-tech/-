import type { CardCopy } from './cardCopy.ru';

export interface CurrencyItem {
  code: string;
  name: string;
  nameKey?: keyof CardCopy;
}

// Fiat currencies supported by the VOLTEX Card.
export const fiatCurrencies: CurrencyItem[] = [
{ code: 'USD', name: 'USD', nameKey: 'fiatUsd' },
{ code: 'EUR', name: 'EUR', nameKey: 'fiatEur' },
{ code: 'GBP', name: 'GBP', nameKey: 'fiatGbp' },
{ code: 'CHF', name: 'CHF', nameKey: 'fiatChf' },
{ code: 'RUB', name: 'RUB', nameKey: 'fiatRub' },
{ code: 'CNY', name: 'CNY', nameKey: 'fiatCny' }];


// Crypto assets supported by the VOLTEX Card.
export const cryptoCurrencies: CurrencyItem[] = [
{ code: 'BTC', name: 'Bitcoin' },
{ code: 'ETH', name: 'Ethereum' },
{ code: 'USDT', name: 'Tether' },
{ code: 'TON', name: 'Toncoin' },
{ code: 'TRX', name: 'TRON' }];
