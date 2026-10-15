/**
 * The chart workspace's own state (2026-10-13): which view is open, which
 * timeframe and bar type, the quick timeframes, the compare and layout
 * settings, and the saved workspace presets («Шаблоны»).
 *
 * Kept per browser and per market (Spot and Futures apart), the way
 * `chartSettings` keeps the paint and `chartIndicators` keeps the instances.
 * Every stored value is re-checked field by field on read: a bad field falls
 * back to its default, an unknown version is treated as empty. Nothing here
 * reaches a server, a candle or an order.
 */
import { DEFAULT_CHART_TIMEFRAME, isChartTimeframe, normalizeQuickTimeframes, type ChartTimeframe } from './chartTimeframes';
import { isChartBarType, type ChartBarType } from './chartDerivedBars';
import { COMPARE_COLORS, MAX_COMPARE_SERIES } from './chartCompare';
import { normalizeIndicatorInstances, type IndicatorInstance, type IndicatorMarket } from './chartIndicators';

export type WorkspaceView = 'chart' | 'data' | 'analytics';
export type WorkspaceLayout = 1 | 2 | 4;
export type ComparePeriod = 'visible' | 'all' | '1d' | '1w' | '1M';

export interface CompareEntry { pair: string; color: string; visible: boolean }
export interface WorkspacePane { pair: string | null; timeframe: ChartTimeframe | null }

export interface ChartWorkspaceState {
  version: 1;
  view: WorkspaceView;
  timeframe: ChartTimeframe;
  quickTimeframes: ChartTimeframe[];
  barType: ChartBarType;
  compare: CompareEntry[];
  comparePeriod: ComparePeriod;
  layout: WorkspaceLayout;
  /** Extra panes beside the main chart (layout − 1 of them are shown). */
  panes: WorkspacePane[];
  syncCursor: boolean;
  syncTime: boolean;
  syncTimeframe: boolean;
  /** Pane index shown on a phone (0 = the main chart). */
  activePane: number;
}

export const DEFAULT_WORKSPACE: Readonly<ChartWorkspaceState> = Object.freeze({
  version: 1,
  view: 'chart',
  timeframe: DEFAULT_CHART_TIMEFRAME,
  quickTimeframes: normalizeQuickTimeframes(undefined),
  barType: 'candles',
  compare: [],
  comparePeriod: 'all',
  layout: 1,
  panes: [{ pair: null, timeframe: null }, { pair: null, timeframe: null }, { pair: null, timeframe: null }],
  syncCursor: true,
  syncTime: true,
  syncTimeframe: false,
  activePane: 0,
});

const VIEWS: readonly WorkspaceView[] = ['chart', 'data', 'analytics'];
const PERIODS: readonly ComparePeriod[] = ['visible', 'all', '1d', '1w', '1M'];
const HEX = /^#[0-9a-f]{6}$/i;
/** A venue pair (BTC/USDT) or a CFD symbol (XAUUSD, EURUSD). */
const PAIR = /^(?:[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}|[A-Z]{6})$/;

const fresh = (): ChartWorkspaceState => ({ ...DEFAULT_WORKSPACE, quickTimeframes: [...DEFAULT_WORKSPACE.quickTimeframes], compare: [], panes: DEFAULT_WORKSPACE.panes.map(p => ({ ...p })) });

export function normalizeCompare(raw: unknown): CompareEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CompareEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const pair = typeof (item as { pair?: unknown })?.pair === 'string' ? (item as { pair: string }).pair.toUpperCase() : '';
    if (!PAIR.test(pair) || seen.has(pair)) continue;
    seen.add(pair);
    const color = typeof (item as { color?: unknown }).color === 'string' && HEX.test((item as { color: string }).color) ? (item as { color: string }).color.toLowerCase() : COMPARE_COLORS[out.length % COMPARE_COLORS.length];
    out.push({ pair, color, visible: (item as { visible?: unknown }).visible !== false });
    if (out.length >= MAX_COMPARE_SERIES) break;
  }
  return out;
}

