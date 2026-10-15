/**
 * Viewport arithmetic shared by the main chart and the workspace panes
 * (2026-10-14): where a freshly loaded series is put on the time scale, and
 * how far the price scale may extend below the lowest bar. Pure numbers; the
 * charts apply them.
 */

/** Bar slots a short history is laid over, so one weekly bar of a young listing is a bar, not a wall. */
export const SHORT_HISTORY_SLOTS = 60;
/** Empty bar slots kept right of the newest bar of a short history. */
export const SHORT_HISTORY_RIGHT_PADDING = 4;

/**
 * The logical range to show after the first load of `count` bars with a
 * window of `visible` bars: the newest `visible` when there are more (every
 * bar past a long indicator's warm-up), otherwise the few bars at the right of
 * a window of at least SHORT_HISTORY_SLOTS slots, so each keeps a readable
 * width. Null for an empty series.
 */
export function initialLogicalRange(count: number, visible: number): { from: number; to: number } | null {
  if (!(count > 0)) return null;
  if (count > visible) return { from: count - visible, to: count - 1 };
  const slots = Math.max(Math.min(visible, SHORT_HISTORY_SLOTS), count + SHORT_HISTORY_RIGHT_PADDING);
  const to = count - 1 + SHORT_HISTORY_RIGHT_PADDING;
  return { from: to - slots + 1, to };
}

/**
 * The bounds of the bars on a price scale, read back from the prices at the
 * pane's top and bottom edges with the margins in force: Lightweight Charts
 * keeps the bars inside [bottom, 1 − top] of the pane height and extends the
 * axis linearly into both margins.
 */
export function dataBoundsFromEdges(topPrice: number, bottomPrice: number, top: number, bottom: number): { lo: number; hi: number } {
  const span = topPrice - bottomPrice;
  return { lo: bottomPrice + span * bottom, hi: topPrice - span * top };
}

/**
 * The bottom margin that keeps the extended axis at or above zero for bars
 * in [lo, hi] with `top` above them: `wanted` when it already does, otherwise
 * the largest fraction that does (lo·(1 − top)/hi, from
 * lo − (hi − lo)·b/(1 − top − b) ≥ 0), a hair under it so the lowest tick is
 * never a "−0.00". Bars that reach zero or below (an oscillator, a percent
 * scale) keep `wanted`: there is nothing unjustified about a negative axis there.
 */
export function safeBottomMargin(lo: number, hi: number, top: number, wanted: number): number {
  if (!(lo > 0) || !(hi >= lo) || !(wanted > 0)) return wanted;
  const limit = (lo * (1 - top)) / hi;
  if (limit >= wanted) return wanted;
  return Math.max(0, limit - 0.002);
}

/**
 * The time-axis label for a tick when the library's own choice would be a
 * time of day. With a lone bar (a listing's first week) there is no neighbour
 * to date the tick by, so Lightweight Charts prints "00:00:00" under a weekly
 * bar; a bar of a day or longer is dated instead, and an intraday bar keeps
 * hours and minutes without seconds. `tickMarkType` is the library's numeric
 * TickMarkType (0 year, 1 month, 2 day, 3 time, 4 time with seconds); null
 * keeps the library's label.
 */
export function timeTickLabel(timeSeconds: number, intervalSeconds: number, tickMarkType: number, locale: string): string | null {
  if (!Number.isFinite(timeSeconds) || tickMarkType < 3) return null;
  const date = new Date(timeSeconds * 1000);
  try {
    if (intervalSeconds >= 86400) return new Intl.DateTimeFormat(locale || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
    if (tickMarkType === 4) return new Intl.DateTimeFormat(locale || 'en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date);
  } catch { return null; }
  return null;
}
