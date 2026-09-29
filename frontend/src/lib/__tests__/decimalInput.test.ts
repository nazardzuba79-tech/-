import { decimalFromNumber, decimalUnreadable, plainDecimal, readDecimalInput } from '../decimalInput';

describe('manual decimal drafts retain the complete value or are refused', () => {
  it.each([
    ['1e-8', 'exponent'], ['1e3', 'exponent'], ['2.5E+4', 'exponent'], ['1e', 'exponent'],
    ['-1', 'sign'], ['+5', 'sign'], ['−5', 'sign'],
    ['1.2.3', 'separator'], ['1,234.5', 'separator'], ['1..2', 'separator'],
    ['12abc34', 'character'], ['1 000', 'character'], [' 42.5 ', 'character'],
    [' ', 'character'], ['1\t2', 'character'], ['1\n', 'character'], ['1,2\n', 'character'],
    ['Infinity', 'character'], ['NaN', 'character'],
    ['0x10', 'character'], ['１２', 'character'], ['e5', 'character'], ['12$', 'character'],
  ])('refuses %s with reason %s and no fallback number', (raw, reason) => {
    const input = readDecimalInput(raw);
    expect(input).toEqual({ status: 'invalid', value: null, reason });
    expect(decimalUnreadable(input)).toBe(true);
  });

  it.each([
    ['270,5', '270.5'], ['12.91', '12.91'], ['80000', '80000'], ['007', '7'],
    ['000.5', '0.5'], ['0', '0'], ['0.0', '0.0'], ['.5', '0.5'], [',5', '0.5'],
    ['1.50', '1.50'], ['0001,2500', '1.2500'], ['0,000000012345', '0.000000012345'],
    ['123456789.123456789', '123456789.123456789'],
    ['99999999999999999999.99999999', '99999999999999999999.99999999'],
  ])('reads %s without rounding away any digits', (raw, value) => {
    const input = readDecimalInput(raw);
    expect(input).toEqual({ status: 'valid', value });
    expect(decimalUnreadable(input)).toBe(false);
  });

  it('keeps an empty field optional but incomplete numeric drafts non-executable', () => {
    expect(readDecimalInput('')).toEqual({ status: 'empty', value: null });
    expect(decimalUnreadable(readDecimalInput(''))).toBe(false);
    for (const raw of ['.', ',', '1.', '1,', '000.']) {
      const input = readDecimalInput(raw);
      expect(input).toEqual({ status: 'incomplete', value: null });
      expect(decimalUnreadable(input)).toBe(true);
    }
  });
});

describe('programmatic prices use complete decimal notation', () => {
  it.each([
    [1e-7, '0.0000001'], [1.5e-7, '0.00000015'], [1.2345e-10, '0.00000000012345'],
    [80000, '80000'], [80000.5, '80000.5'],
    [1e21, '1000000000000000000000'], [1.5e21, '1500000000000000000000'], [0, '0'],
  ])('formats %p as %s and preserves its value', (value, text) => {
    expect(decimalFromNumber(value)).toBe(text);
    expect(Number(text)).toBe(value);
    expect(readDecimalInput(text)).toEqual({ status: 'valid', value: text });
  });

  it('handles the smallest and largest finite JS prices without exponent notation', () => {
    for (const price of [Number.MIN_VALUE, Number.MAX_VALUE]) {
      const text = decimalFromNumber(price);
      expect(text).not.toMatch(/[eE]/);
      expect(readDecimalInput(text).status).toBe('valid');
      expect(Number(text)).toBe(price);
    }
  });

  it('preserves engine-supplied decimal digits rather than rounding through a float', () => {
    expect(plainDecimal('1.23456789123456789e-7')).toBe('0.000000123456789123456789');
    expect(plainDecimal('2.5E-3')).toBe('0.0025');
    expect(plainDecimal('1.2345e3')).toBe('1234.5');
    expect(plainDecimal('0.012')).toBe('0.012');
    expect(plainDecimal('abc')).toBe('abc');
    expect(plainDecimal('1e-7\n')).toBe('1e-7\n');
    expect(plainDecimal('0e999999999')).toBe('0');
    // The manual reader never invokes the formatter on the trader's text.
    expect(readDecimalInput('1e-7')).toEqual({ status: 'invalid', reason: 'exponent', value: null });
  });

  it('does not expand out-of-range external strings or invent a finite price', () => {
    for (const raw of ['1e99999999999999999999', '1e-99999999999999999999', '1e309', '1e-325']) {
      expect(plainDecimal(raw)).toBe(raw);
    }
    expect(decimalFromNumber(Number.NaN)).toBe('');
    expect(decimalFromNumber(Number.POSITIVE_INFINITY)).toBe('');
    expect(decimalFromNumber(Number.NEGATIVE_INFINITY)).toBe('');
  });
});
