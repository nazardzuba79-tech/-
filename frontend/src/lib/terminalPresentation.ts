import type { LiveQuote, LiveState } from './liveMarketTypes';

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

/** Eight-character display for narrow book columns; callers retain the exact value in title. */
export function formatCompactBookValue(value: number, kind: 'amount' | 'total' = 'amount'): string {
  const full = kind === 'total' ? formatBookTotal(value) : formatBookAmount(value);
  if (full.length <= 8) return full;
  for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= scale && value < scale * 1000) {
      const text = `${(value / scale).toFixed(2)}${suffix}`;
      if (text.length <= 8) return text;
    }
  }
  // Scientific notation keeps tiny nonzero levels readable without implying zero.
  for (let precision = 3; precision >= 0; precision--) {
    const text = value.toExponential(precision).replace(/\.?0+e/, 'e').replace('e+', 'e');
    if (text.length <= 8) return text;
  }
  return full;
}

/** How old the header's own reference row may be and still name the 24h
 * turnover: twice its five-minute REST refresh (the socket keeps it far
 * fresher on the production site). */
export const REFERENCE_TURNOVER_MAX_AGE_MS = 600_000;

/**
 * The same Bybit linear-perpetual turnover, read from the Futures header's
 * OWN reference row — the row its 24h high and low already come from
 * (`useFuturesReference`). No request is added: the row is in memory.
 *
 * Needed because the server's cross-venue turnover is Binance's alone (OKX
 * publishes none) and Binance Futures refuses the backend's US region, so
 * on production that aggregate is never available and the cell sat on «—».
 * Same rules as `livePerpetualTurnover`: this pair's USDT-settled perpetual
 * from Bybit, in the quote currency, fresh, never spot, never converted.
 */
export function referencePerpetualTurnover(row: LiveQuote | null | undefined, pair: string, now = Date.now()): number | null {
  if (!row) return null;
  const [base, quote] = pair.split('/');
  if (row.marketType !== 'linear_perpetual' || row.pair !== pair ||
      row.baseAsset !== base || row.quoteAsset !== quote || row.settleAsset !== quote ||
      row.providerSymbol !== `${base}${quote}` || row.provider !== 'bybit' ||
      (row.turnoverAsset !== undefined && row.turnoverAsset !== quote) || row.stale) return null;
  const received = row.receivedAt;
  if (!Number.isFinite(received) || received > now + 5000 || now - received > REFERENCE_TURNOVER_MAX_AGE_MS) return null;
  const value = row.quoteVolume24h;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
  if (![row.fetchedAt, row.receivedAt].every(time => Number.isFinite(time) && time <= now + 5000 && now - time <= (state.sampled ? 90_000 : 30_000))) return null;
  const value = row.quoteVolume24h;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
