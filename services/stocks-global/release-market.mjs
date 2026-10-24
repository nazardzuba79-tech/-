import { CATALOG } from './catalog.mjs';
import { SimError, check } from './engine.mjs';
import { createStocksRuntimeMarket } from './runtime-market.mjs';
import { BINANCE_HOSTS } from './market.mjs';
import { venuesFromEnv } from './venues.mjs';

// Distinct from catalogue visibility and financial activation. No provider
// requests, fabricated prices or fallback when the operator has not enabled data.
export function createReleaseMarket(env = process.env) {
  const enabled=env.STOCKS_MARKET_DATA_ENABLED ?? 'false';
  check(['true','false'].includes(enabled),'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  // Issue #561: additional venues only by explicit per-venue opt-in, each also named in the operator's
  // data-rights attestation (STOCKS_VENUE_RIGHTS_CONFIRMED); otherwise DATA_RIGHTS_UNVERIFIED and no start.
  // STOCKS_BINANCE_HOST may name Binance's documented public market-data host; nothing else.
  const binanceHost=env.STOCKS_BINANCE_HOST||undefined;
  if(enabled==='true'){
    check(binanceHost===undefined||BINANCE_HOSTS.includes(binanceHost),'STOCKS_RELEASE_FEED_CONFIG_INVALID');
    return createStocksRuntimeMarket({
      enabled:env.STOCKS_BINANCE_WS_ENABLED ?? 'false',authorityMode:true,venues:venuesFromEnv(env),binanceHost,
    });
  }
  check(!env.STOCKS_BINANCE_WS_ENABLED||env.STOCKS_BINANCE_WS_ENABLED==='false','STOCKS_RELEASE_FEED_CONFIG_INVALID');
  // Data off: a venue or host setting would be a half-configured feed, so it is refused rather than ignored.
  check(!env.STOCKS_VENUES_ENABLED&&binanceHost===undefined,'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  return {
    metrics:{dataEnabled:false},
    catalogue:async()=>CATALOG.map(row=>({...row,online:false,exists:null,display:null,sourceError:'SOURCE_UNAVAILABLE'})),
    quote:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    history:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    quoteValid:()=>false,
  };
}
