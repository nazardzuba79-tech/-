import { drawingRange, drawingRangeLines, type DrawingRange } from '../chartDrawings';

describe('ruler labels preserve measurable values when percentage is unavailable', () => {
  const hour = 3600;
  const candles = Array.from({ length: 10 }, (_, i) => ({ time: i * hour, volume: 1000 }));

  test.each([
    [0, '+247,58 (—%)'],
    [-0.81, '+248,39 (—%)'],
  ])('keeps the price move from a nonpositive baseline (%s)', (price, expected) => {
    const start = { time: 0, price };
    const end = { time: 9 * hour, price: 247.58 };
    const range = drawingRange(start, end, candles, hour);

    expect(range.pct).toBeNull();
    expect(drawingRangeLines(range, 'ru')).toEqual([expected, '9 баров, 9ч', 'Объём 9.00K']);
    expect(start).toEqual({ time: 0, price });
    expect(end).toEqual({ time: 9 * hour, price: 247.58 });
  });

  test.each([null, NaN, Infinity, -Infinity])('marks only percentage unavailable for %s', (pct) => {
    const range: DrawingRange = { priceDiff: 247.58, pct, ticks: null, bars: 9, seconds: 9 * hour, volume: null };
    expect(drawingRangeLines(range, 'en', { price: true, date: false })).toEqual(['+247.58 (—%)']);
  });

  test('retains the full NRX increase from its actual positive starting price', () => {
    const range = drawingRange({ time: 0, price: 0.81 }, { time: 9 * hour, price: 247.58 }, candles, hour);
    expect(range.pct).toBeCloseTo(30465.43209876543, 8);
    expect(drawingRangeLines(range, 'ru')[0]).toBe('+246,77 (+30\u00a0465,43%)');
  });

  test('reverse measurement uses the gesture starting price', () => {
    const range = drawingRange({ time: 9 * hour, price: 247.58 }, { time: 0, price: 0.81 }, candles, hour);
    expect(drawingRangeLines(range, 'en')).toEqual(['-246.77 (-99.67%)', '9 bars, 9h', 'Vol 9.00K']);
  });

  test('tiny prices keep a nonzero move and a valid percentage', () => {
    const range = drawingRange({ time: 0, price: 1e-14 }, { time: hour, price: 1.2e-14 }, candles, hour);
    expect(drawingRangeLines(range, 'en')[0]).toBe('+0.000000000000002 (+20.00%)');
  });

  test('a percentage overflow does not erase a finite price move', () => {
    const range = drawingRange({ time: 0, price: Number.MIN_VALUE }, { time: hour, price: 1 }, candles, hour);
    expect(range.pct).toBeNull();
    expect(drawingRangeLines(range, 'en')[0]).toBe('+1.00 (—%)');
  });

  test.each([NaN, Infinity, -Infinity])('does not present a nonfinite anchor %s as a measured price', (price) => {
    const range = drawingRange({ time: 0, price }, { time: hour, price: 247.58 }, candles, hour);
    const lines = drawingRangeLines(range, 'en');
    expect(lines[0]).toBe('—');
    expect(lines.join(' ')).not.toMatch(/NaN|Infinity/);
  });
});
