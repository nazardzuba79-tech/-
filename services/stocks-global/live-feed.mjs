import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { instrument } from './catalog.mjs';
import { check, SimError } from './engine.mjs';
import { decodeFrame, subscriptionPlan, controlBatch, WS_ENDPOINTS, wsSymbol, FRAME_LIMIT } from './live-protocols.mjs';
import { performance } from 'node:perf_hooks';
const good=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
const quantity=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;

// Process-shared, demand-only public data. No account decisions, credentials,
// finance routes or user-specific responses live in this cache.
export class LiveEquityFeed {
  constructor({WebSocketImpl=WebSocket,fetchImpl=fetch,now=Date.now,random=Math.random,onEvent=()=>{},onPublicFrame=()=>{},maxAgeMs=5000}={}) {
    Object.assign(this,{WebSocketImpl,fetch:fetchImpl,now,random,onEvent,onPublicFrame,maxAgeMs});
    this.owners=new Map();this.historyDemand=new Map();this.connections=new Map();this.quotes=new Map();this.candles=new Map();this.closed=false;this.generation=0;
    this.metrics={connections:0,reconnects:0,frames:0,rejected:0,stale:0,subscriptions:0};
    this.sweep=setInterval(()=>this.reconcile(),1000);this.sweep.unref?.();
  }
  demand(owner,id,until=this.now()+12000) {check(typeof owner==='string'&&this.owners.size<512||this.owners.has(owner),'SOURCE_BUSY');check(instrument(id),'UNKNOWN_INSTRUMENT');this.owners.set(owner,{id,until});this.reconcile();}
  history(id,interval){check(instrument(id)?.timeframes.includes(interval),'UNSUPPORTED_TIMEFRAME');check(this.historyDemand.size<256||this.historyDemand.has(id+'|'+interval),'SOURCE_BUSY');this.historyDemand.set(id+'|'+interval,{id,interval,until:this.now()+16000});this.reconcile();}
  release(owner){this.owners.delete(owner);this.reconcile();}
  desired(){const groups=new Map(),active=new Set();for(const[o,d]of this.owners)if(d.until<=this.now())this.owners.delete(o);else active.add(d.id);
    for(const[k,d]of this.historyDemand)if(d.until<=this.now())this.historyDemand.delete(k);
    for(const id of active){const i=instrument(id);if(!i)continue;const intervals=new Set([...this.historyDemand.values()].filter(d=>d.id===id).map(d=>d.interval));if(!intervals.size)intervals.add('15m');
      for(const role of i.provider==='okx'?['public','business']:['public']){const weight=2+intervals.size;let shard=0,key=i.provider+':'+role;while(i.provider==='mexc'&&groups.has(key)&&(groups.get(key).weight??0)+weight>30)key=i.provider+':'+role+':'+(++shard);let g=groups.get(key);if(!g)groups.set(key,g={venue:i.provider,role,items:[],intervals:new Set(),weight:0});g.items.push({...i,liveIntervals:[...intervals]});g.weight+=weight;for(const t of intervals)g.intervals.add(t);}
    }return groups;
  }
  reconcile(){if(this.closed)return;const groups=this.desired();for(const[key,c]of this.connections)if(!groups.has(key)){this.stop(c);this.connections.delete(key);}for(const[key,g]of groups){const fingerprint=g.items.map(i=>i.id+'='+i.liveIntervals.slice().sort().join('/')).sort().join(',');let c=this.connections.get(key);if(c?.fingerprint===fingerprint)continue;
      if(c){for(const old of c.items)if(!g.items.some(i=>i.id===old.id))this.invalidateId(old.id);Object.assign(c,g,{fingerprint,plan:subscriptionPlan(g.venue,g.items,g.role)});this.flushControls(c);continue;}
      c={...g,key,fingerprint,plan:subscriptionPlan(g.venue,g.items,g.role),sentPlan:new Map(),attempt:0,generation:++this.generation,dead:false,open:false};this.connections.set(key,c);void this.connect(c);
    }for(const id of this.quotes.keys())if(![...groups.values()].some(g=>g.items.some(i=>i.id===id)))this.quotes.delete(id);for(const key of this.candles.keys())if(!activeId(groups,key.split('|')[0]))this.candles.delete(key);}
  emit(c,type,detail={}){this.onEvent({venue:c.venue,role:c.role,type,...detail});}
  invalidateId(id){this.quotes.delete(id);for(const key of this.candles.keys())if(key.startsWith(id+'|'))this.candles.delete(key);}
  invalidate(c){for(const i of c.items)this.invalidateId(i.id);}
  stop(c){c.dead=true;c.open=false;clearTimeout(c.controlTimer);clearTimeout(c.retry);clearInterval(c.heartbeat);clearTimeout(c.connectTimer);c.abort?.abort();c.ws?.removeAllListeners();c.ws?.on('error',()=>{});c.ws?.terminate();this.invalidate(c);}
  flushControls(c){if(c.dead||!c.open||c.controlTimer||c.ws?.readyState!==undefined&&c.ws.readyState!==1)return;
    const remove=[...c.sentPlan.values()].filter(a=>!c.plan.has(a.key)),add=[...c.plan.values()].filter(a=>!c.sentPlan.has(a.key));if(!remove.length&&!add.length)return;
    const wait=Math.max(0,(c.nextControlAt??0)-performance.now());if(wait>0){c.controlTimer=setTimeout(()=>{c.controlTimer=null;this.flushControls(c);},wait);c.controlTimer.unref?.();return;}
    const subscribe=!remove.length,{packet,selected}=controlBatch(c.venue,subscribe?add:remove,subscribe);if(packet.id!==undefined){const id=++c.requestId;packet.id=['kucoin','bingx'].includes(c.venue)?String(id):id;}
    try{c.ws.send(JSON.stringify(packet));for(const a of selected)if(subscribe)c.sentPlan.set(a.key,a);else c.sentPlan.delete(a.key);this.metrics.subscriptions++;c.nextControlAt=performance.now()+300;c.controlTimer=setTimeout(()=>{c.controlTimer=null;this.flushControls(c);},300);c.controlTimer.unref?.();}catch{c.ws.terminate();}
  }
  async endpoint(c){if(c.venue!=='kucoin')return c.role==='business'?'wss://ws.okx.com/ws/v5/business':WS_ENDPOINTS[c.venue];
    // Official unauthenticated public connection token, never a trading POST.
    // No token/URL is logged or persisted. Redirects and arbitrary hosts refused.
    c.abort=new AbortController();const r=await this.fetch('https://api.kucoin.com/api/v1/bullet-public',{method:'POST',redirect:'error',signal:AbortSignal.any([c.abort.signal,AbortSignal.timeout(6000)])});if(!r.ok)throw Error('PUBLIC_TOKEN_HTTP_'+r.status);const text=await r.text();if(text.length>32768)throw Error('PUBLIC_TOKEN_SIZE');const j=JSON.parse(text),server=j.data?.instanceServers?.[0];if(j.code!=='200000'||typeof j.data.token!=='string'||j.data.token.length>8192||server?.endpoint!=='wss://ws-api-spot.kucoin.com/')throw Error('PUBLIC_TOKEN_INVALID');return server.endpoint+'?token='+encodeURIComponent(j.data.token)+'&connectId='+randomUUID();
  }
  async connect(c){if(c.dead||this.closed)return;try{const endpoint=await this.endpoint(c);if(c.dead)return;const ws=new this.WebSocketImpl(endpoint,{maxPayload:FRAME_LIMIT,perMessageDeflate:false,handshakeTimeout:6000});c.ws=ws;c.lastMessage=this.now();
      c.connectTimer=setTimeout(()=>ws.terminate(),6500);c.connectTimer.unref?.();
      ws.on('open',()=>{if(c.dead)return;clearTimeout(c.connectTimer);this.metrics.connections++;this.emit(c,'open');c.openedAt=this.now();c.lastMessage=this.now();c.open=true;c.sentPlan.clear();c.requestId=0;c.nextControlAt=0;this.flushControls(c);
        c.heartbeat=setInterval(()=>{if(c.dead)return;if(this.now()-c.lastMessage>45000){ws.terminate();return;}if(c.venue==='bingx'||c.venue==='binance')return;if(c.venue==='okx'||c.venue==='bitget')ws.send('ping');else if(c.venue==='bybit')ws.send(JSON.stringify({op:'ping'}));else if(c.venue==='kucoin')ws.send(JSON.stringify({id:String(this.now()),type:'ping'}));else if(c.venue==='mexc')ws.send(JSON.stringify({method:'PING'}));else if(c.venue==='gate')ws.send(JSON.stringify({time:Math.floor(this.now()/1000),channel:'spot.ping'}));else ws.ping();},15000);c.heartbeat.unref?.();
      });
      ws.on('message',(raw,binary)=>{if(c.dead||c.ws!==ws)return;c.lastMessage=this.now();this.metrics.frames++;try{this.onPublicFrame(c.venue,raw,binary);for(const event of decodeFrame(c.venue,raw,binary)){if(event.type==='reply'){ws.send(event.value);continue;}this.admit(c,event);}}catch(e){this.metrics.rejected++;this.emit(c,'rejected',{code:e.message});if(['SUBSCRIPTION_REJECTED','STREAM_RESET'].includes(e.message))ws.terminate();}});
      ws.on('ping',()=>{c.lastMessage=this.now();});ws.on('pong',()=>{c.lastMessage=this.now();});ws.on('error',e=>this.emit(c,'error',{code:e.code??'WS_ERROR'}));ws.on('close',()=>{c.open=false;clearTimeout(c.controlTimer);c.controlTimer=null;clearTimeout(c.connectTimer);clearInterval(c.heartbeat);if(c.dead||this.closed)return;this.invalidate(c);c.generation=++this.generation;this.metrics.reconnects++;if(this.now()-(c.openedAt??this.now())>30000)c.attempt=0;const delay=Math.min(30000,500*2**Math.min(c.attempt++,6))*(.8+this.random()*.4);this.emit(c,'retry',{delayMs:Math.round(delay)});c.retry=setTimeout(()=>void this.connect(c),delay);c.retry.unref?.();});
    }catch(e){if(c.dead||this.closed)return;this.emit(c,'error',{code:e.message.startsWith('PUBLIC_')?e.message:'WS_CONNECT_FAILED'});c.retry=setTimeout(()=>void this.connect(c),Math.min(30000,1000*2**Math.min(c.attempt++,5)));c.retry.unref?.();}}
  admit(c,e){const i=c.items.find(i=>wsSymbol(i)===e.symbol);if(!i)throw Error('SYMBOL_MISMATCH');if(!Number.isSafeInteger(e.timestamp)||e.timestamp<=0||e.timestamp>this.now()+2000)throw Error('SOURCE_TIME_INVALID');
    if(e.type==='candle'){if(!c.intervals.has(e.interval)||!Number.isSafeInteger(e.time)||e.time>this.now()/1000||![e.open,e.high,e.low,e.close,e.volume].every(Number.isFinite)||Math.min(e.open,e.high,e.low,e.close)<=0||e.volume<0||e.high<Math.max(e.open,e.close,e.low)||e.low>Math.min(e.open,e.close))throw Error('INVALID_CANDLES');const key=i.id+'|'+e.interval,old=this.candles.get(key);if(old&&(e.time<old.time||e.time===old.time&&e.timestamp<old.timestamp))throw Error('OUT_OF_ORDER');this.candles.set(key,{...e,generation:c.generation,receivedAt:this.now()});this.emit(c,'candle',{id:i.id,interval:e.interval});return;}
    const old=this.quotes.get(i.id)??{generation:c.generation};const stream=e.book?'book':e.stats?'stats':'ticker',timeKey=stream+'Timestamp',sequenceKey=stream+'Sequence';if(old[timeKey]>e.timestamp)throw Error('OUT_OF_ORDER');if(e.sequence!==undefined&&old[sequenceKey]!==undefined&&BigInt(e.sequence)<BigInt(old[sequenceKey])){this.invalidate(c);throw Error('STREAM_RESET');}
    const next={...old,[timeKey]:e.timestamp,[sequenceKey]:e.sequence??old[sequenceKey],receivedAt:this.now()};
    if(e.bid!==undefined||e.ask!==undefined){if(!good(e.bid)||!good(e.ask)||Number(e.bid)>Number(e.ask))throw Error('INVALID_BBO');if(!old.timestamp||e.timestamp>=old.timestamp)Object.assign(next,{bid:String(e.bid),ask:String(e.ask),timestamp:e.timestamp,bidSize:quantity(e.bidSize)?String(e.bidSize):null,askSize:quantity(e.askSize)?String(e.askSize):null});}
    if(e.last!==undefined){if(!good(e.last))throw Error('INVALID_PRICE');if(!old.lastTimestamp||e.timestamp>=old.lastTimestamp){next.last=String(e.last);next.lastTimestamp=e.timestamp;}}
    if(e.volume!==undefined){if(!quantity(e.volume))throw Error('INVALID_VOLUME');next.volume=String(e.volume);}
    if(e.volumeScope)next.volumeScope=e.volumeScope;
    if(quantity(e.platformTurnover24h))next.platformTurnover24h=String(e.platformTurnover24h);
    if(e.change24h!==undefined&&Number.isFinite(e.change24h))next.change24h=e.change24h;
    this.quotes.set(i.id,next);this.emit(c,'quote',{id:i.id,complete:!!next.last&&!!next.bid&&!!next.ask});
  }
  read(id){const q=this.quotes.get(id);check(q?.last&&q?.bid&&q?.ask,'QUOTE_UNAVAILABLE');check(this.now()-q.timestamp<=this.maxAgeMs&&q.timestamp<=this.now()+2000,'QUOTE_STALE');return {...q};}
  valid(id,generation){try{return this.read(id).generation===generation;}catch{return false;}}
  candle(id,interval){return this.candles.get(id+'|'+interval);}
  close(){this.closed=true;clearInterval(this.sweep);for(const c of this.connections.values())this.stop(c);this.connections.clear();this.owners.clear();this.historyDemand.clear();this.quotes.clear();this.candles.clear();}
}
function activeId(groups,id){return [...groups.values()].some(g=>g.items.some(i=>i.id===id));}
