/**
 * Stocks UI presentation: formatting keeps every digit the service sent and
 * invents nothing; filters, favourites and chart periods describe only the
 * data actually loaded.
 */
jest.mock('../i18n', () => ({ localeOf: (lang: string) => ({ ru: 'ru-RU', en: 'en-US', ja: 'ja-JP' } as Record<string, string>)[lang] ?? 'en-US' }));

import type { StockCandle, StockInstrument } from '../stocks';
import { countryName, currencyDigits, exchangeName, formatStockChange, formatStockPrice, formatStockTime, formatStockVolume } from '../../pages/stocks/stockFormat';
import {
  chartPeriods, EMPTY_FILTERS, filterInstruments, filtersFromParams, filtersToParams, readFavorites, readLastInstrument,
  readOverviewQuery, sortInstruments, writeFavorites, writeLastInstrument,
} from '../../pages/stocks/stockModel';

const SLOT = 900000;
const candle = (open: number, close = '100'): StockCandle => ({
  openTimeUtc: open, closeTimeUtc: open + SLOT, open: '100', high: '101', low: '99', close, volume: null, fetchedAt: open + SLOT + 60000,
});
const instrument = (patch: Partial<StockInstrument>): StockInstrument => ({
  instrumentId: 'XNGS:AAPL', symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', region: 'USA', country: 'United States', exchange: 'XNGS',
  currency: 'USD', exchangeTimeZone: 'America/New_York', logoPath: null, latest: null, sessionChange: null, ...patch,
});

describe('stock price formatting', () => {
  test('keeps the provider digits and the currency minimum, never a universal cap', () => {
    expect(formatStockPrice('184.2', 'USD')).toBe('184.20');
    expect(formatStockPrice('184.2575', 'USD')).toBe('184.2575');
    expect(formatStockPrice('0.0012345', 'USD')).toBe('0.0012345');
    expect(formatStockPrice('0.000000123456', 'USD')).toBe('0.000000123456');
    expect(formatStockPrice('38512', 'JPY')).toBe('38,512');
    expect(formatStockPrice('38512.75', 'JPY')).toBe('38,512.75');
    expect(formatStockPrice('68000', 'KRW')).toBe('68,000');
    expect(formatStockPrice('1234567.5', 'RUB')).toBe('1,234,567.50');
    expect(formatStockPrice('123456789012345.123456789012', 'USD')).toBe('123,456,789,012,345.123456789012');
  });
  test('absent or malformed values are a dash, not zero', () => {
    for (const value of [null, undefined, '', 'NaN', '-1', '1e5', '01.5', ' 5']) expect(formatStockPrice(value as string, 'USD')).toBe('—');
    expect(formatStockVolume(null)).toBe('—');
    expect(formatStockVolume('125400')).toBe('125.4K');
    expect(formatStockChange(null)).toBe('—');
    expect(formatStockChange(1.234)).toBe('+1.23%');
    expect(formatStockChange(-0.5)).toBe('−0.50%');
    expect(formatStockChange(0)).toBe('0.00%');
  });
  test('minor units come from Intl, unknown currencies fall back to 2', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KRW')).toBe(0);
    expect(currencyDigits('INR')).toBe(2);
  });
  test('timestamps name their zone and come from the data, not the clock', () => {
    const close = Date.UTC(2026, 9, 7, 18, 30);
    expect(formatStockTime(close, 'en', 'America/New_York')).toMatch(/02:30 PM EDT|14:30 EDT|2:30 PM EDT/);
    expect(formatStockTime(close, 'ru', 'Asia/Tokyo')).toContain('03:30');
    expect(formatStockTime(null, 'ru')).toBe('—');
  });
  test('country and exchange labels are localised or verbatim, never invented', () => {
    expect(countryName('Japan', 'ru')).toBe('Япония');
    expect(countryName('Atlantis', 'ru')).toBe('Atlantis');
    expect(exchangeName('XNGS')).toBe('Nasdaq GS');
    expect(exchangeName('ZZZZ')).toBe('ZZZZ');
  });
});

