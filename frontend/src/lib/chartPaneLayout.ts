/**
 * Heights of the chart's lower panes (volume, lower-pane indicators), as the
 * viewer left them.
 *
 * Owner, 2026-11-12: «коли я зменшую обʼєм, він знову повертається і засмічує
 * графік — зроби, щоб він не повертався». Lightweight Charts lets the viewer
 * drag the separator between two panes; that changes the two panes' stretch
 * factors and tells nobody. The chart used to write its own default factors
 * again on every data or settings update, which threw the viewer's size away.
 *
 * A pane's size is kept as its ratio to the price pane (price = 1). Ratios
 * taken at different moments stay comparable, so a pane that is hidden and
 * shown again returns at the size it had. Kept per browser and per market in
 * localStorage, as the chart's settings and indicators are. Nothing here
 * reaches the server.
 */
export type PaneLayoutMarket = 'spot' | 'futures' | 'cfd';
/** `volume`, or `ind:<indicator instance id>`. The price pane is always 1. */
export type PaneRatios = Readonly<Record<string, number>>;

export const CHART_PANE_LAYOUT_KEY = 'voltex.chartPaneLayout.v1';
export const PRICE_PANE = 'price';
export const VOLUME_PANE = 'volume';
export const indicatorPane = (id: string): string => `ind:${id}`;

/** The chart's own sizes: volume a fifth of the two, an indicator strip a little more. */
export const DEFAULT_VOLUME_RATIO = 0.25;
export const DEFAULT_INDICATOR_RATIO = 0.3;
export const DEFAULT_CROWDED_INDICATOR_RATIO = 0.225;
const MIN_RATIO = 0.02, MAX_RATIO = 4, MAX_STORED_PANES = 24;
/** Stretch factors are floats the library recomputes; a real drag moves them far more than this. */
const SAME = 1e-4;

const validRatio = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const clampRatio = (value: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
const knownRole = (role: string): boolean => role === VOLUME_PANE || (role.startsWith('ind:') && role.length > 4 && role.length <= 84);

export function normalizePaneRatios(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [role, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!knownRole(role) || !validRatio(value)) continue;
    out[role] = clampRatio(value);
    if (Object.keys(out).length >= MAX_STORED_PANES) break;
  }
  return out;
}

/** The stretch factor of every pane, in pane order: the viewer's where one is kept, the chart's own otherwise. */
export function paneFactors(roles: readonly string[], ratios: PaneRatios): number[] {
  const lower = roles.filter(role => role !== PRICE_PANE && role !== VOLUME_PANE).length;
  const indicator = lower >= 3 ? DEFAULT_CROWDED_INDICATOR_RATIO : DEFAULT_INDICATOR_RATIO;
  return roles.map(role => (role === PRICE_PANE ? 1 : ratios[role] ?? (role === VOLUME_PANE ? DEFAULT_VOLUME_RATIO : indicator)));
}

export interface AppliedPanes { roles: readonly string[]; factors: readonly number[] }

/**
 * The viewer's sizes after a separator drag, or null when nothing was dragged.
 *
 * `applied` is what the chart last wrote; `roles`/`factors` is what the chart
 * holds now. The same panes with other factors can only be the viewer's drag:
 * the library changes factors on its own only when panes are added or removed,
 * and then the roles differ too. Panes that are not on the chart now keep
 * the ratio they had.
 */
export function adoptedPaneRatios(applied: AppliedPanes | null, roles: readonly string[], factors: readonly number[], ratios: PaneRatios): Record<string, number> | null {
  if (!applied || roles.length < 2 || roles.length !== factors.length || roles[0] !== PRICE_PANE) return null;
  if (applied.roles.length !== roles.length || applied.roles.some((role, i) => role !== roles[i])) return null;
  if (!factors.every(validRatio)) return null;
  // Compare shapes, not raw numbers: the library may rescale all factors together.
  const scaleNow = factors[0], scaleThen = applied.factors[0];
  if (!validRatio(scaleThen)) return null;
  const moved = factors.some((factor, i) => Math.abs(factor / scaleNow - applied.factors[i] / scaleThen) > SAME);
  if (!moved) return null;
  const next: Record<string, number> = { ...ratios };
  roles.forEach((role, i) => { if (i > 0 && knownRole(role)) next[role] = clampRatio(factors[i] / scaleNow); });
  return next;
}

/** Drop sizes of indicators that no longer exist, so the store cannot grow without end. */
export function prunePaneRatios(ratios: PaneRatios, indicatorIds: readonly string[]): Record<string, number> {
  const keep = new Set<string>([VOLUME_PANE, ...indicatorIds.map(indicatorPane)]);
  return Object.fromEntries(Object.entries(ratios).filter(([role]) => keep.has(role)));
}

// ── Per-market browser store ─────────────────────────────────────────────
const MARKETS: readonly PaneLayoutMarket[] = ['spot', 'futures', 'cfd'];
let cache: Record<PaneLayoutMarket, Record<string, number>> | null = null;

function readAll(): Record<PaneLayoutMarket, Record<string, number>> {
  const empty = { spot: {}, futures: {}, cfd: {} } as Record<PaneLayoutMarket, Record<string, number>>;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CHART_PANE_LAYOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    for (const market of MARKETS) empty[market] = normalizePaneRatios((parsed as Record<string, unknown>)[market]);
    return empty;
  } catch {
    return empty;
  }
}

export function getChartPaneLayout(market: PaneLayoutMarket): PaneRatios {
  if (!cache) cache = readAll();
  return cache[market];
}

export function saveChartPaneLayout(market: PaneLayoutMarket, ratios: PaneRatios): void {
  if (!cache) cache = readAll();
  cache = { ...cache, [market]: normalizePaneRatios(ratios) };
  try { localStorage.setItem(CHART_PANE_LAYOUT_KEY, JSON.stringify(cache)); } catch { /* private mode: the size lasts this visit */ }
}

/** Back to the chart's own sizes (the workspace's «Сбросить»). */
export function resetChartPaneLayout(market: PaneLayoutMarket): void { saveChartPaneLayout(market, {}); }

/** For tests only. */
export function resetChartPaneLayoutCache(): void { cache = null; }
