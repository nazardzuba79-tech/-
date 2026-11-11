import { formatCrypto, formatRub, parseRubAmount, RUB_AMOUNT_MAX, RUB_AMOUNT_MIN } from '../amount';

const NBSP = ' ';

describe('parseRubAmount', () => {
  test.each([
    ['10000', 10000],
    ['1', 1],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['1500,75', 1500.75],
    ['1500.75', 1500.75],
    ['10 000', 10000],
    [`10${NBSP}000`, 10000],
    ['10 000', 10000],
    ['1 000 000,5', 1000000.5],
    ['  2500  ', 2500],
    [`${NBSP}2500${NBSP}`, 2500],
    ['100000000', 100000000],
    ['100 000 000,00', 100000000],
    ['1,00', 1],
  ])('parses %p -> %p', (input, expected) => {
    expect(parseRubAmount(input)).toBe(expected);
  });

  test.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['0', 'below min'],
    ['0,99', 'below min'],
    ['100000000,01', 'above max'],
    ['100000001', 'above max'],
    ['1,234.56', 'two separators'],
    ['1.234,56', 'two separators'],
    ['1,2,3', 'two commas'],
    ['1.234', 'three fraction digits (ambiguous)'],
    ['100,', 'trailing separator'],
    [',5', 'missing integer part'],
    ['-100', 'sign'],
    ['+100', 'sign'],
    ['1e5', 'exponent'],
    ['0x10', 'hex'],
    ['Infinity', 'word'],
    ['NaN', 'word'],
    ['100 ₽', 'currency sign'],
    ['10  000', 'double space'],
    ['1 00', 'bad grouping'],
    ['1000 000', 'bad leading group'],
    ['10 00 000', 'bad grouping'],
    ['0100', 'leading zero'],
    ['１００', 'full-width digits'],
    ['١٠٠', 'arabic digits'],
    ['1'.repeat(40), 'too long'],
  ])('rejects %p (%s)', (input) => {
    expect(parseRubAmount(input)).toBeNull();
  });

  test('rejects non-strings', () => {
    expect(parseRubAmount(1000)).toBeNull();
    expect(parseRubAmount(['1000'])).toBeNull();
    expect(parseRubAmount(undefined)).toBeNull();
    expect(parseRubAmount(null)).toBeNull();
  });

  test('range constants', () => {
    expect(RUB_AMOUNT_MIN).toBe(1);
    expect(RUB_AMOUNT_MAX).toBe(100_000_000);
  });
});

describe('formatRub / formatCrypto', () => {
  const norm = (s: string) => s.replace(/[  ]/g, ' ');

  test('formatRub uses ru-RU grouping and comma decimals', () => {
    expect(norm(formatRub(10000))).toBe('10 000 ₽');
    expect(norm(formatRub(95.12))).toBe('95,12 ₽');
    expect(norm(formatRub(1234567.891))).toBe('1 234 567,89 ₽');
    expect(norm(formatRub(1500, 0))).toBe('1 500 ₽');
    expect(formatRub(10).endsWith(`${NBSP}₽`)).toBe(true);
    expect(formatRub(Number.NaN)).toBe('—');
    expect(formatRub(Infinity)).toBe('—');
  });

  test('formatCrypto respects display decimals and symbol', () => {
    expect(norm(formatCrypto(105.13, 2, 'USDT'))).toBe('105,13 USDT');
    expect(norm(formatCrypto(105, 2, 'USDT'))).toBe('105,00 USDT');
    expect(norm(formatCrypto(0.00123456, 6, 'BTC'))).toBe('0,001235 BTC');
    expect(norm(formatCrypto(1234.5, 3))).toBe('1 234,50');
    expect(formatCrypto(Number.NaN, 2, 'USDT')).toBe('—');
  });
});
