/**
 * The contract facts shown under the order ticket on the archive design:
 * what the header already carries for the selected contract (index and
 * mark price, open interest, 24h turnover), VOLTEX's own funding rates
 * from /futures/config, plus the contract's
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
  /** VOLTEX's funding per settlement by side, from /futures/config — never a provider's live rate. */
  funding: VoltexFundingRates | null;
  settleAsset: string | null;
  maxLeverage: string | null;
  minOrderQty: ContractFigure | null;
  qtyStep: ContractFigure | null;
  maxOrderQty: ContractFigure | null;
}

/** The config fields this block reads; the store's config satisfies it. */
export interface ContractConfigFacts {
  fundingIntervalHours: number;
  maxLeverage: number;
  fundingCashflow?: { long: string; short: string };
}

export interface FundingSideRate { value: string; negative: boolean }
export interface VoltexFundingRates { long: FundingSideRate; short: FundingSideRate }

/** A signed fraction as a signed percent: '-0.0001' → '−0.01%', '0.0004' → '+0.04%'. Two to four decimals. */
export function fundingPercent(fraction: string): FundingSideRate | null {
  if (!/^-?\d+(\.\d+)?$/.test(fraction)) return null;
  const pct = Number(fraction) * 100;
  if (!Number.isFinite(pct)) return null;
  const digits = pct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).replace('-', '');
  const zero = Number(digits) === 0;
  return { value: `${zero ? '' : pct < 0 ? '\u2212' : '+'}${digits}%`, negative: !zero && pct < 0 };
}

/** VOLTEX's funding rates by side, as the terminal states them. `null` until the config says. */
export function voltexFundingRates(config: Pick<ContractConfigFacts, 'fundingCashflow'> | null | undefined): VoltexFundingRates | null {
  const long = config?.fundingCashflow ? fundingPercent(config.fundingCashflow.long) : null;
  const short = config?.fundingCashflow ? fundingPercent(config.fundingCashflow.short) : null;
  return long && short ? { long, short } : null;
}

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
    funding: voltexFundingRates(config),
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
