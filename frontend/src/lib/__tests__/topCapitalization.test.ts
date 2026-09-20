import { topCapitalizationAssets } from '../topCapitalization';

describe('top capitalization strip', () => {
  const asset = (symbol: string, marketCap: number | null, categories: string[] = []) => ({symbol, marketCap, categories});
  test('uses cap instead of input order/volume and excludes stablecoins before taking eight', () => {
    const coins = Array.from({length: 10}, (_, i) => asset(`COIN${i}`, 100 - i));
    const result = topCapitalizationAssets([asset('USDT', 1000, ['DEFI', 'STABLECOIN']), ...coins.reverse(), asset('USDC', 2000, ['STABLECOIN'])]);
    expect(result.map(row => row.symbol)).toEqual(Array.from({length:8}, (_, i) => `COIN${i}`));
  });
  test('unknown/invalid caps are not fabricated and duplicate symbols use the highest cap', () => {
    expect(topCapitalizationAssets([asset('BTC', 100), asset('btc', 10), asset('UNKNOWN', null), asset('INVALID', NaN), asset('ZERO', 0), asset('NEGATIVE', -1)]))
      .toEqual([asset('BTC', 100)]);
  });
});
