import type { Lang } from '../../../lib/i18n';

/**
 * Copy the institutional homepage proposal adds on top of the existing
 * `home.*` keys. Russian and English are written out; the other languages
 * fall back to English until the proposal is approved and translated.
 */
const en = {
  boardTitle: 'Markets now',
  boardCrypto: 'Crypto',
  boardCfd: 'Commodities and indices · CFD',
  high: '24h high',
  low: '24h low',
  volume: '24h volume',
  openPair: 'Open terminal',
  chartUnavailable: 'Chart is loading',
  statCap: 'Crypto market cap',
  statVolume: '24h market volume',
  statDominance: 'BTC dominance',
  statFearGreed: 'Fear & Greed',
  statPairs: 'Pairs on VOLTEX',
  fearGreed: { 'Extreme Fear': 'Extreme fear', Fear: 'Fear', Neutral: 'Neutral', Greed: 'Greed', 'Extreme Greed': 'Extreme greed' } as Record<string, string>,
  marketsLead: 'Sorted by 24-hour trading volume.',
  sevenDays: '7d',
  productsLabel: 'Products',
  productsTitle: 'One account for every market',
  products: {
    spot: 'Buy and sell crypto with market and limit orders.',
    futures: 'Perpetual contracts with leverage and risk controls.',
    copy: 'Follow the strategies of experienced traders on the platform.',
    card: 'Pay with crypto in stores and online.',
    otc: 'Large trades at an agreed price.',
    arbitrage: 'Price gaps between venues in one view.',
  },
  reachLabel: 'Coverage',
  reachCrypto: 'crypto pairs on spot',
  reachFutures: 'perpetual futures',
  reachCfd: 'CFD instruments',
  reachCfdWhat: 'gold, oil, indices, FX',
  reachHours: 'crypto trading',
  reachHoursValue: '24/7',
  cardLabel: 'Card',
};

const ru: typeof en = {
  boardTitle: 'Рынки сейчас',
  boardCrypto: 'Криптовалюты',
  boardCfd: 'Сырьё и индексы · CFD',
  high: 'Макс. 24ч',
  low: 'Мин. 24ч',
  volume: 'Объём 24ч',
  openPair: 'Открыть терминал',
  chartUnavailable: 'График загружается',
  statCap: 'Капитализация рынка',
  statVolume: 'Объём рынка за 24ч',
  statDominance: 'Доминация BTC',
  statFearGreed: 'Страх и жадность',
  statPairs: 'Пар на VOLTEX',
  fearGreed: { 'Extreme Fear': 'Крайний страх', Fear: 'Страх', Neutral: 'Нейтрально', Greed: 'Жадность', 'Extreme Greed': 'Крайняя жадность' },
  marketsLead: 'По объёму торгов за 24 часа.',
  sevenDays: '7д',
  productsLabel: 'Продукты',
  productsTitle: 'Один аккаунт для всех рынков',
  products: {
    spot: 'Покупка и продажа криптовалют рыночными и лимитными ордерами.',
    futures: 'Бессрочные контракты с кредитным плечом и контролем риска.',
    copy: 'Следуйте стратегиям опытных трейдеров платформы.',
    card: 'Оплата криптовалютой в магазинах и онлайн.',
    otc: 'Крупные сделки по согласованной цене.',
    arbitrage: 'Разница цен между площадками в одном окне.',
  },
  reachLabel: 'Охват',
  reachCrypto: 'криптопар на споте',
  reachFutures: 'бессрочных фьючерсов',
  reachCfd: 'инструментов CFD',
  reachCfdWhat: 'золото, нефть, индексы, валюты',
  reachHours: 'торговля криптовалютой',
  reachHoursValue: '24/7',
  cardLabel: 'Карта',
};

export const ixCopy: Record<Lang, typeof en> = { en, ru, es: en, zh: en, hi: en, ja: en, ko: en };
