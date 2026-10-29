'use strict';
// #613 R10: isolated, public-only push viewer driver for 50+2 diagnostic.
// No real market or user credentials. A held stream replaces repeated viewer state polling.
const assert=require('node:assert/strict');
const {loopback}=require('./policy.cjs');
const percentile=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.ceil(p*s.length)-1)]:null;};
async function openPushViewers(info,{fetchImpl=fetch,now=Date.now,timeoutMs=10000,signal}={}){
  const root=loopback(info.stocksOrigin);
  assert.equal(root.pathname,'/','PUSH_ORIGIN_PATH');
  assert.equal(root.search,'','PUSH_ORIGIN_QUERY');
  assert.equal(info.viewerTokens?.length,50,'PUSH_REQUIRES_50_VIEWERS');
  assert.ok(Array.isArray(info.instruments)&&info.instruments.length>0,'PUSH_INSTRUMENTS_REQUIRED');
  const clients=[],errors=[],ages=[],delays=[],counts={quotes:0,waits:0,unavailable:0,revoked:0,discarded:0,opened:0};
  let closed=false;
  const monitor=(message)=>{if(!closed&&errors.length<15)errors.push(String(message).slice(0,130));};
  const starters=info.viewerTokens.map((token,index)=>{
    const id=info.instruments[index%info.instruments.length];
    const controller=new AbortController();
    let firstResolve,firstReject,firstSeen=false,lastSeq=0;
    const first=new Promise((resolve,reject)=>{firstResolve=resolve;firstReject=reject;});
    const client={controller,index,id,first,done:null,lastQuoteAt:null};
    clients.push(client);
    const run=async()=>{
      const headers={Authorization:'Bearer '+token};
      // Never place a bearer, cookies, or financial data into a query string.
      const response=await fetchImpl(info.stocksOrigin+'/__stocks_global/stream?id='+encodeURIComponent(id),
        {headers,credentials:'omit',cache:'no-store',signal:controller.signal});
      if(response.status!==200||!response.body||!(response.headers.get('content-type')||'').startsWith('text/event-stream'))
        throw Error('PUSH_HTTP_'+response.status);
      counts.opened++;
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let buffer='';
      try{
        for(;;){
          const {value,done}=await reader.read();
          if(done)break;
          buffer+=decoder.decode(value,{stream:true});
          if(buffer.length>256*1024)throw Error('PUSH_EVENT_BUFFER_LIMIT');
          let end;
          while((end=buffer.indexOf('\n\n'))>=0){
            const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
            if(block.startsWith(':'))continue;
            const type=/^event: (\S+)$/m.exec(block)?.[1],raw=/^data: (.+)$/m.exec(block)?.[1];
            if(!type||!raw)continue;
            let payload;
            try{payload=JSON.parse(raw);}catch{throw Error('PUSH_MALFORMED_JSON');}
            if(type==='revoked'){counts.revoked++;throw Error('PUSH_SESSION_REVOKED');}
            if(!Number.isSafeInteger(payload.seq)||payload.seq<=lastSeq) {counts.discarded++;continue;}
            lastSeq=payload.seq;
            if(type==='wait'){counts.waits++;continue;}
            if(type==='unavailable'){counts.unavailable++;continue;}
            if(type!=='quote')throw Error('PUSH_UNKNOWN_EVENT');
            if(payload.instrumentId!==id||payload.quote?.instrumentId!==id||!Number.isFinite(payload.quote?.timestamp)||!Number.isFinite(payload.serverTime))
              throw Error('PUSH_QUOTE_IDENTITY_INVALID');
            for(const forbidden of ['account','wallet','wallets','positions','orders','fills','token','nativeCandles'])
              if(Object.prototype.hasOwnProperty.call(payload.quote,forbidden))throw Error('PUSH_PRIVATE_FIELD');
            counts.quotes++;client.lastQuoteAt=now();
            const age=client.lastQuoteAt-payload.quote.timestamp,delay=client.lastQuoteAt-payload.serverTime;
            if(Number.isFinite(age))ages.push(age);
            if(Number.isFinite(delay))delays.push(delay);
            if(!firstSeen){firstSeen=true;firstResolve();}
          }
        }
      }finally{reader.releaseLock();}
      if(!closed)throw Error('PUSH_STREAM_ENDED');
    };
    client.done=run().catch(error=>{
      if(!closed&&!controller.signal.aborted){monitor(error.message||error);if(!firstSeen)firstReject(error);}
    });
    return first;
  });
  const timer=new AbortController();
  let timeoutHandle;
  let abortListener;
  const stop=()=>{
    if(closed)return;
    closed=true;
    for(const c of clients)c.controller.abort();
    if(abortListener)signal?.removeEventListener('abort',abortListener);
  };
  try {
    if(signal){if(signal.aborted)throw Error('PUSH_ABORTED');abortListener=()=>stop();signal.addEventListener('abort',abortListener,{once:true});}
    await Promise.race([
      Promise.all(starters),
      new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>reject(Error('PUSH_FIRST_QUOTE_TIMEOUT')),timeoutMs);})
    ]);
    if(errors.length)throw Error('PUSH_STARTUP_ERROR');
  }catch(error){stop();await Promise.allSettled(clients.map(c=>c.done));throw error;}
  finally{if(timeoutHandle)clearTimeout(timeoutHandle);timer.abort();}
  return {
    counts,
    snapshot:()=>{
      const stale=clients.filter(c=>c.lastQuoteAt===null||now()-c.lastQuoteAt>5000).length;
      return {kind:'PUSH_DIAGNOSTIC',viewers:clients.length,opened:counts.opened,quotes:counts.quotes,waits:counts.waits,unavailable:counts.unavailable,
        revoked:counts.revoked,discarded:counts.discarded,staleViewers:stale,quoteAgeP95Ms:percentile(ages,.95),
        deliveryDelayP95Ms:percentile(delays,.95),errors:[...errors]};
    },
    close:async()=>{stop();await Promise.allSettled(clients.map(c=>c.done));}
  };
}
module.exports={openPushViewers};
