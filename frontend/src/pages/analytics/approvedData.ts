import type { AnalyticsSnapshot, GatewaySection, LiquidationWindow } from '../../lib/api';

export function valueOf<T>(section: GatewaySection<T> | undefined): T | null {
  return section?.available ? section.value : null;
}
export function contractFor(snapshot: AnalyticsSnapshot | null, asset: string | null) {
  return valueOf(snapshot?.sections.derivatives)?.contracts.find(c => c.symbol.split('/')[0] === asset) ?? null;
}
export function finite(value: number | string | null | undefined): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
/** Never infer full coverage from elapsed UI time or a zero event count. */
export function coverage(window: LiquidationWindow): number {
  if (window.coverageStartAt == null || window.to <= window.from) return 0;
  return Math.max(0, Math.min(100, (window.to - Math.max(window.from, window.coverageStartAt)) / (window.to - window.from) * 100));
}
export function dateTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
/** SVG coordinates from actual observations only; a flat series stays flat. */
export function lineCoordinates(values: number[], width = 720, height = 190) {
  const min = Math.min(...values), max = Math.max(...values);
  return values.map((value, i) => [
    8 + i / Math.max(1, values.length - 1) * (width - 16),
    max === min ? height / 2 : 8 + (max - value) / (max - min) * (height - 16),
  ] as const);
}
