/** Presentation only: the owner's hero mix of crypto, CFD and stocks that are
 * coming soon. Order is the order in which each asset takes the centre.
 * This is not a trading allowlist, a quote source or a reason to create
 * market-data subscriptions; the hero shows marks and tickers only.
 */
export type HeroCategory = 'crypto' | 'cfd' | 'stock';
export type HeroBadge = 'CFD' | 'STOCKS SOON';
export type HeroFace = 'gold' | 'silver' | 'graphite';

export interface HeroInstrument {
  instrumentId: string;
  symbol: string;
  label: string;
  displayName: string;
  category: HeroCategory;
  badge: HeroBadge | null;
  face: HeroFace;
  /** Local mark; null renders the label as a typographic mark (index). */
  logoPath: string | null;
  enabled: boolean;
}

export const HERO_INSTRUMENTS: readonly HeroInstrument[] = [
  { instrumentId: 'cg:bitcoin', symbol: 'BTC', label: 'BTC', displayName: 'Bitcoin', category: 'crypto', badge: null, face: 'gold', logoPath: '/hero/instruments/btc-mark.svg', enabled: true },
  { instrumentId: 'stock:AAPL', symbol: 'AAPL', label: 'AAPL', displayName: 'Apple, stocks coming soon', category: 'stock', badge: 'STOCKS SOON', face: 'graphite', logoPath: '/hero/instruments/aapl.svg', enabled: true },
  { instrumentId: 'cfd:WTIUSD', symbol: 'OIL', label: 'OIL', displayName: 'WTI Oil CFD', category: 'cfd', badge: 'CFD', face: 'silver', logoPath: '/hero/instruments/oil.svg', enabled: true },
  { instrumentId: 'cfd:XAUUSD', symbol: 'GOLD', label: 'GOLD', displayName: 'Gold CFD', category: 'cfd', badge: 'CFD', face: 'silver', logoPath: '/hero/instruments/gold.svg', enabled: true },
  { instrumentId: 'cg:ethereum', symbol: 'ETH', label: 'ETH', displayName: 'Ethereum', category: 'crypto', badge: null, face: 'silver', logoPath: '/hero/instruments/eth.svg', enabled: true },
  { instrumentId: 'stock:NVDA', symbol: 'NVDA', label: 'NVDA', displayName: 'NVIDIA, stocks coming soon', category: 'stock', badge: 'STOCKS SOON', face: 'graphite', logoPath: '/hero/instruments/nvda.svg', enabled: true },
  { instrumentId: 'cfd:EURUSD', symbol: 'EURUSD', label: 'EUR/USD', displayName: 'EUR/USD CFD', category: 'cfd', badge: 'CFD', face: 'graphite', logoPath: '/hero/instruments/eurusd.svg', enabled: true },
  { instrumentId: 'cfd:US500', symbol: 'US500', label: 'US500', displayName: 'S&P 500 (US500) CFD', category: 'cfd', badge: 'CFD', face: 'silver', logoPath: null, enabled: true },
  { instrumentId: 'cg:solana', symbol: 'SOL', label: 'SOL', displayName: 'Solana', category: 'crypto', badge: null, face: 'graphite', logoPath: '/hero/instruments/sol.svg', enabled: true },
];
