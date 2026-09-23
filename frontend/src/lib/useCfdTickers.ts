import { useEffect,useRef,useState } from 'react';
import { api } from './api';
import { ageCfdTickerRows } from './cfdPresentation';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

const POLL_MS=6 * 60 * 60 * 1000;
function numericString(value:unknown):string|null{if(typeof value==='number')return Number.isFinite(value)?String(value):null;if(typeof value!=='string')return null;return value.trim()!==''&&Number.isFinite(Number(value))?value:null;}

function parseTickerPayload(value:unknown):CfdTickerRow[]|null{
  if(!Array.isArray(value))return null;const rows:CfdTickerRow[]=[];
  for(const entry of value){if(!entry||typeof entry!=='object')continue;const raw=entry as Record<string,unknown>;const symbol=typeof raw.symbol==='string'?raw.symbol.trim():'';if(!symbol)continue;
    const price=numericString(raw.price);if(price===null&&raw.price!==null)continue;const change=numericString(raw.changePercent24h);
    rows.push({symbol,name:typeof raw.name==='string'&&raw.name.trim()?raw.name:symbol,price,status:typeof raw.status==='string'?raw.status:'unavailable',
      stale:raw.stale===true,marketClosed:raw.marketClosed===true,displayOnly:true,executionAllowed:false,
      provider:typeof raw.provider==='string'?raw.provider:undefined,providerSymbol:typeof raw.providerSymbol==='string'?raw.providerSymbol:undefined,
      providerTimestamp:typeof raw.providerTimestamp==='number'?raw.providerTimestamp:null,fetchedAt:typeof raw.fetchedAt==='number'?raw.fetchedAt:null,
      asOf:typeof raw.asOf==='number'?raw.asOf:null,maxQuoteAgeMs:typeof raw.maxQuoteAgeMs==='number'?raw.maxQuoteAgeMs:undefined,
      ...(change===null?{}:{changePercent24h:change})});
  }
  return value.length>0&&rows.length===0?null:ageCfdTickerRows(rows);
}

export function useCfdTickers(enabled = true){
  const[tickers,setTickers]=useState<CfdTickerRow[]>([]),[configured,setConfigured]=useState(true),[loadError,setLoadError]=useState(false);
  const reloadRef=useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(!enabled){reloadRef.current=()=>{};return;}
    let cancelled=false,inFlight=false;let lastAttempt=-Infinity;
    let timer:ReturnType<typeof setTimeout>|null=null;
    const schedule=(ms:number)=>{if(timer)clearTimeout(timer);timer=null;if(!cancelled&&!document.hidden)timer=setTimeout(()=>void load(),ms);};
    async function load(){
      if(cancelled||document.hidden||inFlight)return;
      inFlight=true;lastAttempt=Date.now();let delay=POLL_MS;
      try{
        const res=await api.getCfdTickers();
        if(cancelled)return;
        const rows=res&&typeof res==='object'?parseTickerPayload(res.tickers):null;
        if(rows===null)throw new Error('Invalid CFD snapshot');
        setLoadError(false);if(typeof res.configured==='boolean')setConfigured(res.configured);
        setTickers(rows.map(row=>({...row,status:row.price===null?'unavailable':row.marketClosed?'market_closed':'sampled',displayOnly:true,executionAllowed:false})));
      }catch{if(!cancelled){setLoadError(true);setTickers(old=>old.map(row=>({...row,status:'stale',stale:true})));}delay=60_000;}
      finally{inFlight=false;schedule(delay);}
    }
    const visible=()=>{if(document.hidden){if(timer)clearTimeout(timer);timer=null;}else if(Date.now()-lastAttempt>=POLL_MS)void load();else schedule(POLL_MS-(Date.now()-lastAttempt));};
    reloadRef.current=()=>void load();
    document.addEventListener('visibilitychange',visible);void load();
    return()=>{cancelled=true;if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);reloadRef.current=()=>{};};
  },[enabled]);
  return{tickers,configured,loadError,reload:()=>reloadRef.current()};
}
