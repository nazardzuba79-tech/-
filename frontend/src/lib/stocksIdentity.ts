// Exact provider/token identity for the isolated terminal's initial selection.
export const DEFAULT_STOCKS_INSTRUMENT = 'BYBIT:AAPLXUSDT';

/** Canonical data identity; token variants from different providers stay distinct. */
export function isExactStocksProviderIdentity(asset: { id: string; provider: string; sourceSymbol: string }): boolean {
  const additional: Record<string, RegExp> = {
    gate: /^[A-Z0-9]{1,24}_USDT$/, mexc: /^[A-Z0-9]{1,24}USDT$/,
    okx: /^X[A-Z0-9]{1,24}-USDT$/, kucoin: /^[A-Z0-9]{1,24}X-USDT$/,
    kraken: /^[A-Z0-9]{1,24}xUSD$/, bingx: /^[A-Z0-9]{1,24}X-USDT$/,
    bitget: /^R[A-Z0-9]{1,24}USDT$/,
  };
  // #613 demo/indicative xStocks priced from their Solana pools: XSTOCK:<token>, the token symbol as listed (e.g. SPYx).
  if (asset.provider === 'solana') return /^[A-Z][A-Z.]{0,11}x$/.test(asset.sourceSymbol) && asset.id === 'XSTOCK:' + asset.sourceSymbol;
  return (['bybit', 'binance', 'moex'].includes(asset.provider) ||
      Object.prototype.hasOwnProperty.call(additional, asset.provider) && additional[asset.provider].test(asset.sourceSymbol)) &&
    asset.id === (asset.provider === 'moex' ? 'MOEX:TQBR:' : asset.provider.toUpperCase() + ':') + asset.sourceSymbol;
}
