/** Public presentation only: ledger amounts stay full precision. Price and
 * quantity formatters are intentionally separate from these monetary KPIs. */
export function publicUsdtNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2 });
}

export function publicSignedUsdt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '−'}${publicUsdtNumber(Math.abs(value))} USDT`;
}
