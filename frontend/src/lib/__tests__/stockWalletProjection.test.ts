import { stockPortfolioRows } from '../../pages/wallet-v3/stockPortfolio';

const payload = (currency: string, ageMs = 0) => {
  const at = Date.now();
  return {
    schema: 2, account: { id: 'only-current-owner', mode: 'isolated-paper' },
    catalogue: [{ id: 'BYBIT:AAPLXUSDT', asset: 'AAPLX', ticker: 'AAPL', name: 'Apple' }],
    positions: { one: { instrumentId: 'BYBIT:AAPLXUSDT', currency, quantity: '2.00000000', available: '1.00000000',
      reserved: '1.00000000', average: '100.00000000', mark: '110.00000000', unrealized: '20.00000000', realized: '0' } },
    quotes: { 'BYBIT:AAPLXUSDT': { timestamp: at-ageMs, status: { USDT: 'READY' }, prices: { USDT: { sell: '109.00000000' } } } },
  };
};

test('USDT holdings appear with crypto rows without becoming USD spendable collateral', () => {
  const rows = stockPortfolioRows(payload('USDT'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ symbol: 'AAPLX', total: 2, available: 1, locked: 1,
    spendable: false, collateralEnabled: false, collateralToggleable: false,
    valueUsd: null, priceUsd: null, stockPosition: { valueUSDT: 218, entryUSDT: 100 } });
});
test('historic USDC positions never enter USDT-only projection', () => {
  expect(stockPortfolioRows(payload('USDC'))).toEqual([]);
});
test('stale prices never enter USD valuation', () => {
  const rows = stockPortfolioRows(payload('USDT', 60000));
  expect(rows[0].stockPosition?.valueUSDT).toBeNull();
  expect(rows[0].valueUsd).toBeNull();
});
test('untrusted, anonymous and malformed responses produce no wallet rows', () => {
  expect(stockPortfolioRows({ schema: 2, positions: {} })).toEqual([]);
  expect(stockPortfolioRows(null)).toEqual([]);
  expect(stockPortfolioRows({ ...payload('USDT'), account: null })).toEqual([]);
});
