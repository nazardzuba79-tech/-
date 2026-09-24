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
