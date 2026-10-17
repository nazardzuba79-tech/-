import type { Period } from '../pages/copy-trading-bolt/traders';

// A dated owner-defined scenario, separate from the live rolling 7D metric.
// UTC is intentional: the deadline does not follow the browser's time zone.
export const DEMO_ROI_START = Date.parse('2026-10-12T00:00:00Z');
export const DEMO_ROI_END = Date.parse('2026-10-22T00:00:00Z');
export const DEMO_ROI_PERIOD = '12–18.10.2026';

export type DemoRoi = Readonly<{ roi: number; period: string }>;

/** Display only. Never project this value into a Trader, API/cache payload,
 * equity curve, financial metric or order. Explicit provenance is required;
 * an ID, name or simulation clock alone is not permission to replace ROI. */
export function demoRoiFor(
  traderId: string, period: Period, response: unknown, now: number,
): DemoRoi | undefined {
  if (period !== '7D' || !Number.isFinite(now) || now < DEMO_ROI_START || now >= DEMO_ROI_END
    || !response || typeof response !== 'object') return undefined;
  const source = response as { trader?: { id?: unknown }; provenance?: unknown };
  const expected = traderId === 'VX-001' ? 'MODELED'
    : traderId === 'VX-KSENIA' ? 'SYNTHETIC_REVIEW' : undefined;
  if (!expected || source.trader?.id !== traderId || source.provenance !== expected) return undefined;
  return {
    roi: traderId === 'VX-001' ? 179 : 132,
    period: DEMO_ROI_PERIOD,
  };
}
