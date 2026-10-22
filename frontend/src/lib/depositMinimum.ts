export interface DepositConfig {
  chains: { chain: string; nativeAsset: string; tokens: string[]; supportedAssets: string[]; address?: string }[];
  minDepositUsd: number;
  usdPeggedAssets: string[];
  /** The server's fingerprint of this exact list (newer APIs only). */
  version?: string;
}

export function validDepositConfig(value: unknown): value is DepositConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as DepositConfig;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string' && item.length > 0);
  return typeof c.minDepositUsd === 'number' && Number.isFinite(c.minDepositUsd) && c.minDepositUsd > 0
    && strings(c.usdPeggedAssets) && Array.isArray(c.chains) && c.chains.every(chain => chain
      && typeof chain.chain === 'string' && typeof chain.nativeAsset === 'string'
      && strings(chain.tokens) && strings(chain.supportedAssets)
      // The treasury address rides along so a client showing every wallet at
      // once needs ONE request instead of one per chain. It stays OPTIONAL on
      // purpose: the frontend and the API deploy separately, and a frontend
      // that hard-required it would break deposits outright in the window
      // where it is live against an API that has not shipped it yet — callers
      // fall back to /deposit-address/:chain. What is NOT tolerated is a
      // present but empty or non-string address: that would print a blank
      // address into a funds-receiving field, so the config is rejected.
      && (chain.address === undefined || (typeof chain.address === 'string' && chain.address.length > 0)));
}

/** The backend supplies both the threshold and USD peg policy. The ticker is
 * a display estimate only; DepositService re-prices at actual credit time. */
export function depositMinimumEquivalent(config: DepositConfig, asset: string, lastPrice?: unknown): number | null {
  if (config.usdPeggedAssets.includes(asset)) return config.minDepositUsd;
  if (typeof lastPrice !== 'string' && typeof lastPrice !== 'number') return null;
  const price = Number(lastPrice);
  const equivalent = config.minDepositUsd / price;
  return Number.isFinite(price) && price > 0 && Number.isFinite(equivalent) && equivalent > 0 ? equivalent : null;
}

/**
 * The production deposit rule, as the backend enforces it
 * (`src/config/limits.ts`: MIN_DEPOSIT_USD, DEPOSIT_USD_PEGGED_ASSETS,
 * DEPOSIT_PRICE_MAX_AGE_MS). The manual catalogue — read straight from
 * Cloudflare — carries addresses only, so the deposit window states the rule
 * from here; `depositMinimumRule.test.ts` fails the moment the two differ.
 * Nothing here decides a credit: the server re-prices at credit time.
 */
export const DEPOSIT_MINIMUM_USD = 500;
export const DEPOSIT_USD_PEGGED = ['USDT', 'USDC', 'USD', 'DAI'] as const;
export const DEPOSIT_PRICE_MAX_AGE_MS = 2 * 60_000;

/** A price the page already holds (the shared market snapshot). */
export interface HeldQuote { price: unknown; fetchedAt: number; stale: boolean }

export interface DepositMinimumView {
  /** The rule itself, in USD. */
  usd: number;
  /** The server's fixed one-to-one minimum for a USD-pegged asset; null otherwise. */
  equivalent: number | null;
  pegged: boolean;
  /** The minimum in a non-pegged asset from a live price, or null. */
  estimate: number | null;
  /** The moment `estimate` stops being current (ms since epoch), or null. */
  estimateExpiresAt: number | null;
}

/**
 * What the deposit window says about the minimum for one asset.
 *
 * Minimum: 500 USD or its cryptocurrency equivalent. The estimate is shown
 * only from a price that is live — not
 * a warm-cache or stale-served snapshot — and no older than the server's own
 * bound for pricing a deposit; `estimateExpiresAt` lets the window take it
 * down the moment it ages out, even if nothing else re-renders (the two gaps
 * the review of #339 found). Without such a price: the rule alone.
 */
export function depositMinimumView(asset: string, quote: HeldQuote | null = null, now = Date.now()): DepositMinimumView {
  const pegged = DEPOSIT_USD_PEGGED.some(symbol => symbol === asset);
  let estimate: number | null = null;
  let estimateExpiresAt: number | null = null;
  if (!pegged && quote && quote.stale === false && Number.isFinite(quote.fetchedAt)) {
    const age = now - quote.fetchedAt;
    if (age >= 0 && age < DEPOSIT_PRICE_MAX_AGE_MS) {
      const config: DepositConfig = { chains: [], minDepositUsd: DEPOSIT_MINIMUM_USD, usdPeggedAssets: [...DEPOSIT_USD_PEGGED] };
      estimate = depositMinimumEquivalent(config, asset, quote.price);
      if (estimate !== null) estimateExpiresAt = quote.fetchedAt + DEPOSIT_PRICE_MAX_AGE_MS;
    }
  }
  return { usd: DEPOSIT_MINIMUM_USD, equivalent: pegged ? DEPOSIT_MINIMUM_USD : null, pegged, estimate, estimateExpiresAt };
}