describe('chart periods cover only loaded history', () => {
  const sessionDays = (days: number, perDay = 26) => {
    const rows: StockCandle[] = [];
    for (let day = 0; day < days; day++) for (let n = 0; n < perDay; n++) rows.push(candle(Date.UTC(2026, 8, 1 + day, 13, 30) + n * SLOT));
    return rows;
  };
  test('300 candles (about 12 US sessions) never offer a month', () => {
    const periods = chartPeriods(sessionDays(12).slice(-300), 'America/New_York');
    expect([...periods.keys()].sort()).toEqual(['1D', '5D', 'all']);
    const all = periods.get('all')!, oneDay = periods.get('1D')!;
    expect(oneDay.from).toBe(Date.UTC(2026, 8, 12, 13, 30));
    expect(oneDay.to).toBe(all.to);
  });
  test('1D/5D only when they differ from the whole loaded range; 1M only when a month is covered', () => {
    expect([...chartPeriods(sessionDays(1), 'America/New_York').keys()]).toEqual(['all']);
    expect([...chartPeriods(sessionDays(5), 'America/New_York').keys()]).toEqual(['all', '1D']);
    expect(chartPeriods(sessionDays(40, 2), 'America/New_York').has('1M')).toBe(true);
    expect(chartPeriods([], 'America/New_York').size).toBe(0);
  });
  test('days are exchange-local: a Tokyo morning and the previous UTC evening are one session', () => {
    const tokyo = [candle(Date.UTC(2026, 9, 6, 23, 0)), candle(Date.UTC(2026, 9, 7, 1, 0))];
    expect(chartPeriods(tokyo, 'Asia/Tokyo').has('1D')).toBe(false);
    expect(chartPeriods(tokyo, 'UTC').has('1D')).toBe(true);
  });
});

describe('filters, sort and saved choices', () => {
  const items = [
    instrument({}),
    instrument({ instrumentId: 'MISX:GAZP', symbol: 'GAZP', name: 'Gazprom PJSC', region: 'Russia', country: 'Russia', exchange: 'MISX', currency: 'RUB', sessionChange: -1 }),
    instrument({ instrumentId: 'XJPX:N225', symbol: 'N225', name: 'Nikkei 225', type: 'index', region: 'Asia', country: 'Japan', exchange: 'XJPX', currency: 'JPY', sessionChange: 2 }),
    instrument({ instrumentId: 'XKRX:005930', symbol: '005930', name: 'Samsung Electronics', region: 'Asia', country: 'South Korea', exchange: 'XKRX', currency: 'KRW' }),
  ];
  const none = new Set<string>();
  test('tabs, Asian market, search, exchange and currency', () => {
    const ids = (filters: Partial<typeof EMPTY_FILTERS>, favorites = none) => filterInstruments(items, { ...EMPTY_FILTERS, ...filters }, favorites).map(i => i.symbol);
    expect(ids({ tab: 'USA' })).toEqual(['AAPL']);
    expect(ids({ tab: 'index' })).toEqual(['N225']);
    expect(ids({ tab: 'Asia', asia: 'South Korea' })).toEqual(['005930']);
    expect(ids({ query: 'gaz' })).toEqual(['GAZP']);
    expect(ids({ query: 'xjpx' })).toEqual(['N225']);
    expect(ids({ currency: 'KRW' })).toEqual(['005930']);
    expect(ids({ tab: 'favorites' }, new Set(['MISX:GAZP']))).toEqual(['GAZP']);
    expect(ids({ tab: 'favorites' })).toEqual([]);
  });
  test('URL round trip keeps the overview state; unknown values fall back safely', () => {
    const filters = { tab: 'Asia' as const, query: 'sam', asia: 'South Korea', exchange: 'XKRX', currency: 'KRW' };
    const params = filtersToParams(filters);
    expect(params.get('view')).toBe('overview');
    expect(filtersFromParams(params)).toEqual(filters);
    expect(filtersFromParams(new URLSearchParams('tab=<script>&q=' + 'x'.repeat(200))).tab).toBe('all');
    expect(filtersFromParams(new URLSearchParams('q=' + 'x'.repeat(200))).query).toHaveLength(64);
  });
  test('values the service did not supply sort last either way; catalogue order is the default', () => {
    expect(sortInstruments(items, { key: 'change', dir: 'desc' }, 'en').map(i => i.symbol)).toEqual(['N225', 'GAZP', 'AAPL', '005930']);
    expect(sortInstruments(items, { key: 'change', dir: 'asc' }, 'en').map(i => i.symbol)).toEqual(['GAZP', 'N225', 'AAPL', '005930']);
    expect(sortInstruments(items, { key: 'catalogue', dir: 'asc' }, 'en')).toEqual(items);
    expect(sortInstruments(items, { key: 'name', dir: 'asc' }, 'en')[0].symbol).toBe('AAPL');
  });
  test('stored ids are validated canonical ids', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });
    try {
      store.set('voltex.stockFavorites', JSON.stringify(['XNGS:AAPL', 'idx-sp500', 42, '<img>']));
      expect(readFavorites()).toEqual(['XNGS:AAPL']);
      writeFavorites(['MISX:GAZP']);
      expect(readFavorites()).toEqual(['MISX:GAZP']);
      writeLastInstrument('not-an-id');
      expect(readLastInstrument()).toBeNull();
      writeLastInstrument('XJPX:N225');
      expect(readLastInstrument()).toBe('XJPX:N225');
      store.set('voltex.stockOverviewQuery', 'redirect=https://example.invalid');
      expect(readOverviewQuery()).toBe('view=overview');
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
    expect(readFavorites()).toEqual([]);
    expect(readLastInstrument()).toBeNull();
  });
});
