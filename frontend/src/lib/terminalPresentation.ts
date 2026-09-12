import type { LiveState } from './liveMarketTypes';

/** Display only: preserve tiny nonzero quantities; exact values remain in tooltips. */
export function formatBookAmount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0';
  return value.toLocaleString('en-US', { maximumSignificantDigits: 7, notation: value >= 1e9 || value < 1e-7 ? 'scientific' : 'standard' });
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
