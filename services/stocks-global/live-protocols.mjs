import { gunzipSync } from 'node:zlib';
import { decodeMexcPublic } from './mexc-public-protobuf.mjs';
export const FRAME_LIMIT=256*1024;
const mins={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1D':1440};
const mex={'1m':'Min1','5m':'Min5','15m':'Min15','30m':'Min30','1h':'Min60','4h':'Hour4','1D':'Day1'};
const ku={'1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1hour','4h':'4hour','1D':'1day'};
const bx=t=>t.endsWith('m')?t+'in':t==='1D'?'1d':t;
export const wsSymbol=i=>i.provider==='kraken'?`${i.asset}/USD`:i.sourceSymbol;
export const WS_ENDPOINTS={binance:'wss://data-stream.binance.vision:443/ws',bybit:'wss://stream.bybit.com/v5/public/spot',gate:'wss://api.gateio.ws/ws/v4/',mexc:'wss://wbs-api.mexc.com/ws',okx:'wss://ws.okx.com/ws/v5/public',kraken:'wss://ws.kraken.com/v2',bingx:'wss://open-api-ws.bingx.com/market',bitget:'wss://ws.bitget.com/v3/ws/public'};
// Every message is a public market subscription. No account/order/private topic.
export function subscriptions(venue, instruments, intervals=['15m'], op='subscribe') {
  const syms=instruments.map(wsSymbol),on=op==='subscribe',list=[];
  if(venue==='binance')return[{method:on?'SUBSCRIBE':'UNSUBSCRIBE',id:1,params:syms.flatMap(s=>[s.toLowerCase()+'@ticker',...intervals.map(t=>s.toLowerCase()+'@kline_'+(t==='1D'?'1d':t))])}];
  if(venue==='bybit'){const args=syms.flatMap(s=>['tickers.'+s,'orderbook.1.'+s,...intervals.map(t=>'kline.'+(t==='1D'?'D':mins[t])+'.'+s)]);for(let n=0;n<args.length;n+=10)list.push({op,args:args.slice(n,n+10)});return list;}
  if(venue==='gate'){for(const s of syms){for(const channel of ['spot.tickers','spot.book_ticker'])list.push({time:Math.floor(Date.now()/1000),channel,event:op,payload:[s]});for(const t of intervals)list.push({time:Math.floor(Date.now()/1000),channel:'spot.candlesticks',event:op,payload:[t==='1D'?'1d':t,s]});}return list;}
  if(venue==='mexc')return[{method:on?'SUBSCRIPTION':'UNSUBSCRIPTION',params:syms.flatMap(s=>[`spot@public.aggre.bookTicker.v3.api.pb@100ms@${s}`,`spot@public.miniTicker.v3.api.pb@${s}@UTC+0`,...intervals.map(t=>`spot@public.kline.v3.api.pb@${s}@${mex[t]}`)])}];
  if(venue==='okx')return[{op,args:syms.map(instId=>({channel:'tickers',instId}))}];
  if(venue==='bitget')return[{op,args:syms.flatMap(symbol=>[{instType:'spot',topic:'ticker',symbol},...intervals.map(t=>({instType:'spot',topic:'kline',symbol,interval:t==='1h'?'1H':t==='4h'?'4H':t}))])}];
  if(venue==='kraken')return[{method:op,params:{channel:'ticker',symbol:syms,event_trigger:'bbo',snapshot:true}},...intervals.map(t=>({method:op,params:{channel:'ohlc',symbol:syms,interval:mins[t],snapshot:true}}))];
  if(venue==='bingx')return syms.flatMap(s=>[s+'@ticker',...intervals.map(t=>s+'@kline_'+bx(t))]).map((dataType,n)=>({id:String(n),reqType:on?'sub':'unsub',dataType}));
  if(venue==='kucoin')return syms.flatMap(s=>[{id:s+'-ticker',type:op,topic:'/market/ticker:'+s,privateChannel:false,response:true},{id:s+'-stats',type:op,topic:'/market/snapshot:'+s,privateChannel:false,response:true},...intervals.map(t=>({id:s+'-'+t,type:op,topic:'/market/candles:'+s+'_'+ku[t],privateChannel:false,response:true}))]);
  throw Error('VENUE_UNKNOWN');
}
// Atomize exact requested topics, then batch only protocol-compatible controls.
// This permits demand changes on the existing socket instead of reconnecting
// every reader, and never subscribes the Cartesian product of unused intervals.
export function subscriptionPlan(venue,items,role='public') {
  const requests=role==='business'?[{op:'subscribe',args:items.flatMap(i=>i.liveIntervals.map(t=>({channel:'candle'+(t==='1h'?'1H':t==='4h'?'4H':t==='1D'?'1Dutc':t),instId:i.sourceSymbol})))}]:items.flatMap(i=>subscriptions(venue,[i],i.liveIntervals));
  const plan=new Map();
  for(const r of requests){const field=Array.isArray(r.params)?'params':Array.isArray(r.args)?'args':null;
    const atoms=field?r[field].map(value=>({...r,[field]:[value]})):[r];
    for(const subscribe of atoms){const key=field?field+':'+JSON.stringify(subscribe[field][0]):venue==='gate'?subscribe.channel+':'+JSON.stringify(subscribe.payload):venue==='kraken'?JSON.stringify(subscribe.params):subscribe.dataType??subscribe.topic;
      if(typeof key!=='string')throw Error('SUBSCRIPTION_INVALID');
      const unsubscribe={...subscribe};if(venue==='binance')unsubscribe.method='UNSUBSCRIBE';else if(venue==='mexc')unsubscribe.method='UNSUBSCRIPTION';else if(venue==='gate')unsubscribe.event='unsubscribe';else if(venue==='kraken')unsubscribe.method='unsubscribe';else if(venue==='bingx')unsubscribe.reqType='unsub';else if(venue==='kucoin')unsubscribe.type='unsubscribe';else unsubscribe.op='unsubscribe';
      plan.set(key,{key,subscribe,unsubscribe});
    }
  }return plan;
}
export function controlBatch(venue,entries,subscribe) {
  const limit=venue==='binance'?1024:venue==='mexc'?30:['bybit','okx','bitget'].includes(venue)?10:1;
  const selected=entries.slice(0,limit),packets=selected.map(a=>subscribe?a.subscribe:a.unsubscribe),first=packets[0];if(!first)throw Error('SUBSCRIPTION_EMPTY');
  let packet={...first};for(const field of ['params','args'])if(Array.isArray(first[field]))packet[field]=packets.flatMap(p=>p[field]);if(venue==='gate')packet.time=Math.floor(Date.now()/1000);
  return {packet,selected};
}
function candle(symbol,interval,time,o,h,l,c,v,timestamp){return{type:'candle',symbol,interval,time:Number(time),open:Number(o),high:Number(h),low:Number(l),close:Number(c),volume:Number(v),timestamp:Number(timestamp)};}
function quote(symbol,timestamp,data){return{type:'quote',symbol,timestamp:Number(timestamp),...Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined&&v!==null&&v!==''))};}
export function decodeFrame(venue,input,binary=false) {
  const raw=Buffer.isBuffer(input)?input:Buffer.from(input);if(raw.length>FRAME_LIMIT)throw Error('FRAME_TOO_LARGE');
  if(venue==='mexc'&&binary){const x=decodeMexcPublic(raw),d=x.data;if(x.kind===308)return[candle(x.symbol,Object.keys(mex).find(k=>mex[k]===d.interval),d.time,d.open,d.high,d.low,d.close,d.volume,x.timestamp)];if(d.symbol&&d.symbol!==x.symbol)throw Error('SYMBOL_MISMATCH');return[quote(x.symbol,x.timestamp,{...d,...(x.kind===315||x.kind===305?{book:true}:{})})];}
  const text=venue==='bingx'&&raw[0]===31&&raw[1]===139?gunzipSync(raw,{maxOutputLength:FRAME_LIMIT}).toString():raw.toString();
  if(text==='Ping')return[{type:'reply',value:'Pong'}];if(text==='pong')return[];
  const j=JSON.parse(text),out=[];
  if(venue==='bybit'&&j.data&&j.topic){if(j.topic.startsWith('tickers.')&&j.data.symbol!==j.topic.slice(8)||j.topic.startsWith('orderbook.')&&j.data.s!==j.topic.split('.').slice(2).join('.'))throw Error('SYMBOL_MISMATCH');}
  if(venue==='binance'&&j.stream&&j.data?.s&&j.stream.split('@')[0]!==j.data.s.toLowerCase())throw Error('SYMBOL_MISMATCH');
  if(venue==='okx'&&j.data&&j.arg?.channel==='tickers'&&j.data.some(x=>x.instId!==j.arg.instId))throw Error('SYMBOL_MISMATCH');
  if(venue==='bingx'&&j.data?.s&&j.dataType?.split('@')[0]!==j.data.s)throw Error('SYMBOL_MISMATCH');
  if(venue==='kucoin'&&j.topic?.startsWith('/market/snapshot:')&&j.data?.data?.symbol!==j.topic.split(':')[1])throw Error('SYMBOL_MISMATCH');
  if(venue==='bitget'&&j.arg&&Array.isArray(j.data)){if(j.arg.instType!=='spot')throw Error('PRODUCT_TYPE_DIFFERENT');for(const x of j.data){if(j.arg.topic==='ticker')out.push(quote(j.arg.symbol,j.ts,{bid:x.bid1Price,ask:x.ask1Price,bidSize:x.bid1Size,askSize:x.ask1Size,last:x.lastPrice,volume:x.volume24h,change24h:Number(x.price24hPcnt)*100,volumeScope:'provider-reported',platformTurnover24h:x.platformTurnover24h}));if(j.arg.topic==='kline')out.push(candle(j.arg.symbol,j.arg.interval==='1H'?'1h':j.arg.interval==='4H'?'4h':j.arg.interval,Number(x.start)/1000,x.open,x.high,x.low,x.close,x.volume,j.ts));}}
  if(venue==='binance'){const x=j.data??j;if(x.e==='24hrTicker')out.push(quote(x.s,x.E,{bid:x.b,ask:x.a,bidSize:x.B,askSize:x.A,last:x.c,volume:x.v,change24h:Number(x.P),sequence:x.E}));if(x.e==='kline'){const k=x.k;out.push(candle(x.s,k.i==='1d'?'1D':k.i,k.t/1000,k.o,k.h,k.l,k.c,k.v,x.E));}}
  if(venue==='bybit'&&j.topic&&j.data){const x=j.data;if(j.topic.startsWith('tickers.')){out.push(quote(x.symbol,j.ts,{last:x.lastPrice,volume:x.volume24h,change24h:x.price24hPcnt===undefined?undefined:100*Number(x.price24hPcnt),bid:x.bid1Price,ask:x.ask1Price,sequence:j.cs}));}if(j.topic.startsWith('orderbook.'))out.push(quote(x.s,j.cts??j.ts,{bid:x.b?.[0]?.[0],ask:x.a?.[0]?.[0],bidSize:x.b?.[0]?.[1],askSize:x.a?.[0]?.[1],sequence:x.u,book:true}));if(j.topic.startsWith('kline.')){const [,t,s]=j.topic.split('.');for(const k of x)out.push(candle(s,Object.keys(mins).find(k=>String(mins[k])===t)??(t==='D'?'1D':null),k.start/1000,k.open,k.high,k.low,k.close,k.volume,j.ts));}}
  if(venue==='gate'&&j.event==='update'){const x=j.result;if(j.channel==='spot.tickers')out.push(quote(x.currency_pair,j.time_ms,{last:x.last,volume:x.base_volume,change24h:Number(x.change_percentage),bid:x.highest_bid,ask:x.lowest_ask}));if(j.channel==='spot.book_ticker')out.push(quote(x.s,x.t,{bid:x.b,ask:x.a,bidSize:x.B,askSize:x.A,sequence:x.u,book:true}));if(j.channel==='spot.candlesticks'){const n=x.n.indexOf('_');out.push(candle(x.n.slice(n+1),x.n.slice(0,n)==='1d'?'1D':x.n.slice(0,n),x.t,x.o,x.h,x.l,x.c,x.a,j.time_ms));}}
  if(venue==='okx'&&j.arg&&Array.isArray(j.data)){for(const x of j.data){if(j.arg.channel==='tickers')out.push(quote(x.instId,x.ts,{bid:x.bidPx,ask:x.askPx,bidSize:x.bidSz,askSize:x.askSz,last:x.last,volume:x.vol24h,change24h:Number(x.open24h)>0?(Number(x.last)/Number(x.open24h)-1)*100:undefined}));if(j.arg.channel.startsWith('candle')){const t=j.arg.channel.slice(6);out.push(candle(j.arg.instId,t==='1H'?'1h':t==='4H'?'4h':t==='1Dutc'?'1D':t,Number(x[0])/1000,x[1],x[2],x[3],x[4],x[5],j.ts??Number(x[0])));}}}
  if(venue==='kraken'&&Array.isArray(j.data))for(const x of j.data){if(j.channel==='ticker')out.push(quote(x.symbol,Date.parse(x.timestamp),{bid:x.bid,ask:x.ask,bidSize:x.bid_qty,askSize:x.ask_qty,last:x.last,volume:x.volume,change24h:x.change_pct}));if(j.channel==='ohlc')out.push(candle(x.symbol,Object.keys(mins).find(k=>mins[k]===x.interval),Date.parse(x.interval_begin)/1000,x.open,x.high,x.low,x.close,x.volume,Date.parse(x.interval_begin)));}
  if(venue==='bingx'&&j.code===0&&j.data){const x=j.data;if(j.dataType?.endsWith('@ticker'))out.push(quote(x.s,x.E??j.timestamp,{bid:x.B,ask:x.A,bidSize:x.b,askSize:x.a,last:x.c,volume:x.v,change24h:Number(String(x.P).replace('%',''))}));if(j.dataType?.includes('@kline_')){const k=x.K;const t=j.dataType.split('@kline_')[1];if(k)out.push(candle(x.s,t.endsWith('min')?t.slice(0,-2):t==='1d'?'1D':t,k.t/1000,k.o,k.h,k.l,k.c,k.v,x.E??j.timestamp));}}
  if(venue==='kucoin'&&j.type==='message'){const x=j.data;if(j.topic?.startsWith('/market/ticker:'))out.push(quote(j.topic.split(':')[1],x.time,{bid:x.bestBid,ask:x.bestAsk,bidSize:x.bestBidSize,askSize:x.bestAskSize,last:x.price,sequence:x.sequence}));if(j.topic?.startsWith('/market/snapshot:')){const d=x.data;if(d)out.push(quote(j.topic.split(':')[1],d.datetime,{stats:true,bid:d.buy,ask:d.sell,bidSize:d.bidSize,askSize:d.askSize,last:d.lastTradedPrice??d.last??d.close,volume:d.vol,change24h:Number(d.changeRate)*100}));}if(j.topic?.startsWith('/market/candles:')){const [s,t]=j.topic.split(':')[1].split('_'),k=x.candles;if(x.symbol!==s)throw Error('SYMBOL_MISMATCH');out.push(candle(s,Object.keys(ku).find(k=>ku[k]===t),k[0],k[1],k[3],k[4],k[2],k[5],Math.floor(Number(x.time)/1000000)));}}
  const failed=j.success===false||j.event==='error'||j.retCode>0||j.code&&![0,'0','200000','00000'].includes(j.code);if(failed)throw Error('SUBSCRIPTION_REJECTED');
  return out;
}
