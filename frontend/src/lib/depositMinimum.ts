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
export const DEPOSIT_MINIMUM_USD = 300;
export const DEPOSIT_USD_PEGGED = ['USDT', 'USDC', 'USD', 'DAI'] as const;
export const DEPOSIT_PRICE_MAX_AGE_MS = 2 * 60_000;

export interface DepositMinimumView {
  /** The rule itself, in USD. */
  usd: number;
  /** The same minimum in the asset: exact for a USD-pegged asset, an
   *  estimate from a fresh price otherwise, null when there is no fresh price. */
  equivalent: number | null;
  pegged: boolean;
}

/**
 * What the deposit window says about the minimum for one asset. A price is
 * used only when it is a positive number no older than the backend's own
 * freshness bound for pricing a deposit; without one the window shows the
 * USD rule alone rather than a guessed amount.
 */
export function depositMinimumView(asset: string, quote: { price: unknown; fetchedAt: number } | null, now = Date.now()): DepositMinimumView {
  const config: DepositConfig = { chains: [], minDepositUsd: DEPOSIT_MINIMUM_USD, usdPeggedAssets: [...DEPOSIT_USD_PEGGED] };
  const pegged = config.usdPeggedAssets.includes(asset);
  const fresh = quote !== null && Number.isFinite(quote.fetchedAt) && now - quote.fetchedAt >= 0 && now - quote.fetchedAt <= DEPOSIT_PRICE_MAX_AGE_MS;
  const equivalent = pegged ? DEPOSIT_MINIMUM_USD : fresh ? depositMinimumEquivalent(config, asset, quote!.price) : null;
  return { usd: DEPOSIT_MINIMUM_USD, equivalent, pegged };
}
