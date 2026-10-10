import type { Candle, Fill } from './types';

export type TradeGroup = { time: number; fills: Fill[] };
const durations: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400 };

// Match only an actual candle in this instrument's native history, never a gap.
export function groupTrades(id: string, interval: string, candles: Candle[], fills: Fill[]): TradeGroup[] {
  const duration = durations[interval];
  if (!duration) return [];
  const groups = new Map<number, Fill[]>();
  for (const fill of fills) {
    if (fill.instrumentId !== id) continue;
    const time = fill.timestamp / 1000;
    let low = 0, high = candles.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (candles[mid].time <= time) low = mid + 1;
      else high = mid - 1;
    }
    const candle = candles[high];
    if (!candle || time >= candle.time + duration) continue;
    groups.set(candle.time, [...(groups.get(candle.time) || []), fill]);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([time, trades]) => ({
    time, fills: [...trades].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)),
  }));
}

// At a zoomed-out scale adjacent candles may be closer than a touch target.
// Combine their presentation only; retain every original fill for the details.
export function layoutTradeGroups(groups: TradeGroup[], coordinate: (time: number) => number | null, width: number, spacing = 34) {
  const positioned: Array<TradeGroup & { x: number }> = [];
  if (width < spacing) return positioned;
  for (const group of groups) {
    const x = coordinate(group.time);
    if (x == null || x < 0 || x > width) continue;
    const clamped = Math.max(spacing / 2, Math.min(width - spacing / 2, x));
    const previous = positioned[positioned.length - 1];
    if (previous && clamped - previous.x < spacing) previous.fills.push(...group.fills);
    else positioned.push({ ...group, fills: [...group.fills], x: clamped });
  }
  return positioned;
}

export function quoteAge(timestamp: number | undefined, now: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Время не подтверждено';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds} с назад` : seconds < 3600 ? `${Math.floor(seconds / 60)} мин назад` : `${Math.floor(seconds / 3600)} ч назад`;
}
