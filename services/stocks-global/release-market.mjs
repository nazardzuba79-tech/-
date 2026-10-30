import { CATALOG } from './catalog.mjs';
import { SimError, check } from './engine.mjs';
import { createStocksRuntimeMarket } from './runtime-market.mjs';
import { BINANCE_HOSTS } from './market.mjs';
import { venuesFromEnv } from './venues.mjs';
import { LIVE_PROVIDERS } from './live-catalog.mjs';
import { IndicativeSolanaPrices, indicativeFromEnv, withIndicativePrices } from './demo-indicative.mjs';

// Distinct from catalogue visibility and financial activation. No provider
// requests, fabricated prices or fallback when the operator has not enabled data.
export function createReleaseMarket(env = process.env) {
  // #613 demo/indicative prices (owner decision 30.10), OFF unless STOCKS_DEMO_INDICATIVE_ENABLED=true: the Solana
  // xStock rows and the 15-minute-delayed MOEX rows become viewable, never tradable (demo-indicative.mjs, server.mjs).
  const demo = indicativeFromEnv(env), base = releaseMarket(env);
  if (!demo) return base;
  const prices = new IndicativeSolanaPrices({ dataPath: demo.dataPath });
  prices.start();
  return withIndicativePrices(base, prices);
}
function releaseMarket(env) {
  const enabled=env.STOCKS_MARKET_DATA_ENABLED ?? 'false';
  check(['true','false'].includes(enabled),'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  // Issue #561: additional venues only by explicit per-venue opt-in, each also named in the operator's
  // data-rights attestation (STOCKS_VENUE_RIGHTS_CONFIRMED); otherwise DATA_RIGHTS_UNVERIFIED and no start.
  // STOCKS_BINANCE_HOST may name Binance's documented public market-data host; nothing else.
  const binanceHost=env.STOCKS_BINANCE_HOST||undefined;
  const liveVenues=String(env.STOCKS_LIVE_WS_VENUES??'').split(',').map(v=>v.trim()).filter(Boolean);
  const rights=new Set(String(env.STOCKS_VENUE_RIGHTS_CONFIRMED??'').split(',').map(v=>v.trim()));
  check(liveVenues.every(v=>LIVE_PROVIDERS.includes(v)),'VENUE_UNKNOWN');
  check(liveVenues.every(v=>rights.has(v)),'DATA_RIGHTS_UNVERIFIED');
  if(enabled==='true'){
    check(binanceHost===undefined||BINANCE_HOSTS.includes(binanceHost),'STOCKS_RELEASE_FEED_CONFIG_INVALID');
    return createStocksRuntimeMarket({
      enabled:env.STOCKS_BINANCE_WS_ENABLED ?? 'false',authorityMode:true,venues:venuesFromEnv(env),binanceHost,liveVenues,
    });
  }
  check(!env.STOCKS_BINANCE_WS_ENABLED||env.STOCKS_BINANCE_WS_ENABLED==='false','STOCKS_RELEASE_FEED_CONFIG_INVALID');
  // Data off: a venue or host setting would be a half-configured feed, so it is refused rather than ignored.
  check(!env.STOCKS_VENUES_ENABLED&&binanceHost===undefined,'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  check(!liveVenues.length,'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  return {
    metrics:{dataEnabled:false},
    catalogue:async()=>CATALOG.map(row=>({...row,online:false,exists:null,display:null,sourceError:'SOURCE_UNAVAILABLE'})),
    quote:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    history:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    quoteValid:()=>false,
  };
}
