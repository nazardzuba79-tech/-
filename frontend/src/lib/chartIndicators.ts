/**
 * The chart's indicator catalogue and the viewer's instances of it
 * (Issue #502, 2026-10-10).
 *
 * A catalogue entry says what an indicator is: which pane it belongs in,
 * which parameters it takes and which lines it draws. An instance is one
 * copy of it on the chart with the viewer's parameters, colours, width and
 * visibility. Instances are kept per browser in localStorage, the same way
 * `chartSettings` keeps the chart's paint, with the same draft / keep /
 * throw-away flow for the settings dialog.
 *
 * Every value drawn comes out of `computeIndicator`, which only calls the
 * pure math in `./indicators` over the chart's own candles. Nothing here
 * invents data or adds a control that has no computation behind it.
 */
import {
  computeSMA, computeEMA, computeWMA, computeVWAP, computeBollingerBands, computeRSI, computeMACD, computeATR,
  computeStochastic, computeStochRSI, computeOBV, computeADX, computeSupertrend, computeCCI, computeWilliamsR,
  type Candle, type LinePoint,
} from './indicators';

export type IndicatorType =
  | 'ma' | 'ema' | 'wma' | 'vwap' | 'bollinger' | 'supertrend'
  | 'rsi' | 'macd' | 'atr' | 'stochastic' | 'stochrsi' | 'obv' | 'adx' | 'cci' | 'williams';
/** `price`: drawn over the candles on the price scale. `lower`: its own pane and scale. */
export type IndicatorPane = 'price' | 'lower';
export type IndicatorLineWidth = 1 | 2 | 3 | 4;

export interface IndicatorParamSpec { key: string; label: string; min: number; max: number; step: number; default: number; }
export interface IndicatorLineSpec { key: string; label: string; color: string; dashed?: boolean; /** A colour the indicator paints with, not a line of its own (Supertrend's down colour). */ colorOnly?: boolean; }
export interface IndicatorDefinition {
  type: IndicatorType;
  /** Short name as every platform prints it (SMA, EMA, RSI…); the i18n key gives the long name. */
  short: string;
  label: string;
  pane: IndicatorPane;
  params: IndicatorParamSpec[];
  lines: IndicatorLineSpec[];
  /** MACD's bars. */
  histogram?: { key: string; label: string };
  /** A bounded oscillator keeps these limits on its own scale. */
  bounds?: [number, number];
  /** Horizontal reference levels on the lower pane (RSI 30/70 and the like). */
  levels?: number[];
}

const period = (def: number, max = 500): IndicatorParamSpec => ({ key: 'period', label: 'chart.settings.indicatorPeriod', min: 1, max, step: 1, default: def });

