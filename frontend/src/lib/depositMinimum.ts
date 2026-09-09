export interface DepositConfig {
  chains: { chain: string; nativeAsset: string; tokens: string[]; supportedAssets: string[] }[];
  minDepositUsd: number;
  usdPeggedAssets: string[];
}

export function validDepositConfig(value: unknown): value is DepositConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as DepositConfig;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string' && item.length > 0);
  return typeof c.minDepositUsd === 'number' && Number.isFinite(c.minDepositUsd) && c.minDepositUsd > 0
    && strings(c.usdPeggedAssets) && Array.isArray(c.chains) && c.chains.every(chain => chain
      && typeof chain.chain === 'string' && typeof chain.nativeAsset === 'string'
      && strings(chain.tokens) && strings(chain.supportedAssets));
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
