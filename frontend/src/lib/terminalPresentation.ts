import type { LiveState } from './liveMarketTypes';

/** Display only: preserve tiny nonzero quantities; exact values remain in tooltips. */
export function formatBookAmount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0';
  // Six quantity decimals for normal sizes; retain small nonzero levels.
  if (value >= 1e9 || value < 1e-7) return value.toExponential(4).replace(/\.?0+e/, 'e');
  const decimals = value < 0.001 ? Math.min(10, Math.ceil(-Math.log10(value)) + 3) : value < 1 ? 6 : value < 1000 ? 4 : 2;
  return value.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/** Quote-currency totals use cents for ordinary values; tiny totals stay nonzero. */
export function formatBookTotal(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0';
  if (value < 1 || value >= 1e9) return formatBookAmount(value);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Reference-only fallback, never spot volume, dated contracts or converted units. */
export function livePerpetualTurnover(state: LiveState, pair: string, now = Date.now()): number | null {
  if (state.status !== 'live') return null;
  const [base, quote] = pair.split('/');
  const row = state.rows.get(`linear_perpetual:${base}${quote}`);
  if (!row || row.marketType !== 'linear_perpetual' || row.pair !== pair ||
      row.baseAsset !== base || row.quoteAsset !== quote || row.settleAsset !== quote ||
      row.providerSymbol !== `${base}${quote}` || row.provider !== 'bybit' ||
      (row.turnoverAsset !== undefined && row.turnoverAsset !== quote) || row.stale) return null;
  if (![row.fetchedAt, row.receivedAt].every(time => Number.isFinite(time) && time <= now + 5000 && now - time <= 30000)) return null;
  const value = row.quoteVolume24h;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
