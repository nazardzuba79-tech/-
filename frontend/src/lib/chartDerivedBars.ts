/**
 * Alternative bar paints for the chart workspace (2026-10-13): OHLC bars,
 * hollow candles and Heikin Ashi. All three are DISPLAY transforms of the
 * same real OHLCV bars. Heikin Ashi in particular is a smoothed derivative:
 * its opens and closes are not prices anything traded at, so the chart's
 * trading paths (candle selection, markers, TP/SL, liquidation) keep reading
 * the real candlestick series, never these.
 */
import type { Candle } from './indicators';

export type ChartBarType = 'candles' | 'bars' | 'hollow' | 'heikin' | 'line' | 'area';
export const CHART_BAR_TYPES: readonly ChartBarType[] = Object.freeze(['candles', 'bars', 'hollow', 'heikin', 'line', 'area']);
export const isChartBarType = (value: unknown): value is ChartBarType => typeof value === 'string' && (CHART_BAR_TYPES as readonly string[]).includes(value);
/** Types painted from a candlestick-shaped series (OHLC bodies), as opposed to a close line. */
export const OHLC_BAR_TYPES: readonly ChartBarType[] = Object.freeze(['candles', 'bars', 'hollow', 'heikin']);

export interface PaintedBar extends Candle { color?: string; borderColor?: string; wickColor?: string }

/**
 * Heikin Ashi, the standard recursion:
 *   HA close = (O + H + L + C) / 4
 *   HA open  = (previous HA open + previous HA close) / 2
 *   HA high  = max(H, HA open, HA close)
 *   HA low   = min(L, HA open, HA close)
 * The first bar seeds HA open as (O + C) / 2 of that bar — the common
 * convention, fixed here so two renders of the same bars agree.
 */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let previous: Candle | null = null;
  for (const bar of candles) {
    const close: number = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open: number = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
    const high: number = Math.max(bar.high, open, close), low: number = Math.min(bar.low, open, close);
    const ha: Candle = { time: bar.time, open, high, low, close, volume: bar.volume };
    out.push(ha);
    previous = ha;
  }
  return out;
}

/**
 * Hollow candles, TradingView's rule: the OUTLINE (border and wick) takes the
 * up colour when the close is at or above the previous close and the down
 * colour otherwise; the BODY is hollow (plot-coloured) when the bar closes at
 * or above its open and filled with the outline colour when it closes below.
 * The first bar has no previous close and compares with its own open.
 */
export function hollowCandles(candles: readonly Candle[], colors: { up: string; down: string; hollow: string }): PaintedBar[] {
  const out: PaintedBar[] = [];
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    const reference = i > 0 ? candles[i - 1].close : bar.open;
    const outline = bar.close >= reference ? colors.up : colors.down;
    const filled = bar.close < bar.open;
    out.push({ ...bar, color: filled ? outline : colors.hollow, borderColor: outline, wickColor: outline });
  }
  return out;
}

/** OHLC bars take the plain up/down colour of their own body direction. */
export function ohlcBars(candles: readonly Candle[], colors: { up: string; down: string }): PaintedBar[] {
  return candles.map(bar => ({ ...bar, color: bar.close >= bar.open ? colors.up : colors.down }));
}
