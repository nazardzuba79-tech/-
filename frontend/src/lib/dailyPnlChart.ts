/** Linear, zero-based geometry. Never smooth, clip or redistribute ledger PnL. */
export function dailyPnlChart(days: readonly { date: string; realizedPnl: number }[]) {
  const width = Math.max(640, days.length * 9);
  const top = 18;
  const bottom = 202;
  const values = days.map(day => day.realizedPnl);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const y = (value: number) => bottom - (value - min) / range * (bottom - top);
  const zero = y(0);
  const step = width / Math.max(1, days.length);
  return {
    width, zero,
    total: values.reduce((sum, value) => sum + value, 0),
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    bars: days.map((day, index) => ({
      ...day, x: index * step + step * .2, width: step * .6,
      y: Math.min(zero, y(day.realizedPnl)), height: Math.abs(y(day.realizedPnl) - zero),
    })),
    ticks: [max, (max + min) / 2, min].map(value => ({ value, y: y(value) })),
  };
}
