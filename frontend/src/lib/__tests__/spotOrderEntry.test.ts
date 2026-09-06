import BigNumber from 'bignumber.js';
import { balancePercentageQuantity, orderFundingPrice, positiveOrderNumber } from '../spotOrderEntry';
import { readFileSync } from 'fs';
import { resolve } from 'path';

test.each([null, '', '  ', 'NaN', 'Infinity', NaN, Infinity, 0, -1, '-3'])('rejects nonpositive/nonfinite input %s', value => {
  expect(positiveOrderNumber(value)).toBeNull();
});
test.each([['0.0000081', 0.0000081], ['79000', 79000], [2.5, 2.5]])('accepts actual positive numeric input %s', (value, number) => {
  expect(positiveOrderNumber(value)).toBe(number);
});

test.each([
  ['LIMIT', 'LIMIT', '100', '90', '110', '85', 123, 100],
  ['STOP', 'LIMIT', '88', '90', '110', '85', 123, 88],
  ['TAKE_PROFIT', 'LIMIT', '111', '110', '115', '85', 123, 111],
  ['MARKET', 'LIMIT', '999', '777', '110', '85', 100, 102],
  ['STOP', 'MARKET', '999', '90', '110', '85', 123, 91.8],
  ['TAKE_PROFIT', 'MARKET', '999', '110', '115', '85', 123, 112.2],
  ['OCO', 'MARKET', '999', '999', '110', '85', 123, 110],
  ['OCO', 'LIMIT', '999', '999', '90', '115', 123, 115],
] as const)('%s/%s uses the backend-compatible funding family, not a fake fee', (family, execution, price, trigger, takeProfit, stopLimit, market, expected) => {
  expect(orderFundingPrice(family, execution, price, trigger, takeProfit, stopLimit, market)).toBeCloseTo(expected, 10);
});

test('unavailable funding data cannot generate an affordable market quantity', () => {
  const funding = orderFundingPrice('MARKET', 'MARKET', '', '', '', '', null);
  expect(funding).toBe(0); expect(balancePercentageQuantity(100, 100, funding)).toBe('');
});

test.each([0.57, 1.15, 0.0000049, 0.0000081, 123.45678912345678])('conditional market BUY reserves the true decimal 2%% at trigger %s', trigger => {
  const funding = orderFundingPrice('STOP', 'MARKET', '', String(trigger), '', '', null);
  const backendFunding = new BigNumber(trigger).times('1.02');
  expect(new BigNumber(funding).gte(backendFunding)).toBe(true);
  // Any upward rounding is limited to the number representation, not a fee or
  // arbitrary safety deduction from the user's selected balance percentage.
  expect(new BigNumber(funding).minus(backendFunding).lte(backendFunding.times(Number.EPSILON * 2))).toBe(true);
  const quantity = balancePercentageQuantity(1000, 100, funding);
  expect(new BigNumber(quantity).times(backendFunding).lte(1000)).toBe(true);
});

test.each([-1, NaN, Infinity])('rejects invalid balance %s', value => {
  expect(balancePercentageQuantity(value, 100, 1)).toBe('');
});
test.each([0, -1, NaN, Infinity])('rejects invalid funding price %s', value => {
  expect(balancePercentageQuantity(100, 100, value)).toBe('');
});
test.each([NaN, Infinity, -Infinity])('rejects nonfinite slider percent %s', value => {
  expect(balancePercentageQuantity(100, value, 1)).toBe('');
});

test('percentage boundaries and SELL base-quantity mode are deterministic', () => {
  expect(balancePercentageQuantity(2, -1)).toBe('0.00000000');
  expect(balancePercentageQuantity(2, 150)).toBe('2.00000000');
  expect(balancePercentageQuantity(2, 25)).toBe('0.50000000');
  expect(balancePercentageQuantity(0, 100)).toBe('0.00000000');
  expect(balancePercentageQuantity(100, 100, 3)).toBe('33.33333333');
});

test('100% tiny-token quantity does not overspend by a floating-point tail', () => {
  for (const balance of [100, 1000, 10000, 1000000]) {
    const price = 0.0000081;
    const quantity = balancePercentageQuantity(balance, 100, price);
    expect(new BigNumber(quantity).times(price).lte(balance)).toBe(true);
    expect(new BigNumber(quantity).decimalPlaces()).toBeLessThanOrEqual(8);
  }
});

test('fractional slider always stays within selected funding share across realistic prices', () => {
  for (const balance of [0.12345678, 100, 23456.789, 1000000]) {
    for (const price of [0.0000081, 0.1, 1.1526, 3, 79000]) {
      for (const percent of [0, 25, 50, 75, 100]) {
        const quantity = balancePercentageQuantity(balance, percent, price);
        const cost = new BigNumber(quantity).times(price);
        const budget = new BigNumber(balance).times(percent).div(100);
        expect(cost.lte(budget)).toBe(true);
      }
    }
  }
});

test.each([
  [100, 100, 0.0000081],
  [1000, 100, 0.0000081],
  [0.12345678, 12.345, 1.1526],
  [1e-7, 75, 1e-8],
  [1e21, 100, 1e-7],
  [Number.MIN_VALUE, 100, 1],
  [1, 100, Number.MAX_VALUE],
])('floors exactly, without an arbitrary safety deduction: %s at %s%% and price %s', (balance, percent, price) => {
  const expected = new BigNumber(balance).times(percent).times('100000000')
    .dividedToIntegerBy(new BigNumber(price).times(100));
  const actual = balancePercentageQuantity(balance, percent, price);
  expect(new BigNumber(actual).times('100000000').eq(expected)).toBe(true);
  expect(actual).toMatch(/^\d+\.\d{8}$/);
});

test('parent wiring keeps plain matching APIs, pair-keyed reset and genuine funding separate from KYC', () => {
  const frontend = resolve(__dirname, '../../..');
  const form = readFileSync(resolve(frontend, 'src/components/OrderForm.tsx'), 'utf8');
  const page = readFileSync(resolve(frontend, 'src/pages/TradePage.tsx'), 'utf8');
  expect(form).toContain('await api.placeOcoOrder({'); expect(form).toContain('await api.placeOrder({');
  expect(form).not.toContain('placeDemoOrder'); expect(form).not.toContain('kycStatus');
  expect(form).toContain('if (submittingRef.current) return');
  expect(form).toContain('pickedPrice.pair !== pair');
  expect(form).toContain('setQuantity(balancePercentageQuantity(available.base, pct))');
  expect(form).toContain('orderFundingPrice(family, execution, price, triggerPrice, ocoTakeProfitPrice, ocoStopLimitPrice, marketPrice)');
  expect(page).toContain('<OrderForm key={pair}'); expect(page).toContain('spotPrecision');
  expect(page).toContain('onResizeBy='); expect(page).toContain('marketWidth={marketPanelWidth}');
});
