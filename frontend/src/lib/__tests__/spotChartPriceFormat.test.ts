import fs from 'fs';
import path from 'path';
import { spotChartPriceFormat } from '../spotChartPriceFormat';

const candle = (price: number) => ({ open: price, high: price, low: price, close: price });

describe('Spot chart axis precision uses real candle magnitudes', () => {
  test.each([0.000000109, 0.0000000000123, 0.00000001234, 0.0001234, 0.1234, 1.23, 79915])('positive %s never rounds to zero', price => {
    const format = spotChartPriceFormat([candle(price)])!;
    expect(format.type).toBe('price');
    expect(Number(price.toFixed(format.precision))).toBeGreaterThan(0);
    expect(format.minMove).toBe(10 ** -format.precision);
    expect(format.base).toBe(10 ** format.precision);
  });
  test('MOG-scale price shows its actual value instead of 0.00', () => {
    const format = spotChartPriceFormat([candle(0.000000109)])!;
    expect(format.precision).toBe(12);
    expect((0.000000109).toFixed(format.precision)).toBe('0.000000109000');
    expect(format.minMove).toBe(1e-12);
  });
  test('normal-priced instrument retains ordinary two-decimal precision', () => {
    expect(spotChartPriceFormat([candle(79915)])).toEqual({ type: 'price', precision: 2, minMove: 0.01, base: 100 });
  });
  test('all OHLC values matter, not just the latest close, and inputs remain unchanged', () => {
    const rows = [{ open: 0.000000109, high: 0.00000012, low: 0.000000099, close: 0.00000011 }];
    const before = JSON.stringify(rows);
    expect(spotChartPriceFormat(rows)!.precision).toBe(13);
    expect(JSON.stringify(rows)).toBe(before);
  });
  test('missing or invalid data does not invent a quote or override the formatter', () => {
    expect(spotChartPriceFormat([])).toBeNull();
    expect(spotChartPriceFormat([candle(NaN), candle(Infinity), candle(0), candle(-1)])).toBeNull();
  });
  test('actual integration is opt-in Spot only and covers all price-series modes without touching other axes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf('        if (spotChartRefinements) {\n          const priceFormat = spotChartPriceFormat(res.candles);');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('        seriesRef.current.setData(', start));
    for (const ref of ['seriesRef', 'lineSeriesRef', 'areaSeriesRef', 'maSeriesRef', 'bollUpperRef', 'bollMiddleRef', 'bollLowerRef']) expect(block).toContain(ref);
    expect(block).not.toContain('volumeSeriesRef'); expect(block).not.toContain('rsiSeriesRef'); expect(block).not.toContain('macdLineRef');
    expect(block).toContain('applyOptions({ priceFormat })'); expect(block).not.toContain('setData(');
    // The rail was generalized to any terminal, but this axis refinement
    // stayed on the spot terminal — otherwise enabling the rail on Futures
    // would have changed its price-axis precision as a side effect.
    expect(source).toContain('const drawingToolsOn = terminal && drawingTools');
    expect(source).toContain("const spotChartRefinements = terminal && market === 'spot'");
  });
});
