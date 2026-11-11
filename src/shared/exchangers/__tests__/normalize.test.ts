import { parseBcDecimal, receiveAmountFor, rubPerUnit } from '../normalize';

describe('parseBcDecimal', () => {
  test.each([
    [95.12, 95.12],
    ['95.12', 95.12],
    ['0.0105', 0.0105],
    ['1e-5', 0.00001],
    ['100', 100],
    ['-1', -1],
  ])('parses %p', (v, expected) => {
    expect(parseBcDecimal(v)).toBe(expected);
  });
  test.each(['', ' 1', '1,5', '0x10', 'Infinity', 'NaN', '1.', '.5', null, undefined, {}, Infinity, Number.NaN, '1'.repeat(41)])(
    'rejects %p',
    (v) => {
      expect(parseBcDecimal(v)).toBeNull();
    },
  );
});

describe('rubPerUnit orientation', () => {
  test('values >= 1 are already RUB per unit', () => {
    expect(rubPerUnit(95.12)).toBe(95.12);
    expect(rubPerUnit('9500000')).toBe(9500000);
    expect(rubPerUnit(1)).toBe(1);
  });

  test('values < 1 are crypto per RUB and are inverted', () => {
    expect(rubPerUnit(0.01)).toBeCloseTo(100, 10);
    expect(rubPerUnit('0.0105')).toBeCloseTo(95.238095, 5);
    expect(rubPerUnit(1 / 9_500_000)).toBeCloseTo(9_500_000, 3);
  });

  test('both orientations of the same market give the same RUB per unit', () => {
    const rubPerUsdt = 95.4;
    expect(rubPerUnit(rubPerUsdt)).toBeCloseTo(rubPerUnit(1 / rubPerUsdt)!, 9);
  });

  test.each([0, -5, '-0.5', Number.NaN, Infinity, -Infinity, '0', 'abc', null, undefined, 5e-324])('drops %p', (v) => {
    expect(rubPerUnit(v)).toBeNull();
  });
});

describe('receiveAmountFor', () => {
  test('divides RUB by RUB-per-unit', () => {
    expect(receiveAmountFor(10000, 95.12)).toBeCloseTo(105.130361, 5);
  });
  test('null on unusable inputs', () => {
    expect(receiveAmountFor(10000, null)).toBeNull();
    expect(receiveAmountFor(10000, 0)).toBeNull();
    expect(receiveAmountFor(0, 95)).toBeNull();
    expect(receiveAmountFor(Number.NaN, 95)).toBeNull();
  });
});