function normalizePanes(raw: unknown): WorkspacePane[] {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_WORKSPACE.panes.map((_, i) => {
    const item = list[i] as { pair?: unknown; timeframe?: unknown } | undefined;
    const pair = typeof item?.pair === 'string' && PAIR.test(item.pair.toUpperCase()) ? item.pair.toUpperCase() : null;
    const timeframe = isChartTimeframe(item?.timeframe) ? item!.timeframe : null;
    return { pair, timeframe };
  });
}

/** Anything stored is re-checked field by field. */
export function normalizeWorkspace(raw: unknown): ChartWorkspaceState {
  const s = fresh();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return s;
  if (typeof r.view === 'string' && VIEWS.includes(r.view as WorkspaceView)) s.view = r.view as WorkspaceView;
  if (isChartTimeframe(r.timeframe)) s.timeframe = r.timeframe;
  s.quickTimeframes = normalizeQuickTimeframes(r.quickTimeframes);
  if (isChartBarType(r.barType)) s.barType = r.barType;
  s.compare = normalizeCompare(r.compare);
  if (typeof r.comparePeriod === 'string' && PERIODS.includes(r.comparePeriod as ComparePeriod)) s.comparePeriod = r.comparePeriod as ComparePeriod;
  if (r.layout === 1 || r.layout === 2 || r.layout === 4) s.layout = r.layout;
  s.panes = normalizePanes(r.panes);
  for (const key of ['syncCursor', 'syncTime', 'syncTimeframe'] as const) if (typeof r[key] === 'boolean') s[key] = r[key] as boolean;
  if (typeof r.activePane === 'number' && Number.isInteger(r.activePane) && r.activePane >= 0 && r.activePane < 4) s.activePane = r.activePane;
  if (s.activePane >= s.layout) s.activePane = 0;
  return s;
}

export type WorkspaceMarket = IndicatorMarket;
export const workspaceStorageKey = (market: WorkspaceMarket) => `voltex.chartWorkspace.${market}.v1`;

type Store = { state: ChartWorkspaceState | null; listeners: Set<(s: ChartWorkspaceState) => void> };
const stores: Record<WorkspaceMarket, Store> = { spot: { state: null, listeners: new Set() }, futures: { state: null, listeners: new Set() }, cfd: { state: null, listeners: new Set() } };

function read(market: WorkspaceMarket): ChartWorkspaceState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(workspaceStorageKey(market));
    const state = normalizeWorkspace(raw ? JSON.parse(raw) : null);
    // The view and a compare set are per session: a reload opens on the chart.
    return { ...state, view: 'chart' };
  } catch {
    return fresh();
  }
}

export function getChartWorkspace(market: WorkspaceMarket): ChartWorkspaceState {
  const store = stores[market];
  if (!store.state) store.state = read(market);
  return store.state;
}

