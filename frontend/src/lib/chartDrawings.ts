/** Pure drawing math. These values never enter the order or balance ledger. */
export interface DrawingPoint { time: number; price: number }

export const RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export function drawingRetracements(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return RETRACEMENT_LEVELS.map((level) => ({ level, price: start + (end - start) * level }));
}

export function drawingMeasurement(a: DrawingPoint, b: DrawingPoint, intervalSeconds: number, candleTimes: readonly number[] = []) {
  const priceDiff = b.price - a.price;
  const pct = a.price > 0 && Number.isFinite(priceDiff) ? (priceDiff / a.price) * 100 : null;
  const lo = Math.min(a.time, b.time);
  const hi = Math.max(a.time, b.time);
  // Count actual loaded candle boundaries where available, not nonexistent
  // bars in a feed gap. Outside loaded history fall back to interval distance.
  const covered = candleTimes.length > 0 && candleTimes[0] <= lo && candleTimes[candleTimes.length - 1] >= hi;
  const bars = covered ? candleTimes.filter((time) => time > lo && time <= hi).length
    : intervalSeconds > 0 && Number.isFinite(hi - lo) ? Math.round((hi - lo) / intervalSeconds) : 0;
  return { priceDiff, pct: pct !== null && Number.isFinite(pct) ? pct : null, bars };
}

export function formatDrawingPrice(value: number, locale = 'en') {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 8, useGrouping: false }).format(value)
    : '—';
}

/** Fit a portal to the viewport, even when the scrollable rail is near an edge. */
export function drawingFlyoutPosition(anchor: { top: number; bottom: number; right: number; left: number }, viewport: { width: number; height: number }, horizontal = false) {
  const width = Math.min(220, Math.max(0, viewport.width - 16));
  const height = Math.min(168, Math.max(0, viewport.height - 16));
  const left = horizontal ? anchor.left : anchor.right + 6;
  const top = horizontal ? anchor.bottom + 6 : anchor.top - 4;
  return { left: Math.max(8, Math.min(left, viewport.width - width - 8)), top: Math.max(8, Math.min(top, viewport.height - height - 8)) };
}

/** One drag owns its listeners. Cancel cannot later commit a stale brush/shape. */
export function trackDrawingGesture(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, callbacks: {
  move: (event: MouseEvent) => void;
  finish: (event: MouseEvent) => void;
  cancel: () => void;
}) {
  let active = true;
  const cleanup = () => {
    target.removeEventListener('mousemove', move);
    target.removeEventListener('mouseup', finish);
    target.removeEventListener('keydown', key);
    target.removeEventListener('blur', cancel);
  };
  const cancel = () => {
    if (!active) return;
    active = false;
    cleanup();
    callbacks.cancel();
  };
  const move = (event: MouseEvent) => { if (active) callbacks.move(event); };
  const finish = (event: MouseEvent) => {
    if (!active) return;
    active = false;
    cleanup();
    callbacks.finish(event);
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseup', finish);
  target.addEventListener('keydown', key);
  target.addEventListener('blur', cancel);
  return cancel;
}
