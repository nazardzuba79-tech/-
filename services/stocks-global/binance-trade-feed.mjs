// Stocks-only public raw-trade cache. No account, order, wallet or matcher access.
import WebSocket from 'ws';
import { check, units, SimError } from './engine.mjs';
import { CATALOG } from './catalog.mjs';

const SYMBOLS=new Set(CATALOG.filter(i=>i.provider==='binance').map(i=>i.sourceSymbol));
export class BinanceTradeFeed {
  constructor({url='wss://stream.binance.com:9443/stream',synthetic=false,now=Date.now,monotonicNow=()=>performance.now()}={}){
    const u=new URL(url);
    check(url==='wss://stream.binance.com:9443/stream'||synthetic&&u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&u.pathname==='/stream','SOURCE_FORBIDDEN');
    this.url=url;this.now=now;this.monotonicNow=monotonicNow;this.generation=0;this.generationAbort=new AbortController();this.lastInbound=0;this.waiters=new Set();this.owners=new Map();this.ticks=new Map();this.watermarks=new Map();this.desired=new Set();this.subscribed=new Set();this.starts=[];this.socket=null;this.timer=null;this.sweep=null;this.pending=null;this.serial=0;this.failures=0;this.closed=false;this.frameSecond=0;this.frameCount=0;
    this.metrics={connections:0,reconnects:0,frames:0,bytes:0,accepted:0,duplicates:0,invalid:0,controls:0,heartbeats:0,heartbeatTimeouts:0,peakSymbols:0,peakOwners:0,peakBuffered:0};
  }
  demand(owner,{selected=null,pinned=[],until=this.now()+12000}={}){
    check(!this.closed&&typeof owner==='string'&&owner.length<=256,'INVALID_REQUEST');
    check(selected===null||SYMBOLS.has(selected),'INVALID_PAIR');
    check(Array.isArray(pinned)&&pinned.length<=SYMBOLS.size&&pinned.every(s=>SYMBOLS.has(s)),'INVALID_PAIR');
    check(Number.isSafeInteger(until),'INVALID_REQUEST');
    check(!selected&&!pinned.length||this.owners.has(owner)||this.owners.size<512,'SOURCE_BUSY');
    const old=this.owners.get(owner);this.owners.set(owner,{selected,until,pinned:new Set(pinned)});
    if(!selected&&!pinned.length)this.owners.delete(owner);
    this.metrics.peakOwners=Math.max(this.metrics.peakOwners,this.owners.size);this.sync();return old;
  }
  release(owner){const old=this.owners.get(owner);if(old)this.demand(owner,{pinned:[...old.pinned],until:0});}
  sync(){
    if(this.socket?.readyState===WebSocket.OPEN&&this.monotonicNow()-this.lastInbound>=45000){this.metrics.heartbeatTimeouts++;this.drop(this.socket);}
    const desired=new Set();for(const[owner,v]of this.owners){if(v.until<=this.now())v.selected=null;if(!v.selected&&!v.pinned.size){this.owners.delete(owner);continue;}if(v.selected)desired.add(v.selected);for(const s of v.pinned)desired.add(s);}
    this.desired=desired;this.metrics.peakSymbols=Math.max(this.metrics.peakSymbols,desired.size);
    for(const s of this.ticks.keys())if(!desired.has(s))this.ticks.delete(s);
    if(!desired.size){this.idle();return;}
    if(!this.sweep)this.sweep=setInterval(()=>this.sync(),1000);
    if(!this.socket&&!this.timer)this.schedule(0);
    else if(this.socket?.readyState===WebSocket.OPEN&&!this.pending&&!this.timer)this.schedule(500);
  }
  schedule(ms){if(this.closed||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;if(!this.desired.size)return;if(!this.socket)this.connect();else this.flush();},ms);}
  connect(){
    this.starts=this.starts.filter(t=>this.now()-t<60000);
    if(this.starts.length>=4){this.schedule(Math.max(500,60000-(this.now()-this.starts[0])));return;}
    this.starts.push(this.now());this.metrics.connections++;if(this.metrics.connections>1)this.metrics.reconnects++;
    const socket=new WebSocket(this.url,{maxPayload:65536,perMessageDeflate:false,handshakeTimeout:4000,followRedirects:false});this.socket=socket;this.generation++;this.generationAbort.abort();this.generationAbort=new AbortController();this.subscribed.clear();
    socket.on('open',()=>{if(this.socket===socket){this.lastInbound=this.monotonicNow();this.flush();}});
    const heartbeat=()=>{if(this.socket===socket){this.lastInbound=this.monotonicNow();this.metrics.heartbeats++;}};
    socket.on('ping',heartbeat);socket.on('pong',heartbeat);
    socket.on('message',(data,binary)=>{if(this.socket!==socket)return;this.lastInbound=this.monotonicNow();try{this.message(data,binary);}catch{this.metrics.invalid++;this.drop(socket);}});
    socket.on('error',()=>{});socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.generation++;this.generationAbort.abort();this.clearPending();this.subscribed.clear();this.ticks.clear();this.notify(new SimError('QUOTE_UNAVAILABLE'));this.failures++;if(this.desired.size)this.schedule(Math.min(8000,500*2**Math.min(4,this.failures)));});
  }
  clearPending(){if(this.pending)clearTimeout(this.pending.timer);this.pending=null;}
  drop(socket){this.generation++;this.generationAbort.abort();this.ticks.clear();this.notify(new SimError('QUOTE_UNAVAILABLE'));socket.terminate();}
  flush(){
    const socket=this.socket;if(socket?.readyState!==WebSocket.OPEN||this.pending)return;
    const remove=[...this.subscribed].filter(s=>!this.desired.has(s)),add=[...this.desired].filter(s=>!this.subscribed.has(s));
    const symbols=remove.length?remove:add;if(!symbols.length)return;
    this.metrics.peakBuffered=Math.max(this.metrics.peakBuffered,socket.bufferedAmount);if(socket.bufferedAmount>65536){this.drop(socket);return;}
    const method=remove.length?'UNSUBSCRIBE':'SUBSCRIBE',id=String(++this.serial);
    this.pending={id,method,symbols,timer:setTimeout(()=>this.drop(socket),4000)};
    socket.send(JSON.stringify({method,params:symbols.map(s=>s.toLowerCase()+'@trade'),id}));this.metrics.controls++;
  }
  message(bytes,binary){
    check(!binary&&bytes.length<=65536,'INVALID_DATA');const second=Math.floor(this.now()/1000);if(second!==this.frameSecond){this.frameSecond=second;this.frameCount=0;}check(++this.frameCount<=2000,'SOURCE_BUSY');
    this.metrics.frames++;this.metrics.bytes+=bytes.length;const row=JSON.parse(bytes.toString());
    if(Object.hasOwn(row,'result')){
      check(this.pending&&row.id===this.pending.id&&row.result===null,'INVALID_DATA');const p=this.pending;this.clearPending();
      for(const s of p.symbols){if(p.method==='SUBSCRIBE')this.subscribed.add(s);else this.subscribed.delete(s);}this.failures=0;this.schedule(500);return;
    }
    const t=row.data;check(t?.e==='trade'&&row.stream===t.s?.toLowerCase()+'@trade'&&SYMBOLS.has(t.s),'INVALID_DATA');
    // In-flight data for a removed subscription cannot restore demand or cash.
    if(!this.desired.has(t.s)||!this.subscribed.has(t.s))return;
    check(Number.isSafeInteger(t.T)&&Number.isSafeInteger(t.E)&&Number.isSafeInteger(t.t)&&t.t>=0&&t.T<=this.now()+2000&&typeof t.p==='string'&&units(t.p)>0n,'INVALID_DATA');
    const previous=this.watermarks.get(t.s);if(previous&&(t.t<=previous.id||t.T<previous.time)){this.metrics.duplicates++;return;}
    const tick=Object.freeze({id:t.t,time:t.T,price:t.p,receivedAt:this.now()});this.watermarks.set(t.s,{id:t.t,time:t.T});this.ticks.set(t.s,tick);this.metrics.accepted++;this.notify();
  }
  valid(symbol,generation=this.generation){return !this.closed&&!this.generationAbort.signal.aborted&&generation===this.generation&&this.socket?.readyState===WebSocket.OPEN&&this.monotonicNow()-this.lastInbound<45000&&this.desired.has(symbol)&&this.ticks.has(symbol);}
  read(symbol){this.sync();const t=this.ticks.get(symbol);check(this.valid(symbol),'QUOTE_UNAVAILABLE');return{...t,generation:this.generation};}
  notify(error){for(const waiter of [...this.waiters])if(error||this.valid(waiter.symbol))waiter.finish(error);}
  waitForTrade(symbol,{signal}={}){
    check(!this.closed&&this.waiters.size<256,'SOURCE_BUSY');if(this.valid(symbol))return Promise.resolve();
    return new Promise((resolve,reject)=>{let done=false;const waiter={symbol,finish:error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.waiters.delete(waiter);error?reject(error):resolve();}},abort=()=>waiter.finish(new SimError('SOURCE_BUSY')),timer=setTimeout(abort,2500);this.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  }
  snapshot(){return{...this.metrics,generation:this.generation,waiters:this.waiters.size,owners:this.owners.size,symbols:this.desired.size,ticks:this.ticks.size,watermarks:this.watermarks.size,connected:this.socket?.readyState===WebSocket.OPEN,pending:!!this.pending};}
  idle(){if(this.timer)clearTimeout(this.timer);this.timer=null;if(this.sweep)clearInterval(this.sweep);this.sweep=null;this.clearPending();const socket=this.socket;this.socket=null;if(socket)this.generation++;this.generationAbort.abort();this.ticks.clear();this.subscribed.clear();this.notify(new SimError('QUOTE_UNAVAILABLE'));socket?.terminate();}
  close(){this.closed=true;this.owners.clear();this.desired.clear();this.idle();}
}
