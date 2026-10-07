import { limits } from './core.mjs';
import { setTimeout as delay } from 'node:timers/promises';

// The one scheduler owns this gateway. No UI/API route can reach it.
export class ProviderGateway {
  busy=false;lastStart=0;failures=0;pausedUntil=0; controller=new AbortController();
  constructor({fetchImpl=fetch,gapMs=limits.MIN_UPSTREAM_REQUEST_GAP_MS}={}){this.fetch=fetchImpl;this.gap=Math.max(2000,gapMs);}
  async request(url,{headers={}}={}){
    if(this.busy||Date.now()<this.pausedUntil)throw Error('Provider paused');
    this.busy=true;
    try {
      for(let attempt=0;attempt<3;attempt++){
        await delay(Math.max(0,this.lastStart+this.gap-Date.now()),undefined,{signal:this.controller.signal});
        this.lastStart=Date.now();const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(10000)]);
        let retryMs=2000;
        try{
          const response=await this.fetch(url,{headers,signal,redirect:'error'});
          if(!response.ok){const ra=response.headers.get('retry-after');retryMs=ra?(Number.isFinite(Number(ra))?Number(ra)*1000:Date.parse(ra)-Date.now()):2000;
            await response.body?.cancel();if(response.status!==429&&response.status<500)throw Object.assign(Error('Provider rejected request'),{terminal:true});throw Error('Provider temporarily unavailable');}
          const reader=response.body.getReader();let size=0;const chunks=[];
          try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limits.PROVIDER_RESPONSE_MAX_MIB*1048576)throw Object.assign(Error('Provider response limit'),{terminal:true});chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          // fetch decodes compressed responses. Limit above is on decompressed bytes.
          const result=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));this.failures=0;return result;
        }catch(e){this.failures++;if(e.terminal||signal.aborted||attempt===2||retryMs>60000){this.pausedUntil=Date.now()+Math.max(60000,Number.isFinite(retryMs)?retryMs:60000);throw e;}await delay(Math.max(2000,Number.isFinite(retryMs)?retryMs:60000),undefined,{signal:this.controller.signal});}
      }
    }finally{this.busy=false;}
  }
  close(){this.controller.abort();}
}

export class TwelveDataAdapter {
  constructor(gateway,apiKey){this.gateway=gateway;this.apiKey=apiKey;}
  async page(instrument,start,end){
    if(instrument.dataRightsStatus!=='confirmed'||!instrument.enabled||!this.apiKey)throw Error('Provider entitlement not configured');
    const u=new URL('https://api.twelvedata.com/time_series');
    const iso=ms=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
    for(const [k,v] of Object.entries({symbol:instrument.providerSymbol,mic_code:instrument.exchange,interval:'15min',timezone:'UTC',order:'asc',outputsize:'500',start_date:iso(start),end_date:iso(end),adjust:'none',apikey:this.apiKey}))u.searchParams.set(k,v);
    const data=await this.gateway.request(u);
    if(data.status==='error'||!Array.isArray(data.values)||data.values.length>500||data.meta?.currency!==instrument.currency||data.meta?.symbol!==instrument.providerSymbol||data.meta?.mic_code!==instrument.exchange)throw Error('Provider metadata mismatch');
    const fetchedAt=Date.now();return data.values.map(v=>{const openTimeUtc=Date.parse(v.datetime.replace(' ','T')+'Z');return {instrumentId:instrument.instrumentId,interval:'15m',openTimeUtc,closeTimeUtc:openTimeUtc+900000,open:v.open,high:v.high,low:v.low,close:v.close,volume:v.volume??null,currency:instrument.currency,provider:instrument.provider,providerTimestamp:openTimeUtc,fetchedAt,adjustmentMode:'unadjusted'};}).filter(v=>v.closeTimeUtc<=fetchedAt);
  }
}

// Explicit exchange session intervals supplied by a verified, versioned calendar.
// No weekday-only approximation. Missing calendar means no collection.
export function closedSessionEnd(instrument,sessions,now,publicationDelayMs){
  if(!Array.isArray(sessions)||!Number.isFinite(publicationDelayMs)||publicationDelayMs<0)return null;
  let end=null;for(const s of sessions){if(s.instrumentId!==instrument.instrumentId||!Number.isSafeInteger(s.open)||!Number.isSafeInteger(s.close)||s.close<=s.open)continue;
    const cutoff=Math.min(now-publicationDelayMs,s.close);const closed=s.open+Math.floor((cutoff-s.open)/900000)*900000;if(closed>s.open)end=Math.max(end??0,closed);}
  return end;
}
