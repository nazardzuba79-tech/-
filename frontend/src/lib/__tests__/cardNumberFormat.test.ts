import { cardPrice, cardSignedAmount, cardSignedPercent, cardLeverage } from '../cardNumberFormat';

/**
 * The card used to print every price at a fixed two decimals, which turned a
 * real AKE entry of 0.0040783 into `0.00`. These are the cases that rule got
 * wrong, plus the ones a replacement rule could newly get wrong.
 */
describe('card prices carry the precision the price actually has', () => {
  test.each([
    // [input, expected, why]
    ['85166.05315', '85,166.05', 'a four-figure price needs cents, not more'],
    ['85166.0531', '85,166.05', "the owner's BTC example"],
    ['1.234567', '1.234567', 'a unit-scale price keeps its places'],
    ['0.053564', '0.053564', 'five significant digits below one'],
    ['0.0040783', '0.0040783', "the owner's AKE entry — NOT 0.00"],
    ['0.0000012345', '0.0000012345', 'seven leading zeros still resolve'],
    ['100.000000', '100', 'meaningless trailing zeros are dropped'],
    ['0.004', '0.004', 'an exact sub-cent price is not padded'],
    ['0.0538', '0.0538', 'the AKE valuation price'],
  ])('%s renders as %s (%s)', (input, expected) => {
    expect(cardPrice(input)).toBe(expected);
  });

  test('large prices are grouped and the fraction never is', () => {
    expect(cardPrice('1234567.891')).toBe('1,234,567.89');
    expect(cardPrice('999.5')).toBe('999.5');
    expect(cardPrice('1000')).toBe('1,000.00');
  });

  test('a price too small for the significant-digit window is still not zero', () => {
    // The failure mode being guarded: anything that rounds away must widen
    // rather than print a bare 0, which is the original bug in a smaller font.
    const tiny = cardPrice('0.00000000000000123');
    expect(tiny).not.toBe('0');
    expect(Number(tiny.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('never scientific notation, at either end', () => {
    for (const value of ['0.0000000001', '1e-7', '0.00000000000009', '12345678901234']) {
      expect(cardPrice(value)).not.toMatch(/e/i);
    }
  });

  test('zero and negative zero are one plain zero', () => {
    expect(cardPrice('0')).toBe('0');
    expect(cardPrice('-0')).toBe('0');
    expect(cardPrice(-0)).toBe('0');
    expect(cardPrice('0.000')).toBe('0');
  });

  test('a negative price keeps its sign', () => {
    expect(cardPrice('-0.0040783')).toBe('-0.0040783');
    expect(cardPrice('-85166.05315')).toBe('-85,166.05');
  });

  test('nothing unusable is invented', () => {
    for (const value of [null, undefined, '', 'abc', NaN, Infinity, -Infinity, {}, []]) {
      expect(cardPrice(value)).toBe('—');
    }
  });
});

describe('PnL and ROI keep exactly two decimals, with an explicit sign', () => {
  test.each([
    ['728494.5', '+728,494.50'],
    ['737875.50', '+737,875.50'],
    ['-1234.5', '-1,234.50'],
    ['59760', '+59,760.00'],
    ['0.1', '+0.10'],
  ])('%s renders as %s', (input, expected) => {
    expect(cardSignedAmount(input)).toBe(expected);
  });

  test.each([
    ['11908.47', '+11,908.47'],
    ['12061.81', '+12,061.81'],
    ['12450', '+12,450.00'],
    ['-99999.99', '-99,999.99'],
  ])('ROI %s renders as %s', (input, expected) => {
    expect(cardSignedPercent(input)).toBe(expected);
  });

  test('a value that rounds to zero loses its sign rather than printing -0.00', () => {
    expect(cardSignedAmount('-0.001')).toBe('0.00');
    expect(cardSignedAmount('0')).toBe('0.00');
    expect(cardSignedAmount('-0')).toBe('0.00');
    expect(cardSignedAmount(-0)).toBe('0.00');
    expect(cardSignedAmount('0.004')).toBe('0.00');
  });

  test('rounds exactly as the previous release did, half away from zero', () => {
    // Intl rounds half away from zero; toFixed follows the binary value and
    // gives -0.57 here. The card showed -0.58 before this change, and a
    // displayed financial value must not move because the formatter moved.
    expect(cardSignedPercent('-0.575')).toBe('-0.58');
    expect(cardSignedAmount('0.575')).toBe('+0.58');
    expect(cardSignedAmount('2.345')).toBe('+2.35');
  });

  test('never scientific notation, and nothing unusable is invented', () => {
    expect(cardSignedAmount('1e21')).not.toMatch(/e/i);
    for (const value of [null, undefined, '', 'abc', NaN, Infinity]) {
      expect(cardSignedAmount(value)).toBe('—');
    }
  });
});

describe('leverage reads as a trader writes it', () => {
  test.each([
    ['10', '10x'],
    ['10.00', '10x'],
    [10, '10x'],
    ['3', '3x'],
    ['1.5', '1.5x'],
    ['125', '125x'],
  ])('%s renders as %s', (input, expected) => {
    expect(cardLeverage(input)).toBe(expected);
  });

  test('nothing unusable is invented', () => {
    for (const value of [null, undefined, '', 'abc', NaN, Infinity]) {
      expect(cardLeverage(value)).toBe('—');
    }
  });
});
