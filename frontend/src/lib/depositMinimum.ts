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
 * (`src/config/limits.ts`: MIN_DEPOSIT_USD, DEPOSIT_USD_PEGGED_ASSETS).
 * The manual catalogue — read straight from
 * Cloudflare — carries addresses only, so the deposit window states the rule
 * from here; `depositMinimumRule.test.ts` fails the moment the two differ.
 * Nothing here decides a credit: the server re-prices at credit time.
 */
export const DEPOSIT_MINIMUM_USD = 300;
export const DEPOSIT_USD_PEGGED = ['USDT', 'USDC', 'USD', 'DAI'] as const;

export interface DepositMinimumView {
  /** The rule itself, in USD. */
  usd: number;
  /** The server's fixed one-to-one minimum for a USD-pegged asset;
   *  null for every asset that would need a market-price estimate. */
  equivalent: number | null;
  pegged: boolean;
}

/**
 * The deposit window states the USD rule and the server's fixed peg policy.
 * Other assets stay USD-only: an open address window has no live quote
 * subscription, so a cached conversion could become stale while it is open.
 * This view needs no market read, request, subscription or expiry timer.
 */
export function depositMinimumView(asset: string): DepositMinimumView {
  const pegged = DEPOSIT_USD_PEGGED.some(symbol => symbol === asset);
  return { usd: DEPOSIT_MINIMUM_USD, equivalent: pegged ? DEPOSIT_MINIMUM_USD : null, pegged };
}
