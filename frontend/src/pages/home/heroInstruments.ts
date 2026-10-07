/** Presentation only: an explicit selection of existing external markets.
 * Identity and routes were checked against VOLTEX's existing asset catalogue
 * and external/CFD ticker endpoints on 2026-10-07. Gold and WTI are display-only
 * references; enabled means visible in this column, never executable. This is not a trading allowlist,
 * a quote cache, or a reason to create additional market-data subscriptions.
 */
export interface HeroInstrument {
  instrumentId: string;
  symbol: string;
  displayName: string;
  category: 'crypto' | 'commodity';
  logoPath: string;
  destination: string;
  enabled: boolean;
}

export const HERO_INSTRUMENTS: readonly HeroInstrument[] = [
  { instrumentId: 'cg:bitcoin', symbol: 'BTC', displayName: 'Bitcoin', category: 'crypto', logoPath: '/hero/instruments/btc.svg', destination: '/trade?pair=BTC%2FUSDT', enabled: true },
  { instrumentId: 'cfd:XAUUSD', symbol: 'GOLD', displayName: 'Gold', category: 'commodity', logoPath: '/hero/instruments/gold.svg', destination: '/trade?market=cfd&symbol=XAUUSD', enabled: true },
  { instrumentId: 'cfd:WTIUSD', symbol: 'OIL', displayName: 'WTI Oil', category: 'commodity', logoPath: '/hero/instruments/oil.svg', destination: '/trade?market=cfd&symbol=WTIUSD', enabled: true },
  { instrumentId: 'cg:ethereum', symbol: 'ETH', displayName: 'Ethereum', category: 'crypto', logoPath: '/hero/instruments/eth.svg', destination: '/trade?pair=ETH%2FUSDT', enabled: true },
  { instrumentId: 'cg:solana', symbol: 'SOL', displayName: 'Solana', category: 'crypto', logoPath: '/hero/instruments/sol.svg', destination: '/trade?pair=SOL%2FUSDT', enabled: true },
  { instrumentId: 'cg:ripple', symbol: 'XRP', displayName: 'XRP', category: 'crypto', logoPath: '/hero/instruments/xrp.svg', destination: '/trade?pair=XRP%2FUSDT', enabled: true },
  { instrumentId: 'cg:cardano', symbol: 'ADA', displayName: 'Cardano', category: 'crypto', logoPath: '/hero/instruments/ada.svg', destination: '/trade?pair=ADA%2FUSDT', enabled: true },
];
