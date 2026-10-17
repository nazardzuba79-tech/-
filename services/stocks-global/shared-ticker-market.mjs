// Explicitly injected Stocks-only candidate. Default MarketHub and crypto
// services are untouched. Execution books/trades remain native observations.
import { MarketHub } from './market.mjs';
import { CATALOG } from './catalog.mjs';
import { check } from './engine.mjs';

export class SharedTickerMarketHub extends MarketHub {
  async request(address,ttl=0,text=false) {
    const url=new URL(address),symbol=url.searchParams.get('symbol');
    const stock=CATALOG.find(i=>i.sourceSymbol===symbol&&url.origin===`https://api.${i.provider}.com`);
    // Only the exact current native-quote metadata request is shared. Do not
    // rewrite trade/book/history/FX, another symbol, another type or another TTL.
    if(!stock||text||ttl!==15000)return super.request(address,ttl,text);
    const keys=[...url.searchParams.keys()];let batch;
    if(stock.provider==='bybit'&&url.pathname==='/v5/market/tickers'&&url.searchParams.get('category')==='spot'&&keys.length===2){
      batch='https://api.bybit.com/v5/market/tickers?category=spot';
    }else if(stock.provider==='binance'&&url.pathname==='/api/v3/ticker/24hr'&&keys.length===1){
      batch='https://api.binance.com/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(CATALOG.filter(i=>i.provider==='binance').map(i=>i.sourceSymbol)));
    }else return super.request(address,ttl,text);
    // Same URL as catalogue, but each caller retains its own existing TTL.
    // Parent request() owns coalescing, response bounds, errors and100/min cap.
    const result=await super.request(batch,ttl,false);
    if(stock.provider==='bybit')check(result&&result.retCode===0,'INVALID_DATA');
    const rows=stock.provider==='bybit'?result.result?.list:result;check(Array.isArray(rows),'INVALID_DATA');
    const matches=rows.filter(row=>row?.symbol===symbol);check(matches.length===1,'INVALID_DATA');
    const selected=structuredClone(matches[0]);
    return stock.provider==='bybit'?{...result,result:{...result.result,list:[selected]}}:selected;
  }
}
