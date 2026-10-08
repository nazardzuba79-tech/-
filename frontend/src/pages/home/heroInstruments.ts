/** Presentation only: the owner's hero mix of crypto, CFD and stocks that are
 * coming soon. Order is the order in which each asset takes the centre.
 * This is not a trading allowlist, a quote source or a reason to create
 * market-data subscriptions; the hero shows rendered medallions only.
 * US500 is not in the CFD catalogue yet, so it is not in the scene.
 */
export type HeroCategory = 'crypto' | 'cfd' | 'stock';
export type HeroBadge = 'CFD' | 'STOCKS SOON';
export type HeroFace = 'graphite' | 'white';

export interface HeroInstrument {
  instrumentId: string;
  symbol: string;
  label: string;
  displayName: string;
  category: HeroCategory;
  badge: HeroBadge | null;
  face: HeroFace;
  /** Pre-rendered medallion (transparent WebP) built by scripts/hero-medallions. */
  asset: string;
  /** Small per-asset size variation so the ring never reads as identical discs. */
  size: number;
  enabled: boolean;
}

/** The platform medallions rise from (transparent WebP, same renderer). */
export const HERO_PLATFORM_ASSET = '/hero/medallions/platform.webp';

export const HERO_INSTRUMENTS: readonly HeroInstrument[] = [
  { instrumentId: 'cg:bitcoin', symbol: 'BTC', label: 'BTC', displayName: 'Bitcoin', category: 'crypto', badge: null, face: 'graphite', asset: '/hero/medallions/btc.webp', size: 1, enabled: true },
  { instrumentId: 'stock:AAPL', symbol: 'AAPL', label: 'AAPL', displayName: 'Apple, stocks coming soon', category: 'stock', badge: 'STOCKS SOON', face: 'white', asset: '/hero/medallions/aapl.webp', size: 1.04, enabled: true },
  { instrumentId: 'cfd:WTIUSD', symbol: 'OIL', label: 'OIL', displayName: 'WTI Oil CFD', category: 'cfd', badge: 'CFD', face: 'white', asset: '/hero/medallions/oil.webp', size: .97, enabled: true },
  { instrumentId: 'cfd:XAUUSD', symbol: 'GOLD', label: 'GOLD', displayName: 'Gold CFD', category: 'cfd', badge: 'CFD', face: 'white', asset: '/hero/medallions/gold.webp', size: 1.02, enabled: true },
  { instrumentId: 'cg:ethereum', symbol: 'ETH', label: 'ETH', displayName: 'Ethereum', category: 'crypto', badge: null, face: 'white', asset: '/hero/medallions/eth.webp', size: 1.06, enabled: true },
  { instrumentId: 'stock:NVDA', symbol: 'NVDA', label: 'NVDA', displayName: 'NVIDIA, stocks coming soon', category: 'stock', badge: 'STOCKS SOON', face: 'graphite', asset: '/hero/medallions/nvda.webp', size: .95, enabled: true },
  { instrumentId: 'cfd:EURUSD', symbol: 'EURUSD', label: 'EUR/USD', displayName: 'EUR/USD CFD', category: 'cfd', badge: 'CFD', face: 'white', asset: '/hero/medallions/eurusd.webp', size: 1, enabled: true },
  { instrumentId: 'cg:solana', symbol: 'SOL', label: 'SOL', displayName: 'Solana', category: 'crypto', badge: null, face: 'graphite', asset: '/hero/medallions/sol.webp', size: .98, enabled: true },
];
