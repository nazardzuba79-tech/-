import { krakenInstrumentSnapshot } from './kraken-instrument.mjs';
import { MarketHub } from './market.mjs';
import { CATALOG, VENUE_CATALOG, instrument } from './catalog.mjs';
import { LIVE_CATALOG, LIVE_PROVIDERS } from './live-catalog.mjs';
import { LIVE_METADATA, confirmLiveInstrument } from './live-rest.mjs';
import { LiveEquityFeed } from './live-feed.mjs';
import { check } from './engine.mjs';
import { performance } from 'node:perf_hooks';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class LiveMarketHub extends MarketHub {
  constructor({liveVenues=[],feedOptions={},...options}={}) {
    check(liveVenues.length>0&&liveVenues.every(v=>LIVE_PROVIDERS.includes(v)),'VENUE_UNKNOWN');
    super({...options,binanceHost:'data-api.binance.vision',venues:liveVenues.filter(v=>!['binance','bybit'].includes(v))});
    this.liveVenues=new Set(liveVenues);this.rows=[...CATALOG,...VENUE_CATALOG,...LIVE_CATALOG].filter(i=>this.liveVenues.has(i.provider));
    this.feed=new LiveEquityFeed({...feedOptions,fetchImpl:this.fetch,now:this.now});this.catalogueFlight=null;this.catalogueAt=0;this.pendingDemand=new Map();this.waiters=0;this.liveHistoryCache=new Map();
  }
  async catalogue(){if(this.catalogueAt&&this.now()-this.catalogueAt<(Object.keys(this.errors).length?30000:600000))return this.catalogueView();if(this.catalogueFlight)return this.catalogueFlight;
    this.catalogueFlight=(async()=>{await Promise.all([...this.liveVenues].map(async v=>{const rows=this.rows.filter(i=>i.provider===v);try{let url=LIVE_METADATA[v];if(v==='binance')url+='?symbols='+encodeURIComponent(JSON.stringify(rows.map(i=>i.sourceSymbol)));const j=await this.request(url,600000);const pairs=v==='kraken'?await krakenInstrumentSnapshot():null;for(const i of rows){const meta=confirmLiveInstrument(j,i,this.now());if(pairs&&!pairs.some(p=>p.symbol===i.asset+'/USD'&&p.base===i.asset&&p.quote===i.currency)){meta.exists=false;meta.online=false;}this.verified.set(i.id,meta);delete this.errors[i.id];}}catch(e){for(const i of rows){this.verified.set(i.id,{exists:null,online:false,checkedAt:this.now()});this.errors[i.id]=e.code??'SOURCE_UNAVAILABLE';}}}));this.catalogueAt=this.now();for(const[owner,id]of this.pendingDemand)this.setStockDemand(owner,id);return this.catalogueView();})().finally(()=>{this.catalogueFlight=null;});return this.catalogueFlight;
  }
  catalogueView(){return this.rows.map(i=>{const v=this.verified.get(i.id),q=this.feed.quotes.get(i.id);return {...i,...v,display:q?.last?{price:q.last,change24h:q.change24h??null,timestamp:q.lastTimestamp}:null,sourceError:this.errors[i.id]??(!v?.exists?'INSTRUMENT_NOT_CONFIRMED':!v.online?'MARKET_CLOSED':null)};});}
  setStockDemand(owner,id){if(!id){this.releaseStockDemand(owner);return;}check(this.pendingDemand.size<512||this.pendingDemand.has(owner),'SOURCE_BUSY');this.pendingDemand.set(owner,id);const v=this.verified.get(id);if(v?.exists&&v.online)this.feed.demand(owner,id);else this.feed.release(owner);}
  // No hidden background trading subscriptions: financial execution stays OFF.
  setStockOrders(){}
  releaseStockDemand(owner){this.pendingDemand.delete(owner);this.feed.release(owner);}
  async quote(id,{includeUsdc=true}={}){const i=instrument(id);check(i&&this.liveVenues.has(i.provider),'SOURCE_UNAVAILABLE');if(!this.catalogueAt||this.now()-this.catalogueAt>=(Object.keys(this.errors).length?30000:600000))await this.catalogue();const meta=this.verified.get(id);check(meta?.exists,'INSTRUMENT_NOT_CONFIRMED');check(meta.online,'MARKET_CLOSED');
    // Read only an existing lease; a request must not create immortal demand.
    check([...this.feed.owners.values()].some(d=>d.id===id&&d.until>this.now()),'QUOTE_UNAVAILABLE');check(this.waiters<64,'SOURCE_BUSY');this.waiters++;let q;
    try{const deadline=performance.now()+2200;for(;;){try{q=this.feed.read(id);break;}catch(e){if(performance.now()>=deadline)throw e;await pause(40);}}}finally{this.waiters--;}
    q={...q,instrumentId:id,provider:i.provider,nativeCurrency:i.currency,verified:true,capacity:'1.00000000',multiplier:meta.multiplier??null,delaySeconds:0,eventId:`${i.sourceSymbol}:${q.generation}:${q.timestamp}`,streamGeneration:q.generation,marketOpen:true,prices:{},fx:{},transport:'websocket'};
    if(i.currency==='USDT')q.prices.USDT={buy:q.ask,sell:q.bid};
    // Native USD is not a stablecoin peg. No invented USD/USDT or RUB conversion.
    return includeUsdc&&i.currency==='USDT'?this.withUsdcPrices(q):q;
  }
  quoteValid(q,id=q?.instrumentId){return !!q&&this.feed.valid(id,q.streamGeneration);}
  async history(id,interval='15m',before=null,options={}){if(!this.catalogueAt)await this.catalogue();const v=this.verified.get(id);check(v?.exists&&v.online,'INSTRUMENT_NOT_CONFIRMED');if(!before)this.feed.history(id,interval);
    const value=await super.history(id,interval,before,options);if(before)return value;const live=this.feed.candle(id,interval);if(!live||live.time<(value.candles.at(-1)?.time??0))return value;
    const key=id+'|'+interval,old=this.liveHistoryCache.get(key);if(old?.base===value&&old.live===live)return old.result;
    const {time,open,high,low,close,volume}=live;const candles=value.candles.filter(c=>c.time!==time);candles.push(Object.freeze({time,open,high,low,close,volume}));candles.sort((a,b)=>a.time-b.time);const result=Object.freeze({...value,candles:Object.freeze(candles.slice(-300)),liveReceivedAt:live.receivedAt,transport:'rest+websocket'});
    // Reuse both normalized candles and the server's WeakMap JSON serialization
    // for concurrent readers. Retain at most 32 merged pages, no raw REST copy.
    this.liveHistoryCache.delete(key);this.liveHistoryCache.set(key,{base:value,live,result});while(this.liveHistoryCache.size>32)this.liveHistoryCache.delete(this.liveHistoryCache.keys().next().value);return result;
  }
  close(){this.feed.close();this.pendingDemand.clear();this.liveHistoryCache.clear();}
}
