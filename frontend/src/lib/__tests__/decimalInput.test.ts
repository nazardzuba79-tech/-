import { decimalFromNumber, decimalUnreadable, plainDecimal, readDecimalInput } from '../decimalInput';

/**
 * Owner review of #332: the order ticket's number reader must never turn
 * text it does not understand into a different number. These are the cases
 * the review ran against the old reader, plus the ones it asked for.
 */

describe('readDecimalInput refuses what the old reader silently rewrote', () => {
  // Old result in the comment: what `decimalText` made of the same text.
  it.each([
    ['1e-8', 'exponent'], // was '18'
    ['1e3', 'exponent'], // was '13'
    ['1E3', 'exponent'],
    ['2.5e+4', 'exponent'],
    ['1e', 'exponent'],
    ['-1', 'sign'], // was '1'
    ['+5', 'sign'],
    ['−5', 'sign'], // U+2212, what a pasted «−5» often carries
    ['1.2.3', 'separator'], // was '1.23'
    ['1,234.5', 'separator'],
    ['1..2', 'separator'],
    ['12abc34', 'character'], // was '1234'
    ['1 000', 'character'],
    ['Infinity', 'character'],
    ['NaN', 'character'],
    ['0x10', 'character'],
    ['１２', 'character'], // full-width digits
    ['e5', 'character'],
    ['12$', 'character'],
  ])('%s → refused (%s), with no value', (text, reason) => {
    const read = readDecimalInput(text);
    expect(read).toEqual({ status: 'invalid', value: null, reason });
    expect(decimalUnreadable(read)).toBe(true);
  });
});

describe('readDecimalInput reads a number as the same number', () => {
  it.each([
    ['270,5', '270.5'],
    ['12,91', '12.91'],
    ['12.91', '12.91'],
    ['80000', '80000'],
    ['007', '7'],
    ['000.5', '0.5'],
    ['0', '0'],
    ['0.0', '0.0'],
    ['.5', '0.5'],
    [',5', '0.5'],
    ['12.', '12'],
    ['12,', '12'],
    ['1.50', '1.50'], // trailing zeros are the trader's precision; kept
    ['0.00000001', '0.00000001'],
    ['0,000000012345', '0.000000012345'],
    ['123456789.123456789', '123456789.123456789'], // not through a float
    ['99999999999999999999.99999999', '99999999999999999999.99999999'],
    ['  42.5  ', '42.5'], // surrounding space from a paste
  ])('%s → %s', (text, value) => {
    const read = readDecimalInput(text);
    expect(read).toEqual({ status: 'valid', value });
    expect(decimalUnreadable(read)).toBe(false);
  });

  it('keeps a long value digit for digit where a float would not', () => {
    expect(String(Number('123456789.123456789'))).toBe('123456789.12345679');
    expect(readDecimalInput('123456789.123456789').value).toBe('123456789.123456789');
  });
});

describe('readDecimalInput and a field that is still being typed', () => {
  it('an empty field is empty, not an error', () => {
    expect(readDecimalInput('')).toEqual({ status: 'empty', value: null });
    expect(readDecimalInput('   ')).toEqual({ status: 'empty', value: null });
    expect(decimalUnreadable(readDecimalInput(''))).toBe(false);
  });
  it('a lone separator is half-typed: no value, no refusal, but not a number either', () => {
    for (const text of ['.', ',']) {
      expect(readDecimalInput(text)).toEqual({ status: 'incomplete', value: null });
      expect(decimalUnreadable(readDecimalInput(text))).toBe(true);
    }
  });
});

describe('numbers the terminal writes into a field are plain digits', () => {
  it.each([
    [1e-7, '0.0000001'],
    [1.5e-7, '0.00000015'],
    [1.2345e-10, '0.00000000012345'],
    [80000, '80000'],
    [80000.5, '80000.5'],
    [1e21, '1000000000000000000000'],
    [1.5e21, '1500000000000000000000'],
    [0, '0'],
  ])('%p → %s, which the reader takes as the same number', (value, text) => {
    expect(decimalFromNumber(value)).toBe(text);
    expect(Number(text)).toBe(value);
    expect(readDecimalInput(text)).toEqual({ status: 'valid', value: text });
  });
  it('an exponent string from the engine is written out; anything else is left alone', () => {
    expect(plainDecimal('1e-7')).toBe('0.0000001');
    expect(plainDecimal('2.5E-3')).toBe('0.0025');
    expect(plainDecimal('1.2345e3')).toBe('1234.5');
    expect(plainDecimal('0.012')).toBe('0.012');
    expect(plainDecimal('abc')).toBe('abc');
    expect(decimalFromNumber(Number.NaN)).toBe('');
    expect(decimalFromNumber(Number.POSITIVE_INFINITY)).toBe('');
  });
});
