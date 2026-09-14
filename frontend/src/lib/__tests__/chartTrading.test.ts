import { chartEntryAnchor, chartEventBar, chartSymbol, completeChartCandle, isCandleHit, mergeChartCandles, type ChartTradeOverlay } from '../chartTrading';
import type { Candle } from '../indicators';

const openTime = Date.UTC(2026, 8, 14, 6);
const candle: Candle = { time: openTime / 1000, open: 100, high: 115, low: 98, close: 110, volume: 10 };
const hit = { x: 100, y: 120, candleX: 100, highY: 100, lowY: 160, paneWidth: 800, paneHeight: 600, barSpacing: 8, paneIndex: 0, dragged: false, indicatorHovered: false, indicatorPanelVisible: false };

describe('private real-candle selection', () => {
  it('keeps normalized contract, source, OHLC and separate open/close millisecond instants', () => {
    expect(completeChartCandle(candle, 'BTC/USDT', '1h', openTime + 3600000)).toEqual({
      symbol: 'BTCUSDT', source: 'BYBIT_LINEAR', interval: '1h', openTime, closeTime: openTime + 3600000, open: 100, high: 115, low: 98, close: 110,
    });
    expect(chartSymbol('1000PEPE/USDT')).toBe('1000PEPEUSDT');
  });
  it('rejects an incomplete current candle even one millisecond before close', () => {
    expect(completeChartCandle(candle, 'BTCUSDT', '1h', openTime + 3599999)).toBeNull();
  });
  it.each([{ open: 0 }, { high: 99 }, { low: 111 }, { close: NaN }, { time: NaN }])('rejects malformed price/time metadata %p', values => {
    expect(completeChartCandle({ ...candle, ...values }, 'BTCUSDT', '1h', openTime + 3600000)).toBeNull();
  });
  it('rejects unsupported intervals without guessing time boundaries', () => {
    expect(completeChartCandle(candle, 'BTCUSDT', '2h', openTime + 7200000)).toBeNull();
  });
  it('only accepts the visible wick/body hit, not the entire time column', () => {
    expect(isCandleHit(hit)).toBe(true);
    expect(isCandleHit({ ...hit, y: 180 })).toBe(false);
    expect(isCandleHit({ ...hit, x: 106 })).toBe(false);
  });
  it.each([{ dragged: true }, { paneIndex: 1 }, { indicatorHovered: true }, { x: 800 }, { y: 550 }, { candleX: null }, { y: -1 }])('rejects gesture, indicator, scale and empty hits %p', values => {
    expect(isCandleHit({ ...hit, ...values })).toBe(false);
  });
  it('reserves the RSI/MACD lane even where it overlaps the candle series', () => {
    expect(isCandleHit({ ...hit, y: 460, highY: 455, lowY: 470, indicatorPanelVisible: true })).toBe(false);
  });
});

describe('persisted trade marker time anchoring', () => {
  const bars = [candle, { ...candle, time: candle.time + 3600 }, { ...candle, time: candle.time + 10800 }];
  const trade: ChartTradeOverlay = { id: 'p1', symbol: 'BTCUSDT', side: 'LONG', leverage: 10, quantity: 10, entryPrice: 110, pnl: 20, entryTime: openTime + 3600000, entryCandleOpenTime: openTime, entryInterval: '1h', entryModel: 'CLOSE', exits: [] };
  it('puts Close exactly on the selected candle rather than the next bar', () => {
    expect(chartEventBar(bars, chartEntryAnchor(trade), '1h')).toBe(candle.time);
    expect(chartEventBar(bars, chartEntryAnchor({ ...trade, entryModel: 'OPEN', entryCandleOpenTime: openTime + 3600000 }), '1h')).toBe(candle.time + 3600);
  });
  it('resolves the same close event on a finer and larger interval without neighbor drift', () => {
    const fine = Array.from({ length: 12 }, (_, i) => ({ ...candle, time: candle.time + i * 300 }));
    expect(chartEventBar(fine, chartEntryAnchor(trade), '5m')).toBe(candle.time + 3300);
    const coarse = [{ ...candle, time: (openTime - 7200000) / 1000 }];
    expect(chartEventBar(coarse, chartEntryAnchor(trade), '4h')).toBe(coarse[0].time);
  });
  it('does not attach across gaps, before history or after the final candle', () => {
    expect(chartEventBar(bars, openTime - 1, '1h')).toBeNull();
    expect(chartEventBar(bars, openTime + 9000000, '1h')).toBeNull();
    expect(chartEventBar(bars, openTime + 14400000, '1h')).toBeNull();
  });
  it('merges refreshes by real time, preserves older history and bounds cache size', () => {
    const incoming = [{ ...candle, close: 111 }, { ...candle, time: candle.time + 3600 }];
    const old = { ...candle, time: candle.time - 3600 };
    expect(mergeChartCandles([old, candle], incoming)).toEqual([old, incoming[0], incoming[1]]);
    expect(mergeChartCandles([old, candle], incoming, 2)).toEqual(incoming);
  });
});
