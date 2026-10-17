import { MarketHub } from './market.mjs';
import { SharedTickerMarketHub } from './shared-ticker-market.mjs';
import { BinanceTradeFeed } from './binance-trade-feed.mjs';
import { instrument } from './catalog.mjs';
import { randomUUID } from 'node:crypto';
import { check } from './engine.mjs';

// Explicit constructor injection only. Disabled construction is the REST hub.
export class BinanceStreamMarketHub extends MarketHub {
  constructor({enabled=false,feedOptions,...options}={}){super(options);this.feed=enabled?new BinanceTradeFeed({...feedOptions,now:this.now}):null;}
  request(...args){return this.feed?SharedTickerMarketHub.prototype.request.apply(this,args):super.request(...args);}
  async binanceNative(symbol){if(!this.feed)return super.binanceNative(symbol);const t=this.feed.read(symbol);return{rows:[{id:t.id,time:t.time,price:t.price}],receivedAt:t.receivedAt,streamGeneration:t.generation};}
  quoteValid(q,id=q?.instrumentId){return !this.feed||instrument(id)?.provider!=='binance'||Number.isSafeInteger(q?.streamGeneration)&&this.feed.valid(instrument(id).sourceSymbol,q.streamGeneration);}
  async withPortfolioDemand(id,read,{signal}={}){
    if(!this.feed||instrument(id)?.provider!=='binance')return read();
    if(!this.verified.has(id)||this.now()-this.verified.get(id).checkedAt>600000)await this.catalogue();
    check(!signal?.aborted,'SOURCE_BUSY');const symbol=this.symbol(id);if(!symbol)return read();
    const owner='portfolio:'+randomUUID(),controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const release=()=>this.feed.release(owner),timer=setTimeout(()=>{controller.abort();release();},2500);combined.addEventListener('abort',release,{once:true});
    try{this.feed.demand(owner,{selected:symbol,until:this.now()+2500});await this.feed.waitForTrade(symbol,{signal:combined});check(!combined.aborted,'SOURCE_BUSY');return await read();}
    finally{clearTimeout(timer);combined.removeEventListener('abort',release);release();}
  }
  observationSignal(q,id=q?.instrumentId){if(!this.feed||instrument(id)?.provider!=='binance')return undefined;return this.quoteValid(q,id)?this.feed.generationAbort.signal:AbortSignal.abort();}
  symbol(id){const i=instrument(id),v=this.verified.get(id);return i?.provider==='binance'&&v?.exists&&v.online?i.sourceSymbol:null;}
  setStockDemand(owner,id){if(!this.feed)return;const pinned=[...(this.feed.owners.get(owner)?.pinned??[])];this.feed.demand(owner,{selected:this.symbol(id),pinned});}
  setStockOrders(owner,orders){if(!this.feed)return;const old=this.feed.owners.get(owner),pinned=[...new Set(orders.filter(o=>['OPEN','PARTIAL'].includes(o.status)).map(o=>this.symbol(o.instrumentId)).filter(Boolean))];this.feed.demand(owner,{selected:old?.selected??null,until:old?.until??0,pinned});}
  releaseStockDemand(owner){this.feed?.release(owner);}
  close(){this.feed?.close();}
}
