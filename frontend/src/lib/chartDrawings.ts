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

// ── Magnet ──────────────────────────────────────────────────────────

/** The OHLC field a magnet-snapped anchor landed on, so a caller can say
 *  which one it was rather than implying an exact click. */
export type MagnetField = 'open' | 'high' | 'low' | 'close';

export interface MagnetCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Snap a raw chart point to the nearest OHLC level of the nearest candle.
 *
 * Real snapping, not a visual approximation: the candle is chosen by
 * closest timestamp among the candles actually loaded, and the price is
 * whichever of that candle's four real levels is closest to the pointer.
 * The returned point carries the candle's own timestamp, so a snapped
 * anchor sits exactly on a bar rather than between two.
 *
 * Returns the input unchanged when there is nothing to snap to — no
 * candles loaded, or a non-finite point. A magnet that invents a level
 * would be worse than one that politely does nothing.
 */
export function magnetSnap(
  point: DrawingPoint,
  candles: readonly MagnetCandle[]
): DrawingPoint & { field?: MagnetField } {
  if (candles.length === 0 || !Number.isFinite(point.time) || !Number.isFinite(point.price)) return point;

  let candle = candles[0];
  let bestGap = Math.abs(candle.time - point.time);
  for (const c of candles) {
    const gap = Math.abs(c.time - point.time);
    if (gap < bestGap) {
      bestGap = gap;
      candle = c;
    }
  }

  const levels = ([
    { field: 'open', price: candle.open },
    { field: 'high', price: candle.high },
    { field: 'low', price: candle.low },
    { field: 'close', price: candle.close },
  ] as { field: MagnetField; price: number }[]).filter((l) => Number.isFinite(l.price));
  if (levels.length === 0) return point;

  let best = levels[0];
  for (const level of levels) {
    if (Math.abs(level.price - point.price) < Math.abs(best.price - point.price)) best = level;
  }
  return { time: candle.time, price: best.price, field: best.field };
}

// ── Persistence ─────────────────────────────────────────────────────

/** Which product a drawing belongs to. Spot and Futures keep separate
 *  sets even for the same ticker: they are different instruments and a
 *  perpetual's levels are not a spot chart's levels. */
export type DrawingMarket = 'spot' | 'futures';

/**
 * One saved drawing.
 *
 * Coordinates are ALWAYS `{ time, price }` — never pixels. That is what
 * lets a drawing survive a pan, a zoom, a resize and a timeframe switch:
 * the overlay recomputes screen positions from these on every redraw, so
 * the stored form has no idea what the viewport was when it was made.
 */
export interface StoredDrawing {
  kind: 'trendline' | 'extended' | 'ray' | 'horizontal' | 'vertical' | 'rectangle' | 'fib' | 'brush' | 'ruler' | 'text';
  points: DrawingPoint[];
  text?: string;
}

export interface StoredDrawingState {
  version: 1;
  drawings: StoredDrawing[];
  hidden: boolean;
  locked: boolean;
}

const STORAGE_PREFIX = 'voltex.drawings';
const STORAGE_VERSION = 1;
/** A ceiling, so a runaway brush cannot fill a user's storage quota. */
export const MAX_STORED_DRAWINGS = 400;

/**
 * `voltex.drawings.<market>.<SYMBOL>`.
 *
 * Deliberately NOT keyed by timeframe: a drawing is anchored to real
 * timestamps and prices, so it is the same drawing whether you look at it
 * on 15m or 1d. Keying by timeframe would hide a trader's own levels the
 * moment they changed the zoom.
 *
 * Deliberately keyed BY SYMBOL and BY MARKET: BTC drawings must never
 * appear on ETH, and spot BTC levels are not futures BTC levels.
 */
export function drawingStorageKey(market: DrawingMarket, symbol: string): string {
  return `${STORAGE_PREFIX}.${market}.${symbol.toUpperCase()}`;
}

function validPoint(value: unknown): value is DrawingPoint {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.time === 'number' && Number.isFinite(p.time)
    && typeof p.price === 'number' && Number.isFinite(p.price);
}

/** How many points each kind must carry to mean anything. A shape with
 *  too few is dropped rather than rendered as a degenerate dot. */
const MIN_POINTS: Record<StoredDrawing['kind'], number> = {
  trendline: 2, extended: 2, ray: 1, horizontal: 1, vertical: 1,
  rectangle: 2, fib: 2, brush: 2, ruler: 2, text: 1,
};

/**
 * Parse a stored payload, dropping anything that is not a well-formed
 * drawing.
 *
 * localStorage is user-writable and survives across app versions, so this
 * treats what it finds as untrusted input: a wrong version, a non-array,
 * an unknown kind or a point that is not two finite numbers all yield an
 * empty state rather than a crash or a half-drawn shape.
 */
export function parseStoredDrawings(raw: string | null): StoredDrawingState {
  const empty: StoredDrawingState = { version: STORAGE_VERSION, drawings: [], hidden: false, locked: false };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  const state = parsed as Record<string, unknown>;
  if (state.version !== STORAGE_VERSION || !Array.isArray(state.drawings)) return empty;

  const drawings: StoredDrawing[] = [];
  for (const entry of state.drawings) {
    if (!entry || typeof entry !== 'object') continue;
    const d = entry as Record<string, unknown>;
    const kind = d.kind as StoredDrawing['kind'];
    if (!(kind in MIN_POINTS)) continue;
    if (!Array.isArray(d.points)) continue;
    const points = d.points.filter(validPoint);
    if (points.length < MIN_POINTS[kind]) continue;
    const text = typeof d.text === 'string' ? d.text : undefined;
    if (kind === 'text' && !text) continue;
    drawings.push(text === undefined ? { kind, points } : { kind, points, text });
    if (drawings.length >= MAX_STORED_DRAWINGS) break;
  }
  return {
    version: STORAGE_VERSION,
    drawings,
    hidden: state.hidden === true,
    locked: state.locked === true,
  };
}

export function serializeDrawings(state: Omit<StoredDrawingState, 'version'>): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    drawings: state.drawings.slice(0, MAX_STORED_DRAWINGS),
    hidden: state.hidden,
    locked: state.locked,
  });
}

// ── Hit testing, for the per-drawing eraser ─────────────────────────

export interface ScreenPoint { x: number; y: number }

/** Distance from a point to a segment, in screen pixels. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Clamped projection: the nearest point on the SEGMENT, not the
  // infinite line, so an eraser click far past an endpoint does not hit.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How close a click has to be to count as hitting a drawing. */
export const ERASER_HIT_RADIUS = 8;
