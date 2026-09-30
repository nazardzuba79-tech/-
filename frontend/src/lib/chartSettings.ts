/**
 * Viewer preferences for the VOLTEX futures chart, as the reference's
 * TradingView «Настройки» dialog keeps them: candle colours (with presets),
 * the plot's background, grid and crosshair, a pair watermark, and whether
 * volume and the last-price line are drawn.
 *
 * Kept per browser in localStorage. Nothing here reaches the server, the
 * candles or any order: it only changes how the same data is painted.
 * A dialog edits a draft that is applied live (`preview`) and either kept
 * (`save`) or thrown away (`revert`).
 */

export type ChartGridMode = 'none' | 'horizontal' | 'vertical' | 'all';
export type ChartColorPreset = 'standard' | 'classic' | 'asia' | 'custom';

export interface ChartSettings {
  preset: ChartColorPreset;
  bodyUp: string; bodyDown: string;
  borderUp: string; borderDown: string;
  wickUp: string; wickDown: string;
  body: boolean; border: boolean; wick: boolean;
  /** null keeps the terminal's own surface behind the plot. */
  background: string | null;
  grid: ChartGridMode; gridColor: string;
  crosshair: string;
  watermark: boolean;
  volume: boolean;
  lastPriceLine: boolean;
}

/** Up / down pairs. «standard» is the order book's own buy and sell colour. */
export const CHART_PRESETS: Record<Exclude<ChartColorPreset, 'custom'>, readonly [string, string]> = {
  standard: ['#2ebd85', '#f6465d'],
  classic: ['#ffffff', '#ff9800'],
  asia: ['#f6465d', '#2ebd85'],
};

export const DEFAULT_CHART_SETTINGS: Readonly<ChartSettings> = Object.freeze({
  preset: 'standard',
  bodyUp: CHART_PRESETS.standard[0], bodyDown: CHART_PRESETS.standard[1],
  borderUp: CHART_PRESETS.standard[0], borderDown: CHART_PRESETS.standard[1],
  wickUp: CHART_PRESETS.standard[0], wickDown: CHART_PRESETS.standard[1],
  body: true, border: true, wick: true,
  background: null,
  grid: 'none', gridColor: '#2a2d35',
  crosshair: '#f0b90b',
  watermark: false,
  volume: true,
  lastPriceLine: true,
});

export const CHART_SETTINGS_KEY = 'voltex.chartSettings.v1';
const HEX = /^#[0-9a-f]{6}$/i;
const GRID: readonly ChartGridMode[] = ['none', 'horizontal', 'vertical', 'all'];
const PRESET: readonly ChartColorPreset[] = ['standard', 'classic', 'asia', 'custom'];
const COLOR_KEYS = ['bodyUp', 'bodyDown', 'borderUp', 'borderDown', 'wickUp', 'wickDown', 'gridColor', 'crosshair'] as const;
const FLAG_KEYS = ['body', 'border', 'wick', 'watermark', 'volume', 'lastPriceLine'] as const;

/** Anything stored is re-checked field by field: a bad value falls back to its default. */
export function normalizeChartSettings(raw: unknown): ChartSettings {
  const s: ChartSettings = { ...DEFAULT_CHART_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  for (const k of COLOR_KEYS) if (typeof r[k] === 'string' && HEX.test(r[k] as string)) s[k] = (r[k] as string).toLowerCase();
  for (const k of FLAG_KEYS) if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  if (typeof r.preset === 'string' && PRESET.includes(r.preset as ChartColorPreset)) s.preset = r.preset as ChartColorPreset;
  if (typeof r.grid === 'string' && GRID.includes(r.grid as ChartGridMode)) s.grid = r.grid as ChartGridMode;
  if (r.background === null || (typeof r.background === 'string' && HEX.test(r.background))) s.background = r.background === null ? null : (r.background as string).toLowerCase();
  // A candle with neither a body nor an outline would not be drawn at all.
  if (!s.body && !s.border) s.body = true;
  return s;
}

/** The colours of one preset, applied to body, border and wick alike. */
export function withPreset(s: ChartSettings, preset: Exclude<ChartColorPreset, 'custom'>): ChartSettings {
  const [up, down] = CHART_PRESETS[preset];
  return { ...s, preset, bodyUp: up, bodyDown: down, borderUp: up, borderDown: down, wickUp: up, wickDown: down };
}

function read(): ChartSettings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CHART_SETTINGS_KEY);
    return raw ? normalizeChartSettings(JSON.parse(raw)) : { ...DEFAULT_CHART_SETTINGS };
  } catch {
    return { ...DEFAULT_CHART_SETTINGS };
  }
}

let saved: ChartSettings | null = null;
let applied: ChartSettings | null = null;
const listeners = new Set<(s: ChartSettings) => void>();
const emit = () => { const s = getChartSettings(); listeners.forEach(fn => fn(s)); };

/** What the chart should paint right now (a dialog's draft while it is open). */
export function getChartSettings(): ChartSettings {
  if (!saved) saved = read();
  return applied ?? saved;
}
export function getSavedChartSettings(): ChartSettings {
  if (!saved) saved = read();
  return saved;
}
/** Paint a draft without keeping it. */
export function previewChartSettings(draft: ChartSettings): void { applied = normalizeChartSettings(draft); emit(); }
/** Drop the draft and paint what is kept. */
export function revertChartSettings(): void { applied = null; emit(); }
/** Keep the draft in this browser. */
export function saveChartSettings(next: ChartSettings): void {
  saved = normalizeChartSettings(next); applied = null;
  try { localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify(saved)); } catch { /* private mode: the choice lasts this visit */ }
  emit();
}
export function subscribeChartSettings(fn: (s: ChartSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
if (typeof window !== 'undefined') {
  // Another tab saved: follow it.
  window.addEventListener('storage', e => { if (e.key === CHART_SETTINGS_KEY) { saved = read(); if (!applied) emit(); } });
}

/** `#rrggbb` → `rgba(r,g,b,a)`, for volume bars drawn in the candle colours. */
export function rgbaOf(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** For tests only: forget the cached copy so the next read hits storage. */
export function resetChartSettingsCache(): void { saved = null; applied = null; }
