import { CATALOG } from './catalog.mjs';
import { SimError, check } from './engine.mjs';
import { createStocksRuntimeMarket } from './runtime-market.mjs';

// Distinct from catalogue visibility and financial activation. No provider
// requests, fabricated prices or fallback when the operator has not enabled data.
export function createReleaseMarket(env = process.env) {
  const enabled=env.STOCKS_MARKET_DATA_ENABLED ?? 'false';
  check(['true','false'].includes(enabled),'STOCKS_RELEASE_FEED_CONFIG_INVALID');
  if(enabled==='true')return createStocksRuntimeMarket({
    enabled:env.STOCKS_BINANCE_WS_ENABLED ?? 'false',authorityMode:true,
  });
  check(!env.STOCKS_BINANCE_WS_ENABLED||env.STOCKS_BINANCE_WS_ENABLED==='false','STOCKS_RELEASE_FEED_CONFIG_INVALID');
  return {
    metrics:{dataEnabled:false},
    catalogue:async()=>CATALOG.map(row=>({...row,online:false,exists:null,display:null,sourceError:'SOURCE_UNAVAILABLE'})),
    quote:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    history:async()=>{throw new SimError('SOURCE_UNAVAILABLE');},
    quoteValid:()=>false,
  };
}