export const INDICATOR_CATALOGUE: readonly IndicatorDefinition[] = Object.freeze([
  { type: 'ma', short: 'SMA', label: 'chart.indicator.sma', pane: 'price', params: [period(200)], lines: [{ key: 'line', label: 'chart.indicator.sma', color: '#f7d51d' }] },
  { type: 'ema', short: 'EMA', label: 'chart.indicator.ema', pane: 'price', params: [period(20)], lines: [{ key: 'line', label: 'chart.indicator.ema', color: '#60a5fa' }] },
  { type: 'wma', short: 'WMA', label: 'chart.indicator.wma', pane: 'price', params: [period(20)], lines: [{ key: 'line', label: 'chart.indicator.wma', color: '#f472b6' }] },
  { type: 'vwap', short: 'VWAP', label: 'chart.indicator.vwap', pane: 'price', params: [], lines: [{ key: 'line', label: 'chart.indicator.vwap', color: '#e879f9' }] },
  { type: 'bollinger', short: 'BB', label: 'chart.indicator.bollinger', pane: 'price',
    params: [period(20), { key: 'mult', label: 'chart.settings.indicatorDeviation', min: 0.5, max: 5, step: 0.1, default: 2 }],
    lines: [{ key: 'upper', label: 'chart.settings.lineUpper', color: '#5b8def' }, { key: 'middle', label: 'chart.settings.lineMiddle', color: '#5b8def', dashed: true }, { key: 'lower', label: 'chart.settings.lineLower', color: '#5b8def' }] },
  { type: 'supertrend', short: 'ST', label: 'chart.indicator.supertrend', pane: 'price',
    params: [period(10), { key: 'mult', label: 'chart.settings.indicatorMultiplier', min: 0.5, max: 10, step: 0.1, default: 3 }],
    lines: [{ key: 'up', label: 'chart.settings.up', color: '#2ebd85' }, { key: 'down', label: 'chart.settings.down', color: '#f6465d', colorOnly: true }] },
  { type: 'rsi', short: 'RSI', label: 'chart.indicator.rsi', pane: 'lower', params: [period(14)], lines: [{ key: 'line', label: 'chart.indicator.rsi', color: '#c084fc' }], bounds: [0, 100], levels: [30, 70] },
  { type: 'macd', short: 'MACD', label: 'chart.indicator.macd', pane: 'lower',
    params: [{ key: 'fast', label: 'chart.settings.indicatorFast', min: 1, max: 200, step: 1, default: 12 }, { key: 'slow', label: 'chart.settings.indicatorSlow', min: 2, max: 400, step: 1, default: 26 }, { key: 'signal', label: 'chart.settings.indicatorSignal', min: 1, max: 100, step: 1, default: 9 }],
    lines: [{ key: 'macd', label: 'MACD', color: '#5b8def' }, { key: 'signal', label: 'chart.settings.indicatorSignal', color: '#f7a600' }], histogram: { key: 'histogram', label: 'chart.settings.lineHistogram' } },
  { type: 'atr', short: 'ATR', label: 'chart.indicator.atr', pane: 'lower', params: [period(14)], lines: [{ key: 'line', label: 'chart.indicator.atr', color: '#f59e0b' }] },
  { type: 'stochastic', short: 'Stoch', label: 'chart.indicator.stochastic', pane: 'lower',
    params: [{ key: 'kPeriod', label: '%K', min: 1, max: 200, step: 1, default: 14 }, { key: 'kSmooth', label: 'chart.settings.indicatorSmoothing', min: 1, max: 50, step: 1, default: 3 }, { key: 'dPeriod', label: '%D', min: 1, max: 50, step: 1, default: 3 }],
    lines: [{ key: 'k', label: '%K', color: '#38bdf8' }, { key: 'd', label: '%D', color: '#f97316' }], bounds: [0, 100], levels: [20, 80] },
  { type: 'stochrsi', short: 'StochRSI', label: 'chart.indicator.stochrsi', pane: 'lower',
    params: [{ key: 'rsiPeriod', label: 'RSI', min: 2, max: 200, step: 1, default: 14 }, { key: 'stochPeriod', label: 'Stoch', min: 2, max: 200, step: 1, default: 14 }, { key: 'kSmooth', label: '%K', min: 1, max: 50, step: 1, default: 3 }, { key: 'dPeriod', label: '%D', min: 1, max: 50, step: 1, default: 3 }],
    lines: [{ key: 'k', label: '%K', color: '#38bdf8' }, { key: 'd', label: '%D', color: '#f97316' }], bounds: [0, 100], levels: [20, 80] },
  { type: 'obv', short: 'OBV', label: 'chart.indicator.obv', pane: 'lower', params: [], lines: [{ key: 'line', label: 'chart.indicator.obv', color: '#34d399' }] },
  { type: 'adx', short: 'ADX', label: 'chart.indicator.adx', pane: 'lower', params: [period(14)],
    lines: [{ key: 'adx', label: 'ADX', color: '#f5f5f5' }, { key: 'plusDi', label: '+DI', color: '#2ebd85' }, { key: 'minusDi', label: '−DI', color: '#f6465d' }], bounds: [0, 100], levels: [25] },
  { type: 'cci', short: 'CCI', label: 'chart.indicator.cci', pane: 'lower', params: [period(20)], lines: [{ key: 'line', label: 'chart.indicator.cci', color: '#a78bfa' }], levels: [-100, 100] },
  { type: 'williams', short: '%R', label: 'chart.indicator.williams', pane: 'lower', params: [period(14)], lines: [{ key: 'line', label: 'chart.indicator.williams', color: '#fb7185' }], bounds: [-100, 0], levels: [-80, -20] },
]);

