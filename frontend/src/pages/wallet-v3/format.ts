import { Lang, localeOf } from '../../lib/i18n';

/**
 * Number formatting for the Wallet workspace.
 *
 * Locale-aware rather than the reference prototype's hardcoded comma
 * grouping: this app ships seven languages, and Russian groups thousands
 * with a space (32 726 245), not a comma.
 *
 * Everything here is written for the sizes this page actually sees — a
 * portfolio can be $12.40 or $68,000,000.00, and neither may fall back to
 * scientific notation or lose its cents.
 */

export const EM_DASH = '—';
export const MASK = '••••••';

export function formatUsd(value: number | null | undefined, lang: Lang, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const sign = value < 0 ? '-' : '';
  const body = Math.abs(value).toLocaleString(localeOf(lang), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  });
  return `${sign}$${body}`;
}

/**
 * Whole dollars, for the places where cents are noise — the allocation ring's
 * centre and its legend. Still grouped in full, never abbreviated: "$68M"
 * loses the digits an operator is actually checking.
 */
export function formatUsdCompact(value: number | null | undefined, lang: Lang): string {
  return formatUsd(value, lang, 0);
}

/**
 * An asset quantity. `decimals` is the asset's own precision, but trailing
 * zeros are trimmed so 1,200,000 XRP does not render as 1,200,000.00000000
 * and 0.00412 BTC keeps every significant digit.
 */
export function formatAmount(value: number | null | undefined, lang: Lang, decimals = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value.toLocaleString(localeOf(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
}

export function formatPercent(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const body = Math.abs(value).toLocaleString(localeOf(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${sign}${body}%`;
}

/** Signed dollars, for a PnL figure that must always show its direction. */
export function formatSignedUsd(value: number | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value), lang)}`;
}

export function toneOf(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-ink-4';
  if (value > 0) return 'text-pos';
  if (value < 0) return 'text-neg';
  return 'text-ink-4';
}

/**
 * How many decimals an asset is worth showing. Large-supply assets read
 * better whole; BTC and ETH need real precision.
 */
export function decimalsFor(asset: string): number {
  if (asset === 'BTC') return 8;
  if (asset === 'ETH') return 6;
  if (['USDT', 'USDC', 'USD', 'EUR', 'DAI', 'TUSD'].includes(asset)) return 2;
  return 4;
}

/**
 * Decimals for the portfolio's BTC equivalent. Eight is right for a dust
 * balance and pure noise on a four-figure one, so the precision follows the
 * size of the number rather than the asset.
 */
export function btcEquivalentDecimals(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 8;
}
