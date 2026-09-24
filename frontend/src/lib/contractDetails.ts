/**
 * The contract facts shown under the order ticket on the archive design:
 * what the header already carries for the selected contract (index and
 * mark price, open interest, 24h turnover, funding), plus the contract's
 * own order limits when the engine publishes them. Pure: the component
 * only labels and paints what this returns, so every rule about units and
 * unknowns lives here and is tested here.
 *
 * `null` is "not known" and is never coerced to a zero or an empty string;
 * the component prints a dash for it.
 */
import type { LiveQuote } from './liveMarketTypes';
import type { FuturesContractRules } from './futuresMath';
import { formatPrice, formatAmount, formatCompact } from './formatNumber';

export interface ContractFigure { value: string; unit: string }

export interface ContractFacts {
  /** `true` for a perpetual, `false` for a dated contract, `null` without a quote. */
  perpetual: boolean | null;
  indexPrice: string | null;
  markPrice: string | null;
  /** Base units when a venue reported them, else the notional in the quote asset — the same rule the header applies. */
  openInterest: ContractFigure | null;
  turnover24h: ContractFigure | null;
  fundingRate: { value: string; negative: boolean } | null;
  settleAsset: string | null;
  maxLeverage: string | null;
  minOrderQty: ContractFigure | null;
  qtyStep: ContractFigure | null;
  maxOrderQty: ContractFigure | null;
}

/** The two config fields this block reads; the store's config satisfies it. */
export interface ContractConfigFacts { fundingIntervalHours: number; maxLeverage: number }

const PERPETUAL: ReadonlySet<LiveQuote['marketType']> = new Set(['linear_perpetual', 'inverse_perpetual']);

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A contract limit as the engine states it ("0.001", "1000000"), grouped, no padding. */
function formatQuantity(raw: string): string | null {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return null;
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function figure(raw: string | null | undefined, unit: string | null): ContractFigure | null {
  if (raw === null || raw === undefined || unit === null) return null;
  const value = formatQuantity(raw);
  return value === null ? null : { value, unit };
}

export function contractFacts(
  quote: LiveQuote | null,
  config: ContractConfigFacts | null,
  rules: FuturesContractRules | null,
): ContractFacts {
  const base = quote?.baseAsset ?? null;
  const quoteAsset = quote?.quoteAsset ?? null;
  const index = num(quote?.indexPrice);
  const mark = num(quote?.markPrice);
  const oiBase = num(quote?.openInterest);
  const oiValue = num(quote?.openInterestValue);
  const turnover = num(quote?.quoteVolume24h);
  const funding = num(quote?.fundingRate);
  return {
    perpetual: quote ? PERPETUAL.has(quote.marketType) : null,
    indexPrice: index !== null ? formatPrice(index) : null,
    markPrice: mark !== null ? formatPrice(mark) : null,
    openInterest:
      oiBase !== null && base !== null
        ? { value: oiBase.toLocaleString('en-US', { maximumSignificantDigits: 12 }), unit: base }
        : oiValue !== null && quoteAsset !== null
          ? { value: formatCompact(oiValue), unit: quoteAsset }
          : null,
    turnover24h: turnover !== null && quoteAsset !== null ? { value: formatAmount(turnover), unit: quoteAsset } : null,
    fundingRate: funding !== null ? { value: `${(funding * 100).toFixed(4)}%`, negative: funding < 0 } : null,
    settleAsset: quote ? quote.settleAsset ?? quote.quoteAsset : null,
    maxLeverage: config && Number.isFinite(config.maxLeverage) && config.maxLeverage > 0 ? `${config.maxLeverage}x` : null,
    minOrderQty: figure(rules?.minOrderQty, base),
    qtyStep: figure(rules?.qtyStep, base),
    maxOrderQty: figure(rules?.maxOrderQty, base),
  };
}

/**
 * Time to the next funding settlement as "HH:MM:SS". Funding settles at
 * every UTC multiple of the interval, so the boundary is a pure function
 * of the clock — the same rule the ticker bar's countdown and the
 * backend's msUntilNextFundingBoundary apply. `null` when the interval is
 * unknown or not positive.
 */
export function fundingCountdown(intervalHours: number | null, now: number): string | null {
  if (intervalHours === null || !Number.isFinite(intervalHours) || intervalHours <= 0) return null;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const total = Math.floor((intervalMs - (now % intervalMs)) / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
