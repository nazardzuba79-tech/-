import {
  HOME_COPY_TRADERS,
  HOME_COPY_TRADER_IDS,
  HOME_INSTITUTION_NAMES,
} from '../../pages/home/homeContent';
import { marketplaceTraders } from '../../pages/copy-trading-bolt/traders';

describe('homepage product presentation', () => {
  it('uses existing Copy Trading strategies rather than a parallel trader model', () => {
    expect(HOME_COPY_TRADERS).toHaveLength(4);
    expect(HOME_COPY_TRADERS.map((trader) => trader.id)).toEqual([...HOME_COPY_TRADER_IDS]);

    for (const trader of HOME_COPY_TRADERS) {
      expect(marketplaceTraders.find((candidate) => candidate.id === trader.id)).toBe(trader);
      expect(trader.roiAll).toBeGreaterThan(0);
      expect(trader.copiers).toBeGreaterThan(0);
      expect(trader.aum).toBeGreaterThan(0);
    }
  });

  it('keeps the requested institutional reference set complete and unique', () => {
    expect(HOME_INSTITUTION_NAMES).toEqual([
      'Nasdaq',
      'NYSE',
      'CME Group',
      'Interactive Brokers',
      'Saxo Bank',
      'UBS Switzerland',
    ]);
    expect(new Set(HOME_INSTITUTION_NAMES).size).toBe(HOME_INSTITUTION_NAMES.length);
  });
});
