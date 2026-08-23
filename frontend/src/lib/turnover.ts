/** Derives a real BTC-equivalent 24h turnover figure from the pair's own
 * (real, Kraken-sourced) volume/quoteVolume plus a live BTC/USDT price —
 * never a guess. Only handles the cases we can convert honestly: quote
 * already USDT, quote already BTC, or the pair's base asset IS BTC (in
 * which case its own base volume already is the BTC figure, no
 * conversion needed). Anything else (EUR/ETH-quoted pairs, etc.) returns
 * null rather than inventing a number from an assumed ~1:1 rate. */
export function btcTurnover(params: {
  baseAsset: string;
  quoteAsset: string;
  volume24h: number;
  quoteVolume24h: number;
  btcUsdtPrice: number | null;
}): number | null {
  const { baseAsset, quoteAsset, volume24h, quoteVolume24h, btcUsdtPrice } = params;
  if (baseAsset === 'BTC') return volume24h;
  if (quoteAsset === 'BTC') return quoteVolume24h;
  if (quoteAsset === 'USDT' && btcUsdtPrice) return quoteVolume24h / btcUsdtPrice;
  return null;
}
