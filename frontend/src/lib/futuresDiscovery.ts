export interface FuturesUniverseInstrument {
  symbol: string;
  marketType: string;
  quoteAsset: string;
  settleAsset: string;
  status: string;
}

export type FuturesUniverse = {
  available: boolean;
  value?: { instruments: FuturesUniverseInstrument[] };
};

/** Discovery never grants execution permission. Keep held/listed markets too. */
export function discoverFuturesSymbols(executable: string[], universe: FuturesUniverse | null): string[] {
  const discovered = universe?.available ? universe.value?.instruments ?? [] : [];
  return [...new Set([...executable, ...discovered
    .filter(i => i.marketType === 'linear_perpetual' && i.status === 'Trading'
      && i.quoteAsset === 'USDT' && i.settleAsset === 'USDT')
    .map(i => i.symbol)])];
}
