import type { Candle } from './indicators';

/** Public charts do not opt into this contract. All persisted values come from the private server. */
export interface ChartTradeCandle {
  symbol: string;
  source: 'BYBIT_LINEAR';
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  x?: number;
  y?: number;
}
export interface ChartTradeOverlay {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  quantity: number;
  pnl: number;
  entryTime: number;
  /** Close execution belongs to the selected completed candle, including at a timeframe boundary. */
  entryCandleOpenTime?: number;
  entryInterval?: string;
  entryModel?: 'OPEN' | 'CLOSE' | string;
  takeProfit?: number | null;
  stopLoss?: number | null;
  liquidationPrice?: number | null;
  exits: { time: number; price: number; kind: string; quantity?: number; candleOpenTime?: number }[];
}
export interface ChartTradingInteraction {
  enabled: boolean;
  selecting: 'entry' | 'exit' | null;
  selectedCandle?: ChartTradeCandle | null;
  trades: ChartTradeOverlay[];
  selectedTradeId?: string | null;
  focus?: { tradeId: string; time: number; sequence: number } | null;
  onCandleSelect(candle: ChartTradeCandle): void;
  onCancelSelection(): void;
  onTradeSelect(id: string): void;
  onSelectionModeChange?(selecting: 'entry' | 'exit' | null): void;
}
export type ChartCandleLoader = (pair: string, interval: string, limit: number, signal?: AbortSignal, endTime?: number) => Promise<{ candles: Candle[] }>;

export const CHART_INTERVAL_MS: Record<string, number> = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 };
export const chartSymbol = (pair: string) => pair.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function completeChartCandle(candle: Candle, symbol: string, interval: string, now = Date.now()): ChartTradeCandle | null {
  const duration = CHART_INTERVAL_MS[interval];
  const openTime = candle.time * 1000;
  if (!duration || !Number.isSafeInteger(openTime) || openTime <= 0 || openTime + duration > now) return null;
  if (![candle.open, candle.high, candle.low, candle.close].every(value => Number.isFinite(value) && value > 0)) return null;
  if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close) || candle.low > candle.high) return null;
  return { symbol: chartSymbol(symbol), source: 'BYBIT_LINEAR', interval, openTime, closeTime: openTime + duration, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
}

/** A native seriesData time is necessary but insufficient: LWC also supplies it over empty space. */
export function isCandleHit(input: {
  x: number; y: number; candleX: number | null; highY: number | null; lowY: number | null;
  paneWidth: number; paneHeight: number; barSpacing: number; paneIndex?: number;
  dragged: boolean; indicatorHovered: boolean; indicatorPanelVisible: boolean;
}): boolean {
  const { x, y, candleX, highY, lowY, paneWidth, paneHeight } = input;
  if (input.dragged || input.indicatorHovered || (input.paneIndex !== undefined && input.paneIndex !== 0)) return false;
  if (candleX === null || highY === null || lowY === null || ![x, y, candleX, highY, lowY].every(Number.isFinite)) return false;
  if (x < 0 || x >= paneWidth || y < 0 || y >= paneHeight * (input.indicatorPanelVisible ? 0.75 : 0.8)) return false;
  return Math.abs(x - candleX) <= Math.max(3, Math.min(10, input.barSpacing / 2))
    && y >= Math.min(highY, lowY) - 5 && y <= Math.max(highY, lowY) + 5;
}

/** Resolve to an actually loaded bar, never synthesize or attach across a history gap. */
export function chartEventBar(candles: Candle[], eventTimeMs: number, interval: string): number | null {
  const duration = CHART_INTERVAL_MS[interval];
  if (!duration || !Number.isFinite(eventTimeMs) || !candles.length) return null;
  let left = 0, right = candles.length - 1, found = -1;
  while (left <= right) {
    const middle = (left + right) >> 1;
    if (candles[middle].time * 1000 <= eventTimeMs) { found = middle; left = middle + 1; } else right = middle - 1;
  }
  if (found < 0 || eventTimeMs >= candles[found].time * 1000 + duration) return null;
  return candles[found].time;
}

/** Close points use the instant just before their close boundary on every display timeframe. */
export function chartEntryAnchor(trade: ChartTradeOverlay): number {
  if (trade.entryModel === 'CLOSE') return Math.max(0, trade.entryTime - 1);
  return trade.entryCandleOpenTime ?? trade.entryTime;
}

export function mergeChartCandles(previous: Candle[], incoming: Candle[], maximum = 10000): Candle[] {
  const byTime = new Map(previous.map(candle => [candle.time, candle]));
  for (const candle of incoming) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-maximum);
}