/** Change some fields; persisted (minus the view) and announced. */
export function updateChartWorkspace(market: WorkspaceMarket, patch: Partial<ChartWorkspaceState> | ((s: ChartWorkspaceState) => Partial<ChartWorkspaceState>)): ChartWorkspaceState {
  const store = stores[market];
  const current = getChartWorkspace(market);
  const next = normalizeWorkspace({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
  store.state = next;
  try {
    const { view: _view, ...persisted } = next;
    localStorage.setItem(workspaceStorageKey(market), JSON.stringify(persisted));
  } catch { /* private mode: the choice lasts this visit */ }
  store.listeners.forEach(fn => fn(next));
  return next;
}

export function subscribeChartWorkspace(market: WorkspaceMarket, fn: (s: ChartWorkspaceState) => void): () => void {
  stores[market].listeners.add(fn);
  return () => { stores[market].listeners.delete(fn); };
}

/** For tests: forget the cached copies. */
export function resetChartWorkspaceCache(): void {
  for (const market of ['spot', 'futures', 'cfd'] as const) stores[market].state = null;
}

// ── Presets («Шаблоны») ────────────────────────────────────────────────

export interface WorkspacePreset {
  id: string;
  name: string;
  builtIn?: boolean;
  timeframe: ChartTimeframe;
  quickTimeframes: ChartTimeframe[];
  barType: ChartBarType;
  indicators: IndicatorInstance[];
  /** Chart-settings fields a preset may set; the rest of the paint stays the viewer's. */
  volume?: boolean;
  indicatorLegend?: boolean;
}

export interface WorkspacePresetsFile { version: 1; presets: WorkspacePreset[] }

export const MAX_WORKSPACE_PRESETS = 12;
export const presetsStorageKey = (market: WorkspaceMarket) => `voltex.chartWorkspacePresets.${market}.v1`;

const inst = (type: IndicatorInstance['type'], params: Record<string, number>, colors: string[], id: string): IndicatorInstance => ({ id, type, params, colors, lineWidth: 1, visible: true });

/** The four built-in presets: visual arrangements, not trading advice. */
export const BUILT_IN_PRESETS: readonly WorkspacePreset[] = Object.freeze([
  { id: 'builtin-scalping', name: 'chart.ws.presetScalping', builtIn: true, timeframe: '5m', quickTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h'], barType: 'candles',
    indicators: [inst('ema', { period: 9 }, ['#60a5fa'], 'preset-ema-9'), inst('ema', { period: 21 }, ['#f472b6'], 'preset-ema-21'), inst('vwap', {}, ['#e879f9'], 'preset-vwap'), inst('rsi', { period: 14 }, ['#c084fc'], 'preset-rsi-14')], volume: true, indicatorLegend: true },
  { id: 'builtin-intraday', name: 'chart.ws.presetIntraday', builtIn: true, timeframe: '15m', quickTimeframes: ['5m', '15m', '30m', '1h', '4h', '1d'], barType: 'candles',
    indicators: [inst('ema', { period: 20 }, ['#60a5fa'], 'preset-ema-20'), inst('ema', { period: 50 }, ['#f7d51d'], 'preset-ema-50'), inst('macd', { fast: 12, slow: 26, signal: 9 }, ['#5b8def', '#f7a600'], 'preset-macd')], volume: true, indicatorLegend: true },
  { id: 'builtin-swing', name: 'chart.ws.presetSwing', builtIn: true, timeframe: '4h', quickTimeframes: ['1h', '4h', '12h', '1d', '1w', '1M'], barType: 'candles',
    indicators: [inst('ma', { period: 50 }, ['#60a5fa'], 'preset-sma-50'), inst('ma', { period: 200 }, ['#f7d51d'], 'preset-sma-200'), inst('rsi', { period: 14 }, ['#c084fc'], 'preset-rsi-swing')], volume: true, indicatorLegend: true },
  { id: 'builtin-clean', name: 'chart.ws.presetClean', builtIn: true, timeframe: '1h', quickTimeframes: ['5m', '15m', '1h', '4h', '1d', '1w'], barType: 'candles', indicators: [], volume: false, indicatorLegend: false },
]);

export function normalizePreset(raw: unknown): WorkspacePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : '';
  const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : '';
  if (!name || !id) return null;
  return {
    id, name,
    timeframe: isChartTimeframe(r.timeframe) ? r.timeframe : DEFAULT_CHART_TIMEFRAME,
    quickTimeframes: normalizeQuickTimeframes(r.quickTimeframes),
    barType: isChartBarType(r.barType) ? r.barType : 'candles',
    indicators: normalizeIndicatorInstances(Array.isArray(r.indicators) ? r.indicators : []),
    ...(typeof r.volume === 'boolean' ? { volume: r.volume } : {}),
    ...(typeof r.indicatorLegend === 'boolean' ? { indicatorLegend: r.indicatorLegend } : {}),
  };
}

export function normalizePresetsFile(raw: unknown): WorkspacePresetsFile {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return { version: 1, presets: [] };
  const list = Array.isArray((raw as { presets?: unknown }).presets) ? (raw as { presets: unknown[] }).presets : [];
  const seen = new Set<string>();
  const presets: WorkspacePreset[] = [];
  for (const item of list) {
    const preset = normalizePreset(item);
    if (!preset || seen.has(preset.id) || preset.id.startsWith('builtin-')) continue;
    seen.add(preset.id);
    presets.push(preset);
    if (presets.length >= MAX_WORKSPACE_PRESETS) break;
  }
  return { version: 1, presets };
}

const presetStores: Record<WorkspaceMarket, { file: WorkspacePresetsFile | null; listeners: Set<(p: WorkspacePreset[]) => void> }> = {
  spot: { file: null, listeners: new Set() }, futures: { file: null, listeners: new Set() }, cfd: { file: null, listeners: new Set() },
};

function readPresets(market: WorkspaceMarket): WorkspacePresetsFile {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(presetsStorageKey(market));
    return normalizePresetsFile(raw ? JSON.parse(raw) : null);
  } catch {
    return { version: 1, presets: [] };
  }
}

