/** Canonical cash-flow-neutral returns, converted to percent only. On v7 the
 * public startEquity is a TWR index, NOT the private strategy capital: never
 * divide money PnL by that index. dailyReturn already comes from the ledger's
 * net trading PnL / full day-start capital, excluding external cash flows.
 * Geometry is linear about zero; no smoothing, clipping or redistribution.
 */
export function dailyReturnChart(days: readonly { date: string; dailyReturn: number; realizedPnl?: number }[]) {
  // Fit the complete period into the panel, not a nine-pixel/day strip that
  // exposes only ~90 of 380 days on desktop. This changes x spacing only:
  // one bar/day, original return, linear zero-based y scale, no aggregation.
  const width = Math.max(640, Math.min(900, days.length * 2));
  const top = 18;
  const bottom = 202;
  const values = days.map(day => day.dailyReturn * 100);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const y = (value: number) => bottom - (value - min) / range * (bottom - top);
  const zero = y(0);
  const step = width / Math.max(1, days.length);
  return {
    width, zero,
    roi: (days.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100,
    // Arithmetic mean across ALL visible calendar days, including leave/zeros.
    // This is not period ROI divided by the number of days.
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    bars: days.map((day, index) => ({
      ...day, returnPct: values[index], x: index * step + step * .2, width: step * .6,
      y: Math.min(zero, y(values[index])), height: Math.abs(y(values[index]) - zero),
    })),
    // Explicit zero tick even when it lies between the regular grid levels.
    ticks: [...new Set([max, (max + min) / 2, 0, min])].sort((a, b) => b - a)
      .map(value => ({ value, y: y(value) })),
  };
}
