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
  test('actual integration supports Spot and explicit contract loaders without touching other axes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../components/PriceChart.tsx'), 'utf8').replace(/\r\n/g, '\n');
    // `} else if`: a chart given its own `priceFormatter` (a VOLTEX test
    // asset) is formatted by that instead; every other chart takes this block.
    const start = source.indexOf('        } else if (spotChartRefinements || candleLoader) {\n          const priceFormat = spotChartPriceFormat(res.candles);');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('        seriesRef.current.setData(', start));
    // Issue #502 (2026-10-10): the price-axis series are gathered by
    // `priceScaleSeries()` — the candles, their line/area twins and every
    // price-pane indicator line — so one formatter still reaches all of them
    // and never the volume or a lower-pane indicator.
    expect(block).toContain('for (const sr of priceScaleSeries())');
    const gather = source.slice(source.indexOf('const priceScaleSeries = ('), source.indexOf('return out;', source.indexOf('const priceScaleSeries = (')));
    for (const ref of ['seriesRef', 'lineSeriesRef', 'areaSeriesRef']) expect(gather).toContain(ref);
    expect(gather).toContain("if (set.pane === 'price') out.push(...Object.values(set.lines));");
    for (const text of [block, gather]) { expect(text).not.toContain('volumeSeriesRef'); expect(text).not.toContain("'lower'"); }
    expect(block).toContain('applyOptions({ priceFormat: wanted })'); expect(block).not.toContain('setData(');
    // A fixed decimals setting wins over the instrument's precision, which is remembered for «auto».
    expect(block).toContain('autoPriceFormatRef.current = priceFormat;');
    // An exact contract loader now opts into small-price precision too;
    // drawing-tool selection alone still does not control the formatter.
    expect(source).toContain('const drawingToolsOn = terminal && drawingTools');
    expect(source).toContain("const spotChartRefinements = terminal && market === 'spot'");
  });
});
