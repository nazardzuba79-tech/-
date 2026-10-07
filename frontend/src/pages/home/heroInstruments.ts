/** Presentation only: an explicit selection of existing external spot markets.
 * Identity and routes were checked against VOLTEX's existing asset catalogue
 * and external ticker endpoint on 2026-10-07. This is not a trading allowlist,
 * a quote cache, or a reason to create additional market-data subscriptions.
 */
export interface HeroInstrument {
  instrumentId: string;
  symbol: string;
  displayName: string;
  category: 'crypto';
  logoPath: string;
  destination: string;
  enabled: boolean;
}

export const HERO_INSTRUMENTS: readonly HeroInstrument[] = [
  { instrumentId: 'cg:bitcoin', symbol: 'BTC', displayName: 'Bitcoin', category: 'crypto', logoPath: '/hero/instruments/btc.svg', destination: '/trade?pair=BTC%2FUSDT', enabled: true },
  { instrumentId: 'cg:ethereum', symbol: 'ETH', displayName: 'Ethereum', category: 'crypto', logoPath: '/hero/instruments/eth.svg', destination: '/trade?pair=ETH%2FUSDT', enabled: true },
  { instrumentId: 'cg:solana', symbol: 'SOL', displayName: 'Solana', category: 'crypto', logoPath: '/hero/instruments/sol.svg', destination: '/trade?pair=SOL%2FUSDT', enabled: true },
  { instrumentId: 'cg:ripple', symbol: 'XRP', displayName: 'XRP', category: 'crypto', logoPath: '/hero/instruments/xrp.svg', destination: '/trade?pair=XRP%2FUSDT', enabled: true },
  { instrumentId: 'cg:cardano', symbol: 'ADA', displayName: 'Cardano', category: 'crypto', logoPath: '/hero/instruments/ada.svg', destination: '/trade?pair=ADA%2FUSDT', enabled: true },
  { instrumentId: 'cg:dogecoin', symbol: 'DOGE', displayName: 'Dogecoin', category: 'crypto', logoPath: '/hero/instruments/doge.svg', destination: '/trade?pair=DOGE%2FUSDT', enabled: true },
  { instrumentId: 'cg:litecoin', symbol: 'LTC', displayName: 'Litecoin', category: 'crypto', logoPath: '/hero/instruments/ltc.svg', destination: '/trade?pair=LTC%2FUSDT', enabled: true },
];
