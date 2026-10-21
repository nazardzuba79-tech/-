import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * The height of the Futures account panel (positions, orders, history) on a
 * desktop, as the trader sets it by dragging the divider under the chart.
 *
 * Presentation only. The panel's tables, their readers and every trading
 * action are untouched: this module only decides how many pixels the grid
 * row under the chart gets, through `--futures-account-height`, the custom
 * property the desktop grid already reads (FuturesFigmaDesktop.css). The
 * chart row is `minmax(300px, 1fr)`, so it gives back exactly what the panel
 * takes and never drops under its floor.
 *
 * `null` means "the design's own default" (200px populated / 160px empty):
 * nothing is written until the trader moves the divider, and a double click
 * on it returns to that default. The choice is kept in this browser under a
 * versioned key, as the chart settings are; an unreadable or out-of-range
 * value is ignored, never clamped into a surprise.
 */
export const FUTURES_ACCOUNT_PANEL_KEY = 'voltex.futuresAccountPanel.v1';
/** The 44px tab row, the 32px column headings, one 68px position row and room for its scrollbar. */
export const FUTURES_ACCOUNT_PANEL_MIN = 160;
/** The chart's floor, the same 300px the desktop grid already reserves for it. */
export const FUTURES_CHART_FLOOR = 300;
/** Keyboard step on the separator, as on the Spot terminal's divider. */
export const FUTURES_ACCOUNT_PANEL_STEP = 24;
const ABSOLUTE_MAX = 2000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStorage = (): StorageLike | null => (typeof localStorage === 'undefined' ? null : localStorage);

export function readFuturesAccountPanelHeight(storage: StorageLike | null = browserStorage()): number | null {
  try {
    const raw = storage?.getItem(FUTURES_ACCOUNT_PANEL_KEY);
    if (!raw) return null;
    const height = Number((JSON.parse(raw) as { height?: unknown })?.height);
    return Number.isFinite(height) && height >= FUTURES_ACCOUNT_PANEL_MIN && height <= ABSOLUTE_MAX ? Math.round(height) : null;
  } catch {
    return null;
  }
}

export function writeFuturesAccountPanelHeight(height: number | null, storage: StorageLike | null = browserStorage()): void {
  try {
    if (height === null) storage?.removeItem(FUTURES_ACCOUNT_PANEL_KEY);
    else storage?.setItem(FUTURES_ACCOUNT_PANEL_KEY, JSON.stringify({ height: Math.round(height) }));
  } catch { /* private mode: the choice lasts this visit */ }
}

/** Between the panel's minimum and the ceiling the terminal allows right now. */
export function clampFuturesAccountPanelHeight(height: number, max: number): number {
  const ceiling = Math.max(FUTURES_ACCOUNT_PANEL_MIN, Math.floor(max));
  return Math.min(ceiling, Math.max(FUTURES_ACCOUNT_PANEL_MIN, Math.round(height)));
}

/** The tallest panel that still leaves the chart its floor: the terminal's
 *  height minus the instrument row, the two grid gaps and the chart floor. */
export function futuresAccountPanelMax(terminal: { height: number; firstRow: number; rowGap: number }): number {
  return Math.max(FUTURES_ACCOUNT_PANEL_MIN, Math.floor(terminal.height - terminal.firstRow - 2 * terminal.rowGap - FUTURES_CHART_FLOOR));
}

/** The grid's own numbers, read from the computed style so every desktop
 *  layout (56px or 70px instrument row, 0 or 4px gaps) measures itself. */
export function measureTerminalRows(terminal: HTMLElement): { height: number; firstRow: number; rowGap: number } {
  const style = getComputedStyle(terminal);
  return {
    height: terminal.clientHeight,
    firstRow: parseFloat(style.gridTemplateRows.split(' ')[0]) || 0,
    rowGap: parseFloat(style.rowGap) || 0,
  };
}

export interface FuturesAccountPanelResize {
  /** The trader's height, or null for the design default. */
  height: number | null;
  /** True while a user height is applied to the grid. */
  active: boolean;
  resizing: boolean;
  min: number;
  max: number;
  /** The effective panel height, for aria-valuenow. */
  valueNow: number;
  /** Put on `.terminal`: the custom property the grid rows read. */
  style: React.CSSProperties | undefined;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  reset: () => void;
}

export function useFuturesAccountPanelHeight(enabled: boolean, terminalRef: React.RefObject<HTMLElement | null>): FuturesAccountPanelResize {
  const [height, setHeight] = useState<number | null>(() => readFuturesAccountPanelHeight());
  const [max, setMax] = useState(FUTURES_ACCOUNT_PANEL_MIN);
  const [measured, setMeasured] = useState(FUTURES_ACCOUNT_PANEL_MIN);
  const [resizing, setResizing] = useState(false);
  const maxRef = useRef(max);
  maxRef.current = max;

  // The ceiling follows the terminal: a shorter window lowers it, and the
  // applied height is re-clamped below, so the chart keeps its floor.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!enabled || !terminal || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      setMax(futuresAccountPanelMax(measureTerminalRows(terminal)));
      const panel = terminal.querySelector<HTMLElement>('.bottom-panel');
      if (panel) setMeasured(Math.round(panel.getBoundingClientRect().height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(terminal);
    const panel = terminal.querySelector<HTMLElement>('.bottom-panel');
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [enabled, terminalRef]);

  const panelHeightNow = useCallback(() => {
    const panel = terminalRef.current?.querySelector<HTMLElement>('.bottom-panel');
    return panel ? panel.getBoundingClientRect().height : (height ?? FUTURES_ACCOUNT_PANEL_MIN);
  }, [terminalRef, height]);

  const apply = useCallback((next: number, persist: boolean) => {
    const clamped = clampFuturesAccountPanelHeight(next, maxRef.current);
    setHeight(clamped);
    if (persist) writeFuturesAccountPanelHeight(clamped);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const startY = event.clientY;
    const startHeight = panelHeightNow();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a synthetic event without capture */ }
    setResizing(true);
    const move = (e: PointerEvent) => apply(startHeight + startY - e.clientY, false);
    const stop = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setResizing(false);
      apply(startHeight + startY - e.clientY, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    event.preventDefault();
  }, [apply, panelHeightNow]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    apply(panelHeightNow() + (event.key === 'ArrowUp' ? FUTURES_ACCOUNT_PANEL_STEP : -FUTURES_ACCOUNT_PANEL_STEP), true);
  }, [apply, panelHeightNow]);

  const reset = useCallback(() => { setHeight(null); writeFuturesAccountPanelHeight(null); }, []);

  const active = enabled && height !== null;
  const applied = active ? clampFuturesAccountPanelHeight(height, max) : null;
  return {
    height, active, resizing, min: FUTURES_ACCOUNT_PANEL_MIN, max,
    valueNow: applied ?? measured,
    style: applied === null ? undefined : ({ '--futures-account-height': `${applied}px` } as React.CSSProperties),
    onPointerDown, onKeyDown, reset,
  };
}
