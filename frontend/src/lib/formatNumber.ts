/**
 * Number formatting for market figures (prices, sizes, turnover).
 *
 * Deliberately NOT locale-aware, unlike the rest of the UI's text. Market
 * figures on every major exchange — Bybit's own Russian interface included —
 * are printed in the international convention: "76,714.60", not "76 714,60".
 * Routing these through localeOf(lang) is what left the same BTC price
 * rendered as "76 714,6" in the ticker bar and "76,714.6" in the pair list
 * one panel away, and a turnover as "222,57 млн" where the rest of the
 * terminal reads in Latin digits and symbols.
 *
 * Decimal places are tiered by magnitude and FIXED within a tier (above 1),
 * so a price doesn't shuffle between one and two decimals as it ticks —
 * that flicker is what made the column look ragged next to a real
 * exchange's.
 */

/** A price: "76,714.60", "97.96", "5.7391", "0.0811". */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Below 1 the significant digits are all to the right of the point, so
  // that tier takes a maximum rather than a fixed count — "0.9998" should
  // not print as "0.999800".
  if (abs < 1) return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const digits = abs >= 10 ? 2 : 4;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** An asset amount (base-asset volume, order size): "2,881.61". */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Large turnover, shortened: "222.57M", "41.2B". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}
