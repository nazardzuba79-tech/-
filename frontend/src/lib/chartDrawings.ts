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
export function drawingFlyoutPosition(anchor: { top: number; bottom: number; right: number; left: number }, viewport: { width: number; height: number }, horizontal = false, size = { width: 220, height: 168 }) {
  const width = Math.min(size.width, Math.max(0, viewport.width - 16));
  const height = Math.min(size.height, Math.max(0, viewport.height - 16));
  const left = horizontal ? anchor.left : anchor.right + 6;
  const top = horizontal ? anchor.bottom + 6 : anchor.top - 4;
  return { left: Math.max(8, Math.min(left, viewport.width - width - 8)), top: Math.max(8, Math.min(top, viewport.height - height - 8)) };
}

/** One drag owns its listeners. Cancel cannot later commit a stale brush/shape. */
export function trackDrawingGesture(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, callbacks: {
  move: (event: MouseEvent) => void;
  finish: (event: MouseEvent) => void;
  cancel: () => void;
}, pointer = false) {
  // Pointer events carry touch and pen as well as the mouse, so a drawing
  // made or dragged with a finger follows it the same way.
  const moveEvent = pointer ? 'pointermove' : 'mousemove';
  const upEvent = pointer ? 'pointerup' : 'mouseup';
  let active = true;
  const cleanup = () => {
    target.removeEventListener(moveEvent, move as EventListener);
    target.removeEventListener(upEvent, finish as EventListener);
    target.removeEventListener('keydown', key as EventListener);
    target.removeEventListener('blur', cancel);
    if (pointer) target.removeEventListener('pointercancel', cancel);
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
  target.addEventListener(moveEvent, move as EventListener);
  target.addEventListener(upEvent, finish as EventListener);
  target.addEventListener('keydown', key as EventListener);
  target.addEventListener('blur', cancel);
  if (pointer) target.addEventListener('pointercancel', cancel);
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

// ── The catalogue ───────────────────────────────────────────────────

/**
 * Every drawing this chart can make, grouped the way TradingView's left
 * toolbar groups them (owner, 2026-09-26: «таку ж панель як в трейдінгвю…
 * з таким же функціоналом»). The ids of the ten tools that existed before
 * are unchanged, so every drawing already saved in a browser still loads:
 * `ray` has always been the HORIZONTAL ray; the two-point ray is `rayline`.
 */
export const DRAWING_KINDS = [
  'trendline', 'rayline', 'infoline', 'extended', 'trendangle', 'horizontal', 'ray', 'vertical', 'crossline', 'channel',
  'fib', 'fibext', 'pitchfork',
  'xabcd', 'abcd', 'trianglepattern', 'headshoulders', 'elliott',
  'long', 'short', 'pricerange', 'daterange', 'ruler',
  'brush', 'highlighter', 'arrow', 'arrowup', 'arrowdown', 'rectangle', 'ellipse', 'triangleshape', 'polyline',
  'text', 'note', 'callout', 'pricelabel',
] as const;
export type DrawingKind = typeof DRAWING_KINDS[number];

/** Anchors each kind takes. Fixed-count kinds are placed click by click
 *  (two-point kinds also accept one press-drag-release); brush strokes are
 *  freehand; a polyline takes points until it is finished. */
export const DRAWING_POINTS: Record<DrawingKind, { min: number; max: number }> = {
  trendline: { min: 2, max: 2 }, rayline: { min: 2, max: 2 }, infoline: { min: 2, max: 2 },
  extended: { min: 2, max: 2 }, trendangle: { min: 2, max: 2 }, horizontal: { min: 1, max: 1 },
  ray: { min: 1, max: 1 }, vertical: { min: 1, max: 1 }, crossline: { min: 1, max: 1 }, channel: { min: 3, max: 3 },
  fib: { min: 2, max: 2 }, fibext: { min: 3, max: 3 }, pitchfork: { min: 3, max: 3 },
  xabcd: { min: 5, max: 5 }, abcd: { min: 4, max: 4 }, trianglepattern: { min: 4, max: 4 },
  headshoulders: { min: 7, max: 7 }, elliott: { min: 6, max: 6 },
  long: { min: 3, max: 3 }, short: { min: 3, max: 3 }, pricerange: { min: 2, max: 2 },
  daterange: { min: 2, max: 2 }, ruler: { min: 2, max: 2 },
  brush: { min: 2, max: 2000 }, highlighter: { min: 2, max: 2000 }, arrow: { min: 2, max: 2 },
  arrowup: { min: 1, max: 1 }, arrowdown: { min: 1, max: 1 }, rectangle: { min: 2, max: 2 },
  ellipse: { min: 2, max: 2 }, triangleshape: { min: 3, max: 3 }, polyline: { min: 2, max: 64 },
  text: { min: 1, max: 1 }, note: { min: 1, max: 1 }, callout: { min: 2, max: 2 }, pricelabel: { min: 1, max: 1 },
};

/** Kinds that carry the trader's own words and are meaningless without them. */
export const DRAWING_TEXT_KINDS: readonly DrawingKind[] = ['text', 'note', 'callout'];
/** Kinds drawn by dragging the pointer, not by placing anchors. */
export const FREEHAND_KINDS: readonly DrawingKind[] = ['brush', 'highlighter'];

export type DrawingDash = 'solid' | 'dashed' | 'dotted';
export interface DrawingStyle { color: string; width: number; dash: DrawingDash; fill?: string }

/** TradingView's own defaults: its blue for lines and measurements, purple
 *  for shapes, green / red for the position tools and arrow marks. */
const TV_BLUE = '#2962ff';
export const DEFAULT_DRAWING_STYLES: Record<DrawingKind, DrawingStyle> = {
  trendline: { color: TV_BLUE, width: 2, dash: 'solid' }, rayline: { color: TV_BLUE, width: 2, dash: 'solid' },
  infoline: { color: TV_BLUE, width: 2, dash: 'solid' }, extended: { color: TV_BLUE, width: 2, dash: 'solid' },
  trendangle: { color: TV_BLUE, width: 2, dash: 'solid' }, horizontal: { color: TV_BLUE, width: 2, dash: 'solid' },
  ray: { color: TV_BLUE, width: 2, dash: 'solid' }, vertical: { color: TV_BLUE, width: 2, dash: 'solid' },
  crossline: { color: TV_BLUE, width: 2, dash: 'solid' }, channel: { color: TV_BLUE, width: 2, dash: 'solid', fill: TV_BLUE },
  fib: { color: '#787b86', width: 1, dash: 'solid' }, fibext: { color: '#787b86', width: 1, dash: 'solid' },
  pitchfork: { color: '#f23645', width: 2, dash: 'solid' },
  xabcd: { color: TV_BLUE, width: 2, dash: 'solid', fill: TV_BLUE }, abcd: { color: '#089981', width: 2, dash: 'solid' },
  trianglepattern: { color: '#9c27b0', width: 2, dash: 'solid', fill: '#9c27b0' },
  headshoulders: { color: '#089981', width: 2, dash: 'solid', fill: '#089981' }, elliott: { color: '#3d85c6', width: 2, dash: 'solid' },
  long: { color: '#089981', width: 1, dash: 'solid' }, short: { color: '#f23645', width: 1, dash: 'solid' },
  pricerange: { color: TV_BLUE, width: 1, dash: 'solid', fill: TV_BLUE }, daterange: { color: TV_BLUE, width: 1, dash: 'solid', fill: TV_BLUE },
  ruler: { color: TV_BLUE, width: 1, dash: 'solid', fill: TV_BLUE },
  brush: { color: '#00bcd4', width: 2, dash: 'solid' }, highlighter: { color: '#ffeb3b', width: 12, dash: 'solid' },
  arrow: { color: TV_BLUE, width: 2, dash: 'solid' }, arrowup: { color: '#089981', width: 1, dash: 'solid' },
  arrowdown: { color: '#f23645', width: 1, dash: 'solid' },
  rectangle: { color: '#9c27b0', width: 2, dash: 'solid', fill: '#9c27b0' }, ellipse: { color: '#9c27b0', width: 2, dash: 'solid', fill: '#9c27b0' },
  triangleshape: { color: '#9c27b0', width: 2, dash: 'solid', fill: '#9c27b0' }, polyline: { color: TV_BLUE, width: 2, dash: 'solid' },
  text: { color: TV_BLUE, width: 1, dash: 'solid' }, note: { color: TV_BLUE, width: 1, dash: 'solid' },
  callout: { color: TV_BLUE, width: 1, dash: 'solid' }, pricelabel: { color: TV_BLUE, width: 1, dash: 'solid' },
};
/** The swatches the object toolbar offers — TradingView's palette columns. */
export const DRAWING_PALETTE = [
  '#ffffff', '#b2b5be', '#787b86', '#434651', '#131722',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981',
  '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
] as const;
export const DRAWING_WIDTHS = [1, 2, 3, 4] as const;

export function sanitizeDrawingStyle(value: unknown): DrawingStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const hex = (c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  if (!hex(v.color) || typeof v.width !== 'number' || !Number.isFinite(v.width)) return undefined;
  const dash = v.dash === 'dashed' || v.dash === 'dotted' ? v.dash : 'solid';
  const style: DrawingStyle = { color: v.color as string, width: Math.max(1, Math.min(24, Math.round(v.width))), dash };
  if (hex(v.fill)) style.fill = v.fill as string;
  return style;
}

/** The style a drawing is painted with: its own, or its kind's default. */
export function drawingStyle(drawing: Pick<StoredDrawing, 'kind' | 'style'>): DrawingStyle {
  return drawing.style ?? DEFAULT_DRAWING_STYLES[drawing.kind];
}

export function dashArray(dash: DrawingDash, width: number): string | undefined {
  if (dash === 'dashed') return `${Math.max(4, width * 3)} ${Math.max(3, width * 2)}`;
  if (dash === 'dotted') return `${Math.max(1, width)} ${Math.max(3, width * 2)}`;
  return undefined;
}

// ── Measurements, in TradingView's own wording ──────────────────────

const DURATION_UNITS: Record<string, [string, string, string]> = {
  ru: ['д', 'ч', 'мин'], en: ['d', 'h', 'm'], es: ['d', 'h', 'min'], zh: ['天', '小时', '分'],
  ja: ['日', '時間', '分'], ko: ['일', '시간', '분'], hi: ['दि', 'घं', 'मि'],
};
/** «6ч 45мин», «2д 3ч», «45мин» — the two largest non-zero units, as TradingView prints a range. */
export function formatDrawingDuration(seconds: number, lang = 'en'): string {
  const [d, h, m] = DURATION_UNITS[lang] ?? DURATION_UNITS.en;
  const total = Math.max(0, Math.round(Math.abs(seconds) / 60));
  const days = Math.floor(total / 1440), hours = Math.floor((total % 1440) / 60), minutes = total % 60;
  const parts = [days ? `${days}${d}` : '', hours ? `${hours}${h}` : '', minutes ? `${minutes}${m}` : ''].filter(Boolean);
  return parts.slice(0, 2).join(' ') || `0${m}`;
}

/** 435.06M, 1.2K — the way TradingView prints a volume. */
export function formatDrawingVolume(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  for (const [limit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (abs >= limit) return `${(value / limit).toFixed(2)}${suffix}`;
  }
  return value.toFixed(abs >= 100 ? 0 : 2);
}

const BAR_WORD: Record<string, string> = { ru: 'столбцы', en: 'bars', es: 'barras', zh: '根K线', ja: '本', ko: '봉', hi: 'बार' };
const VOLUME_WORD: Record<string, string> = { ru: 'Объем', en: 'Vol', es: 'Vol', zh: '成交量', ja: '出来高', ko: '거래량', hi: 'वॉल्यूम' };

export interface DrawingRange {
  priceDiff: number; pct: number | null; ticks: number | null;
  bars: number; seconds: number; volume: number | null;
}

/** What a date-and-price range reports between two anchors. */
export function drawingRange(a: DrawingPoint, b: DrawingPoint, candles: readonly { time: number; volume?: number }[], intervalSeconds: number, minMove?: number): DrawingRange {
  const measured = drawingMeasurement(a, b, intervalSeconds, candles.map((c) => c.time));
  const lo = Math.min(a.time, b.time), hi = Math.max(a.time, b.time);
  const inRange = candles.filter((c) => c.time >= lo && c.time < hi && Number.isFinite(c.volume));
  const volume = inRange.length ? inRange.reduce((sum, c) => sum + (c.volume ?? 0), 0) : null;
  const ticks = minMove && minMove > 0 && Number.isFinite(measured.priceDiff) ? Math.round(measured.priceDiff / minMove) : null;
  return { priceDiff: measured.priceDiff, pct: measured.pct, ticks, bars: measured.bars, seconds: hi - lo, volume };
}

/** The label lines, exactly TradingView's: «0.08128 (7.91%) 8,128» / «6 столбцы, 6ч 45мин» / «Объем 435.06M». */
export function drawingRangeLines(range: DrawingRange, lang = 'en', parts: { price?: boolean; date?: boolean } = { price: true, date: true }): string[] {
  const lines: string[] = [];
  if (parts.price !== false) {
    const pct = range.pct === null ? '—' : `${range.pct.toFixed(2)}%`;
    const ticks = range.ticks === null ? '' : ` ${range.ticks.toLocaleString('en-US')}`;
    lines.push(`${formatDrawingPrice(range.priceDiff)} (${pct})${ticks}`);
  }
  if (parts.date !== false) {
    lines.push(`${range.bars} ${BAR_WORD[lang] ?? BAR_WORD.en}, ${formatDrawingDuration(range.seconds, lang)}`);
    if (range.volume !== null) lines.push(`${VOLUME_WORD[lang] ?? VOLUME_WORD.en} ${formatDrawingVolume(range.volume)}`);
  }
  return lines;
}

/** TradingView's trend-based extension levels, projected from the third anchor. */
export const FIB_EXTENSION_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236] as const;
export function drawingExtensions(a: number, b: number, c: number) {
  if (![a, b, c].every(Number.isFinite)) return [];
  return FIB_EXTENSION_LEVELS.map((level) => ({ level, price: c + (b - a) * level }));
}

/** Target, stop and risk/reward of a long or short position tool. */
export function positionMetrics(kind: 'long' | 'short', entry: number, target: number, stop: number) {
  const reward = kind === 'long' ? target - entry : entry - target;
  const risk = kind === 'long' ? entry - stop : stop - entry;
  const pct = (price: number) => (entry > 0 ? ((price - entry) / entry) * 100 : null);
  return {
    targetDiff: target - entry, targetPct: pct(target), stopDiff: stop - entry, stopPct: pct(stop),
    ratio: risk > 0 && reward >= 0 ? reward / risk : null,
  };
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
  kind: DrawingKind;
  points: DrawingPoint[];
  text?: string;
  /** Present only once the trader has changed it; absent means the kind's default. */
  style?: DrawingStyle;
  /** This one object is locked: it can be selected, not moved, edited or erased. */
  locked?: boolean;
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
const MIN_POINTS: Record<StoredDrawing['kind'], number> = Object.fromEntries(
  DRAWING_KINDS.map((kind) => [kind, DRAWING_POINTS[kind].min])) as Record<DrawingKind, number>;

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
    // Own keys only: an inherited name such as `toString` is not a kind.
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(MIN_POINTS, kind)) continue;
    if (!Array.isArray(d.points)) continue;
    const points = d.points.filter(validPoint).slice(0, DRAWING_POINTS[kind].max);
    if (points.length < MIN_POINTS[kind]) continue;
    const text = typeof d.text === 'string' ? d.text.slice(0, 280) : undefined;
    if (DRAWING_TEXT_KINDS.includes(kind) && !text) continue;
    const drawing: StoredDrawing = text === undefined ? { kind, points } : { kind, points, text };
    const style = sanitizeDrawingStyle(d.style);
    if (style) drawing.style = style;
    if (d.locked === true) drawing.locked = true;
    drawings.push(drawing);
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

/** Distance to an open or closed run of segments. */
export function distanceToPolyline(p: ScreenPoint, points: readonly ScreenPoint[], closed = false): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  if (closed && points.length > 2) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));
  return best;
}

/** Even-odd containment, for selecting a filled shape by its interior. */
export function pointInPolygon(p: ScreenPoint, points: readonly ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