/** The viewer's own presets (built-ins are a constant beside them). */
export function getWorkspacePresets(market: WorkspaceMarket): WorkspacePreset[] {
  const store = presetStores[market];
  if (!store.file) store.file = readPresets(market);
  return store.file.presets;
}

function writePresets(market: WorkspaceMarket, presets: WorkspacePreset[]): WorkspacePreset[] {
  const store = presetStores[market];
  store.file = normalizePresetsFile({ version: 1, presets });
  try { localStorage.setItem(presetsStorageKey(market), JSON.stringify(store.file)); } catch { /* private mode */ }
  store.listeners.forEach(fn => fn(store.file!.presets));
  return store.file.presets;
}

let presetCounter = 0;
export function newPresetId(): string { return `preset-${Date.now().toString(36)}-${(presetCounter++).toString(36)}`; }

/** Keep the current arrangement under a name; refused (null) at the cap or with an empty name. */
export function saveWorkspacePreset(market: WorkspaceMarket, draft: Omit<WorkspacePreset, 'id' | 'builtIn'>): WorkspacePreset | null {
  const current = getWorkspacePresets(market);
  const name = draft.name.trim().slice(0, 40);
  if (!name || current.length >= MAX_WORKSPACE_PRESETS) return null;
  const preset: WorkspacePreset = { ...draft, name, id: newPresetId() };
  writePresets(market, [...current, preset]);
  return preset;
}

export function renameWorkspacePreset(market: WorkspaceMarket, id: string, name: string): boolean {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return false;
  const current = getWorkspacePresets(market);
  if (!current.some(p => p.id === id)) return false;
  writePresets(market, current.map(p => (p.id === id ? { ...p, name: trimmed } : p)));
  return true;
}

export function deleteWorkspacePreset(market: WorkspaceMarket, id: string): void {
  writePresets(market, getWorkspacePresets(market).filter(p => p.id !== id));
}

export function subscribeWorkspacePresets(market: WorkspaceMarket, fn: (p: WorkspacePreset[]) => void): () => void {
  presetStores[market].listeners.add(fn);
  return () => { presetStores[market].listeners.delete(fn); };
}

export function resetWorkspacePresetsCache(): void {
  for (const market of ['spot', 'futures', 'cfd'] as const) presetStores[market].file = null;
}

/** The workspace fields a preset carries, as a snapshot of the current state. */
export function presetFromWorkspace(state: ChartWorkspaceState, indicators: IndicatorInstance[], paint: { volume: boolean; indicatorLegend: boolean }, name: string): Omit<WorkspacePreset, 'id' | 'builtIn'> {
  return {
    name, timeframe: state.timeframe, quickTimeframes: [...state.quickTimeframes], barType: state.barType,
    indicators: indicators.map(i => ({ ...i, params: { ...i.params }, colors: [...i.colors] })),
    volume: paint.volume, indicatorLegend: paint.indicatorLegend,
  };
}

if (typeof window !== 'undefined') {
  // Another tab saved: follow it.
  window.addEventListener('storage', e => {
    for (const market of ['spot', 'futures', 'cfd'] as const) {
      if (e.key === workspaceStorageKey(market)) {
        const previous = stores[market].state;
        stores[market].state = { ...read(market), view: previous?.view ?? 'chart' };
        stores[market].listeners.forEach(fn => fn(stores[market].state!));
      }
      if (e.key === presetsStorageKey(market)) {
        presetStores[market].file = readPresets(market);
        presetStores[market].listeners.forEach(fn => fn(presetStores[market].file!.presets));
      }
    }
  });
}
