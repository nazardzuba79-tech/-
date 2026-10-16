// Exact provider/token identity for the isolated terminal's initial selection.
export const DEFAULT_STOCKS_INSTRUMENT = 'BYBIT:AAPLXUSDT';

/** Canonical data identity; token variants from different providers stay distinct. */
export function isExactStocksProviderIdentity(asset: { id: string; provider: string; sourceSymbol: string }): boolean {
  return ['bybit', 'binance', 'moex'].includes(asset.provider) &&
    asset.id === (asset.provider === 'moex' ? 'MOEX:TQBR:' : asset.provider.toUpperCase() + ':') + asset.sourceSymbol;
}
