export interface CurrencyItem {
  code: string;
  name: string;
}

// Fiat currencies supported by the VOLTEX Card.
export const fiatCurrencies: CurrencyItem[] = [
{ code: 'USD', name: 'Доллар США' },
{ code: 'EUR', name: 'Евро' },
{ code: 'GBP', name: 'Фунт стерлингов' },
{ code: 'CHF', name: 'Швейцарский франк' },
{ code: 'RUB', name: 'Российский рубль' },
{ code: 'CNY', name: 'Китайский юань' }];


// Crypto assets supported by the VOLTEX Card.
export const cryptoCurrencies: CurrencyItem[] = [
{ code: 'BTC', name: 'Bitcoin' },
{ code: 'ETH', name: 'Ethereum' },
{ code: 'USDT', name: 'Tether' },
{ code: 'TON', name: 'Toncoin' },
{ code: 'TRX', name: 'TRON' }];