export const indicatorDefinition = (type: IndicatorType): IndicatorDefinition => INDICATOR_CATALOGUE.find(d => d.type === type)!;
const TYPES: readonly IndicatorType[] = INDICATOR_CATALOGUE.map(d => d.type);

export interface IndicatorInstance {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
  /** One colour per catalogue line, `#rrggbb`. */
  colors: string[];
  lineWidth: IndicatorLineWidth;
  visible: boolean;
}

/** The chart as it opened before this catalogue existed: one SMA 200. */
export const DEFAULT_CHART_INDICATORS: readonly IndicatorInstance[] = Object.freeze([
  Object.freeze({ id: 'ma-200', type: 'ma' as const, params: { period: 200 }, colors: ['#f7d51d'], lineWidth: 1 as const, visible: true }),
]);

export const CHART_INDICATORS_KEY = 'voltex.chartIndicators.v1';
const HEX = /^#[0-9a-f]{6}$/i;
const WIDTHS: readonly IndicatorLineWidth[] = [1, 2, 3, 4];
/** Keep the chart responsive: this many instances is already more than a screen can read. */
export const MAX_CHART_INDICATORS = 12;

let counter = 0;
export function newIndicatorInstance(type: IndicatorType): IndicatorInstance {
  const def = indicatorDefinition(type);
  return {
    id: `${type}-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    type,
    params: Object.fromEntries(def.params.map(p => [p.key, p.default])),
    colors: def.lines.map(l => l.color),
    lineWidth: 1,
    visible: true,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Re-check one stored instance field by field; a bad field falls back to the catalogue default, a bad type drops the instance. */
export function normalizeIndicatorInstance(raw: unknown): IndicatorInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string' || !TYPES.includes(r.type as IndicatorType)) return null;
  const def = indicatorDefinition(r.type as IndicatorType);
  const params: Record<string, number> = {};
  const given = r.params && typeof r.params === 'object' ? (r.params as Record<string, unknown>) : {};
  for (const p of def.params) {
    const v = given[p.key];
    params[p.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v / p.step) * p.step, p.min, p.max) : p.default;
    // Round away the float noise of step arithmetic (0.1 × 3 is not 0.3).
    params[p.key] = Number(params[p.key].toFixed(4));
  }
  const colors = def.lines.map((l, i) => {
    const c = Array.isArray(r.colors) ? r.colors[i] : undefined;
    return typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : l.color;
  });
  const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : newIndicatorInstance(def.type).id;
  return {
    id, type: def.type, params, colors,
    lineWidth: WIDTHS.includes(r.lineWidth as IndicatorLineWidth) ? (r.lineWidth as IndicatorLineWidth) : 1,
    visible: typeof r.visible === 'boolean' ? r.visible : true,
  };
}

export function normalizeIndicatorInstances(raw: unknown): IndicatorInstance[] {
  if (!Array.isArray(raw)) return DEFAULT_CHART_INDICATORS.map(i => ({ ...i, params: { ...i.params }, colors: [...i.colors] }));
  const seen = new Set<string>();
  const out: IndicatorInstance[] = [];
  for (const item of raw) {
    const inst = normalizeIndicatorInstance(item);
    if (!inst || seen.has(inst.id)) continue;
    seen.add(inst.id); out.push(inst);
    if (out.length >= MAX_CHART_INDICATORS) break;
  }
  return out;
}

/** «SMA 200», «BB 20 · 2», «MACD 12 · 26 · 9» — the name the legend and menus print. */
export function indicatorInstanceLabel(inst: IndicatorInstance): string {
  const def = indicatorDefinition(inst.type);
  const values = def.params.map(p => String(inst.params[p.key] ?? p.default));
  return values.length ? `${def.short} ${values.join(' · ')}` : def.short;
}

export interface IndicatorOutput {
  /** Keyed by the catalogue line key. Supertrend's single line is under `up` with per-point colours. */
  lines: Record<string, (LinePoint & { color?: string })[]>;
  histogram?: (LinePoint & { color: string })[];
}

const p = (inst: IndicatorInstance, key: string) => inst.params[key] ?? indicatorDefinition(inst.type).params.find(x => x.key === key)!.default;

/** All the numbers an instance draws, from the chart's own candles. */
export function computeIndicator(inst: IndicatorInstance, candles: Candle[], options: { macdWarmupFromValid?: boolean } = {}): IndicatorOutput {
  switch (inst.type) {
    case 'ma': return { lines: { line: computeSMA(candles, p(inst, 'period')) } };
    case 'ema': return { lines: { line: computeEMA(candles, p(inst, 'period')) } };
    case 'wma': return { lines: { line: computeWMA(candles, p(inst, 'period')) } };
    case 'vwap': return { lines: { line: computeVWAP(candles) } };
    case 'bollinger': { const b = computeBollingerBands(candles, p(inst, 'period'), p(inst, 'mult')); return { lines: { upper: b.upper, middle: b.middle, lower: b.lower } }; }
    case 'supertrend': return { lines: { up: computeSupertrend(candles, p(inst, 'period'), p(inst, 'mult'), { up: inst.colors[0], down: inst.colors[1] }) } };
    case 'rsi': return { lines: { line: computeRSI(candles, p(inst, 'period')) } };
    case 'macd': {
      const m = computeMACD(candles, p(inst, 'fast'), p(inst, 'slow'), p(inst, 'signal'), { warmupFromValidMacd: options.macdWarmupFromValid });
      return { lines: { macd: m.macd, signal: m.signal }, histogram: m.histogram };
    }
    case 'atr': return { lines: { line: computeATR(candles, p(inst, 'period')) } };
    case 'stochastic': { const s = computeStochastic(candles, p(inst, 'kPeriod'), p(inst, 'kSmooth'), p(inst, 'dPeriod')); return { lines: { k: s.k, d: s.d } }; }
    case 'stochrsi': { const s = computeStochRSI(candles, p(inst, 'rsiPeriod'), p(inst, 'stochPeriod'), p(inst, 'kSmooth'), p(inst, 'dPeriod')); return { lines: { k: s.k, d: s.d } }; }
    case 'obv': return { lines: { line: computeOBV(candles) } };
    case 'adx': { const a = computeADX(candles, p(inst, 'period')); return { lines: { adx: a.adx, plusDi: a.plusDi, minusDi: a.minusDi } }; }
    case 'cci': return { lines: { line: computeCCI(candles, p(inst, 'period')) } };
    case 'williams': return { lines: { line: computeWilliamsR(candles, p(inst, 'period')) } };
  }
}

// ── Per-browser store: saved list, a dialog's draft, listeners ─────────────

function read(): IndicatorInstance[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CHART_INDICATORS_KEY);
    return normalizeIndicatorInstances(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeIndicatorInstances(undefined);
  }
}

let saved: IndicatorInstance[] | null = null;
let applied: IndicatorInstance[] | null = null;
const listeners = new Set<(list: IndicatorInstance[]) => void>();
const emit = () => { const list = getChartIndicators(); listeners.forEach(fn => fn(list)); };

/** What the chart should draw right now (a dialog's draft while it is open). */
export function getChartIndicators(): IndicatorInstance[] {
  if (!saved) saved = read();
  return applied ?? saved;
}
export function getSavedChartIndicators(): IndicatorInstance[] {
  if (!saved) saved = read();
  return saved;
}
/** Draw a draft without keeping it. */
export function previewChartIndicators(draft: IndicatorInstance[]): void { applied = normalizeIndicatorInstances(draft); emit(); }
/** Drop the draft and draw what is kept. */
export function revertChartIndicators(): void { if (applied === null) return; applied = null; emit(); }
/** Keep the list in this browser. */
export function saveChartIndicators(next: IndicatorInstance[]): void {
  saved = normalizeIndicatorInstances(next); applied = null;
  try { localStorage.setItem(CHART_INDICATORS_KEY, JSON.stringify(saved)); } catch { /* private mode: the choice lasts this visit */ }
  emit();
}
export function subscribeChartIndicators(fn: (list: IndicatorInstance[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === CHART_INDICATORS_KEY) { saved = read(); if (!applied) emit(); } });
}
/** For tests only. */
export function resetChartIndicatorsCache(): void { saved = null; applied = null; }
