import { useCallback, useEffect, useState } from 'react';

/**
 * The height of the Futures account panel (positions / orders / history /
 * assets) on desktop, as the trader sets it by dragging the panel's top edge
 * — the Bybit gesture, and the one the Spot terminal already offers through
 * its `orders-resize-handle`.
 *
 * `null` means "the stylesheet's own height": the approved Figma geometry
 * (`FuturesFigmaDesktop.css`, populated / status / folded variants) stays in
 * charge until the trader moves the edge. A moved edge is remembered across
 * reloads in this browser, because the trader chose it; a double-click on the
 * handle forgets it and the stylesheet's height returns.
 *
 * Nothing here touches positions, orders or balances: it is a display
 * preference of one panel's size.
 */
export const FUTURES_PANEL_HEIGHT_KEY = 'voltex.futures.accountPanelHeight';
/** Tabs (44) + the «Все фьючерсные позиции» line (36) + column heads (30) + one three-line position row (68) + the scrollbar track (4): the smallest useful panel. */
export const FUTURES_PANEL_MIN_HEIGHT = 184;
/** A hard ceiling for keyboard steps when the terminal cannot be measured; dragging measures the real one. */
export const FUTURES_PANEL_MAX_HEIGHT_FALLBACK = 640;
/** The chart keeps at least this much (the grid's own `minmax(300px, 1fr)` track). */
export const FUTURES_CHART_MIN_HEIGHT = 300;
export const FUTURES_PANEL_KEY_STEP = 24;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storage = (): StorageLike | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

/** Whole pixels inside [min, max]; anything else (NaN, Infinity, text) is `null`. */
export function clampPanelHeight(value: unknown, min = FUTURES_PANEL_MIN_HEIGHT, max = FUTURES_PANEL_MAX_HEIGHT_FALLBACK): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(Math.max(n, min), Math.max(min, max)));
}

export function readStoredPanelHeight(store: StorageLike | null = storage()): number | null {
  try { return clampPanelHeight(store?.getItem(FUTURES_PANEL_HEIGHT_KEY) ?? null); } catch { return null; }
}

export function writeStoredPanelHeight(height: number | null, store: StorageLike | null = storage()): void {
  try {
    if (height === null) store?.removeItem(FUTURES_PANEL_HEIGHT_KEY);
    else store?.setItem(FUTURES_PANEL_HEIGHT_KEY, String(height));
  } catch { /* private mode or a full store: the height simply is not remembered */ }
}

/**
 * The largest panel the terminal's box allows right now: the chart row keeps
 * its minimum, the pair row keeps its own height, and the grid's padding and
 * row gaps (`chrome`, 4 + 4 + 2 × 4 on the desktop grid) stay.
 */
export function maxPanelHeightFor(terminalHeight: number, tickerHeight: number, chrome = 16): number {
  const room = Math.floor(terminalHeight - tickerHeight - FUTURES_CHART_MIN_HEIGHT - chrome);
  return Math.max(FUTURES_PANEL_MIN_HEIGHT, Number.isFinite(room) ? room : FUTURES_PANEL_MIN_HEIGHT);
}

export function useFuturesPanelHeight() {
  const [height, setHeightState] = useState<number | null>(() => readStoredPanelHeight());
  useEffect(() => { writeStoredPanelHeight(height); }, [height]);
  const set = useCallback((next: number, max: number) => {
    const clamped = clampPanelHeight(next, FUTURES_PANEL_MIN_HEIGHT, max);
    if (clamped !== null) setHeightState(clamped);
  }, []);
  const reset = useCallback(() => setHeightState(null), []);
  return { height, set, reset };
}
