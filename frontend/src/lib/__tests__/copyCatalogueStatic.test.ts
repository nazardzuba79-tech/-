import { createHash } from 'crypto';
import { marketplaceTraders, getCopierProfit, getTraderEarnings, PERIODS } from '../../pages/copy-trading-bolt/traders';

const profits = (model: typeof import('../../pages/copy-trading-bolt/traders')) => model.marketplaceTraders
  .map(trader => [trader.id, ...PERIODS.map(period => model.getCopierProfit(trader, period))]);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Captured by executing the unmodified main (2e7acf15) with Date.now fixed to
// 2026-10-17. All 30 aliases × 4 periods, including negative returns.
const APPROVED_PROFITS = 'd9c7661f2975fe25cd031d5d34693d072e93d1cf5d9d2d7a662a8e4a4d2078e5';

afterEach(() => jest.restoreAllMocks());

test.each(['2026-10-17', '2026-10-18', '2026-10-22', '2027-01-01'])('catalogue snapshot is unchanged on %s and after module restart', day => {
  const before = JSON.stringify(marketplaceTraders);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${day}T12:00:00Z`));
  expect(digest(marketplaceTraders.map(t => [t.id, ...PERIODS.map(p => getCopierProfit(t, p))]))).toBe(APPROVED_PROFITS);
  const earnings = marketplaceTraders.map(t => PERIODS.map(p => getTraderEarnings(t, p)));
  jest.resetModules();
  const restarted = require('../../pages/copy-trading-bolt/traders') as typeof import('../../pages/copy-trading-bolt/traders');
  expect(digest(profits(restarted))).toBe(APPROVED_PROFITS);
  expect(restarted.marketplaceTraders.map(t => PERIODS.map(p => restarted.getTraderEarnings(t, p)))).toEqual(earnings);
  expect(JSON.stringify(restarted.marketplaceTraders)).toBe(before);
  expect(JSON.stringify(marketplaceTraders)).toBe(before);
});
