import fs from 'node:fs';
import path from 'node:path';
import { spotPeriodReturn } from '../spotPeriodReturns';
import { filterAndSortPairs, type TickerRow } from '../pairList';
import { reviewReadPath } from '../reviewPolicy';

const now = Date.UTC(2026, 8, 6, 12, 7);
const periodEnd = Math.floor(now / 1000 / 900) * 900;
const rows: TickerRow[] = [
  { pair: 'AAA/USD', lastPrice: '120', changePercent24h: '999', quoteVolume24h: '100' },
  { pair: 'BBB/USD', lastPrice: '80', changePercent24h: '-999', quoteVolume24h: '200' },
  { pair: 'CCC/USD', lastPrice: '100', changePercent24h: '888', quoteVolume24h: '300' },
  { pair: 'DDD/EUR', lastPrice: '101', changePercent24h: '777', quoteVolume24h: '400' },
];
const options = { search: '', quoteFilter: null, favoritesOnly: false, favorites: new Set<string>(), sortField: 'change' as const };

test.each(['24H', '7D'] as const)('%s uses actual last/reference -1, not UTC-open or high-low range', period => {
  const reference = { price: 100, time: periodEnd - (period === '7D' ? 7 : 1) * 86400 };
  expect(spotPeriodReturn('120', reference, period, now)).toBeCloseTo(20);
  expect(spotPeriodReturn('80', reference, period, now)).toBeCloseTo(-20);
  expect(spotPeriodReturn('100', reference, period, now)).toBe(0);
});
test('missing and stale7d never falls back to24h or zero', () => {
  expect(spotPeriodReturn('100', null, '7D', now)).toBeNull();
  expect(spotPeriodReturn('100', { price: 90, time: periodEnd - 86400 }, '7D', now)).toBeNull();
  expect(spotPeriodReturn('100', { price: 90, time: periodEnd - 7 * 86400 - 900 }, '7D', now)).toBeNull();
});
test.each(['', 'NaN', '-1', '0', 'Infinity'])('invalid current price %s remains unavailable', price => {
  expect(spotPeriodReturn(price, { price: 100, time: periodEnd - 86400 }, '24H', now)).toBeNull();
});
test('raw precision and large real gains/losses are never capped', () => {
  expect(spotPeriodReturn(325.456789, { price: 100, time: periodEnd - 7 * 86400 }, '7D', now)).toBeCloseTo(225.456789, 9);
  expect(spotPeriodReturn(2, { price: 100, time: periodEnd - 7 * 86400 }, '7D', now)).toBe(-98);
});
test('selectedperiod gainers/losers sort by actual values with missing rows always last', () => {
  const changeByPair = new Map<string, number | null>([['AAA/USD', 20], ['BBB/USD', -20], ['CCC/USD', null], ['DDD/EUR', 1]]);
  expect(filterAndSortPairs(rows, { ...options, changeByPair, sortDir: -1 }).map(row => row.pair)).toEqual(['AAA/USD', 'DDD/EUR', 'BBB/USD', 'CCC/USD']);
  expect(filterAndSortPairs(rows, { ...options, changeByPair, sortDir: 1 }).map(row => row.pair)).toEqual(['BBB/USD', 'DDD/EUR', 'AAA/USD', 'CCC/USD']);
});
test('search and Favorites preserve selectedperiod/direction and never mutate input or selectedpair', () => {
  const original = JSON.stringify(rows);
  const favorites = new Set(['AAA/USD', 'BBB/USD', 'DDD/EUR']);
  const changeByPair = new Map([['AAA/USD', 20], ['BBB/USD', -20], ['DDD/EUR', 1]]);
  const mode = { ...options, quoteFilter: 'USD', favoritesOnly: true, favorites, changeByPair, sortDir: 1 as const };
  expect(filterAndSortPairs(rows, mode).map(row => row.pair)).toEqual(['BBB/USD', 'AAA/USD']);
  expect(filterAndSortPairs(rows, { ...mode, search: 'DDD' }).map(row => row.pair)).toEqual(['DDD/EUR']);
  expect(mode.sortDir).toBe(1); expect(JSON.stringify(rows)).toBe(original);
});
test('review reference route is own-origin GET only, not a new browser provider request', () => {
  const route = '/market/external/period-references?pairs=BTC%2FUSD%2CETH%2FUSD';
  expect(reviewReadPath(route)).toBe('/review-api' + route);
  expect(reviewReadPath(route, 'POST')).toBeNull();
  expect(reviewReadPath(route + '&url=https://example.com')).toBeNull();
  expect(reviewReadPath('/market/external/period-references?pairs=BTC%2FUSD&pairs=ETH%2FUSD')).toBeNull();
  const hook = fs.readFileSync(path.resolve(__dirname, '../useSpotPeriodReferences.ts'), 'utf8');
  expect(hook).toContain('api.getSpotPeriodReferences');
  expect(hook).not.toMatch(/https?:\/\/|fetch\(/);
});
test('Spot controls are opt-in and period state is not reset by search/favorites changes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/PairListSidebar.tsx'), 'utf8');
  expect(source).toContain('periodControls = false');
  expect(source).toContain("useState<SpotReturnPeriod>('24H')");
  expect(source.match(/setReturnPeriod\(period\)/g)).toHaveLength(1);
  expect(source).toContain('data-reference-price');
  expect(source).toContain("change === null ? '—'");
});
