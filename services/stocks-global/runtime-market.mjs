import { MarketHub } from './market.mjs';
import { BinanceStreamMarketHub } from './binance-stream-market.mjs';
import { check } from './engine.mjs';
import { LiveMarketHub } from './live-market.mjs';

/**
 * Stocks CLI-only market bootstrap. Neither main crypto streams nor the
 * account/ledger code imports this selector. REST remains the exact default.
 * A shared Binance trade socket can be enabled explicitly only for the
 * two-trader authority-backed service. No connection opens without demand.
 * Operator MUST establish data rights before enabling any real provider.
 */
export function createStocksRuntimeMarket({ enabled = 'false', authorityMode = false, feedOptions, venues = [], binanceHost, liveVenues = [] } = {}) {
  check(enabled === 'true' || enabled === 'false', 'AUTH_CONFIG_INVALID');
  if(liveVenues.length){check(authorityMode===true&&enabled==='false','AUTH_CONFIG_INVALID');return new LiveMarketHub({liveVenues,feedOptions});}
  // Per-venue adapters (venues.mjs) and the Binance public market-data host are
  // passed through unchanged; MarketHub refuses unknown venues and hosts.
  const sources = { venues, ...(binanceHost === undefined ? {} : { binanceHost }) };
  if (enabled === 'false') return new MarketHub(sources);
  check(authorityMode === true, 'AUTH_CONFIG_INVALID');
  return new BinanceStreamMarketHub({ enabled: true, ...sources, ...(feedOptions === undefined ? {} : { feedOptions }) });
}
