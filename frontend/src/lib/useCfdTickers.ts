import { useEffect,useRef,useState } from 'react';
import { api } from './api';
import { ageCfdTickerRows } from './cfdPresentation';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

const POLL_MS=15_000;
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

export function useCfdTickers(){
  const[tickers,setTickers]=useState<CfdTickerRow[]>([]),[configured,setConfigured]=useState(true),[loadError,setLoadError]=useState(false);
  const inFlight=useRef(false),startedAt=useRef(-Infinity);
  function load(){if(inFlight.current)return;inFlight.current=true;startedAt.current=Date.now();
    api.getCfdTickers().then(res=>{const rows=res&&typeof res==='object'?parseTickerPayload(res.tickers):null;if(rows===null){setLoadError(true);setTickers(old=>old.map(t=>({...t,status:'stale',stale:true})));return;}setLoadError(false);if(typeof res.configured==='boolean')setConfigured(res.configured);setTickers(rows);})
      .catch(()=>{setLoadError(true);setTickers(old=>old.map(t=>({...t,status:'stale',stale:true})));}).finally(()=>{inFlight.current=false;});}
  useEffect(()=>{load();const interval=window.setInterval(()=>{setTickers(old=>ageCfdTickerRows(old));if(Date.now()-startedAt.current>=POLL_MS)load();},1000);return()=>clearInterval(interval);},[]);
  return{tickers,configured,loadError,reload:load};
}
