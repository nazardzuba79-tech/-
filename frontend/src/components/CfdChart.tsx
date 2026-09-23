import { readDisplayJson, displayRefreshDelay, SLOW_DISPLAY_REFRESH_MS } from '../lib/displaySnapshotCache';
import { SampledDataNote } from './SampledDataNote';
import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import '../pages/trade-terminal/CfdPractice.css';

type Interval='5m'|'15m'|'1h'|'4h'|'1d';
const INTERVALS:Interval[]=['5m','15m','1h','4h','1d'];
const API_BASE=(import.meta.env.VITE_API_URL||'/api/v1').replace(/\/$/,'');
const MARKET_EDGE_BASE='https://market.voltextech.net';
const production=()=>typeof window!=='undefined'&&(window.location.hostname==='voltextech.net'||window.location.hostname.endsWith('.voltextech.net'));
const PROVIDER_SYMBOL:Record<string,string>={WTIUSD:'USOIL',XBRUSD:'UKOIL'};

type RawBar={openTime:number|string;open:number|string;high:number|string;low:number|string;close:number|string;volume?:number|string|null;tickVolume?:number|string|null;isOpen?:boolean};
type RawEnvelope={symbol?:string;providerSymbol?:string;interval?:string;fetchedAt?:number;bars?:RawBar[]};
type ChartBar={openTime:number;open:number;high:number;low:number;close:number;volume:number;isOpen:boolean};

function positive(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function nonNegative(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;}
function normalizeBars(body:RawEnvelope,symbol:string,interval:Interval):ChartBar[]{
  const provider=PROVIDER_SYMBOL[symbol]??symbol;
  if(body.interval!==interval||!body.symbol||![symbol,provider].includes(body.symbol))throw new Error('cfd_chart_identity');
  if(!Array.isArray(body.bars))throw new Error('cfd_chart_shape');
  const seen=new Set<number>(),rows:ChartBar[]=[];
  for(const raw of body.bars){
    const openTime=typeof raw.openTime==='number'?raw.openTime:Date.parse(raw.openTime);
    const open=positive(raw.open),high=positive(raw.high),low=positive(raw.low),close=positive(raw.close);
    if(!Number.isFinite(openTime)||openTime<=0||open===null||high===null||low===null||close===null||seen.has(openTime))continue;
    if(high<Math.max(open,close,low)||low>Math.min(open,close,high))continue;
    seen.add(openTime);rows.push({openTime,open,high,low,close,volume:nonNegative(raw.volume??raw.tickVolume),isOpen:raw.isOpen===true});
  }
  rows.sort((a,b)=>a.openTime-b.openTime);
  if(rows.length<2)throw new Error('cfd_chart_empty');
  return rows;
}

async function loadCandles(symbol:string,interval:Interval,signal:AbortSignal):Promise<{rows:ChartBar[];asOf:number|null}>{
  const url=`${production()?MARKET_EDGE_BASE:API_BASE}/cfd/display/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=320`;
  const body=await readDisplayJson<RawEnvelope>(url,SLOW_DISPLAY_REFRESH_MS,signal);
  return {rows:normalizeBars(body,symbol,interval),asOf:typeof body.fetchedAt==='number'?body.fetchedAt:null};
}

/** Real OHLC candles only. No synthetic chart data and no explanatory labels in the customer UI. */
export function CfdChart({symbol}:{symbol:string}){
  const hostRef=useRef<HTMLDivElement>(null),chartRef=useRef<IChartApi|null>(null),seriesRef=useRef<ISeriesApi<'Candlestick'>|null>(null),volumeRef=useRef<ISeriesApi<'Histogram'>|null>(null);
  const[interval,setInterval]=useState<Interval>('1h'),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);
  const [asOf,setAsOf]=useState<number|null>(null);
  const renderedKey=useRef('');

  useEffect(()=>{
    const host=hostRef.current;if(!host)return;
    const chart=createChart(host,{autoSize:true,layout:{background:{type:ColorType.Solid,color:getComputedStyle(host).getPropertyValue('--voltex-plot-background').trim()||'#101014'},textColor:'#aeb9c4',fontFamily:'Inter, Arial, sans-serif',fontSize:11},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{borderColor:'#2b2e36'},timeScale:{borderColor:'#2b2e36',timeVisible:true,secondsVisible:false},crosshair:{mode:0}});
    const candles=chart.addSeries(CandlestickSeries,{upColor:'#12c98d',downColor:'#ef5350',borderVisible:false,wickUpColor:'#12c98d',wickDownColor:'#ef5350',priceLineVisible:true,priceLineColor:'#d9b95b'});
    const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',base:0});
    volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0},visible:false});
    chart.priceScale('right').applyOptions({scaleMargins:{top:.08,bottom:.2}});
    chartRef.current=chart;seriesRef.current=candles;volumeRef.current=volume;
    const observer=new ResizeObserver(()=>chart.applyOptions({width:host.clientWidth,height:host.clientHeight}));observer.observe(host);
    return()=>{observer.disconnect();chartRef.current=null;seriesRef.current=null;volumeRef.current=null;chart.remove();};
  },[]);

  useEffect(()=>{
    let cancelled=false,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|null=null;
    const key=`${symbol}:${interval}`;
    if(renderedKey.current!==key){seriesRef.current?.setData([]);volumeRef.current?.setData([]);setAsOf(null);setStatus('loading');}
    const schedule=(delay:number)=>{if(timer)clearTimeout(timer);timer=null;if(!cancelled&&!document.hidden)timer=setTimeout(()=>void load(),delay);};
    async function load(){
      if(cancelled||controller||document.hidden)return;
      const request=new AbortController();controller=request;let delay=SLOW_DISPLAY_REFRESH_MS;
      try{
        const snapshot=await loadCandles(symbol,interval,request.signal);
        if(cancelled||request.signal.aborted)return;
        delay=displayRefreshDelay(`${production()?MARKET_EDGE_BASE:API_BASE}/cfd/display/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=320`,SLOW_DISPLAY_REFRESH_MS);
        const rows=snapshot.rows;
        seriesRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));
        volumeRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,value:bar.volume,color:bar.close>=bar.open?'rgba(18,201,141,.28)':'rgba(239,83,80,.28)'})));
        if(renderedKey.current!==key)chartRef.current?.timeScale().fitContent();
        renderedKey.current=key;setAsOf(snapshot.asOf);setStatus('ready');
      }catch{if(!cancelled&&!request.signal.aborted)setStatus('error');delay=60_000;}
      finally{if(controller===request)controller=null;schedule(request.signal.aborted&&!cancelled&&!document.hidden?0:delay);}
    }
    const visible=()=>{if(document.hidden){if(timer)clearTimeout(timer);timer=null;controller?.abort();}else schedule(0);};
    document.addEventListener('visibilitychange',visible);void load();
    return()=>{cancelled=true;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[symbol,interval,retry]);

  return <div className="cfd-chart cfd-owned-chart" data-chart-status={status}>
    <div className="cfd-chart-toolbar"><strong>{symbol}</strong><div className="cfd-chart-intervals" role="group" aria-label="Chart interval">{INTERVALS.map(item=><button key={item} type="button" className={item===interval?'active':undefined} aria-pressed={item===interval} onClick={()=>setInterval(item)}>{item}</button>)}</div></div>
    <SampledDataNote asOf={asOf} cadenceMs={SLOW_DISPLAY_REFRESH_MS}/>
    <div className="cfd-owned-chart-canvas" ref={hostRef}/>
    {status==='loading'&&<div className="cfd-chart-overlay" aria-hidden="true"><span className="cfd-chart-loader"/></div>}
    {status==='error'&&<button className="cfd-chart-retry" type="button" aria-label="Retry chart" onClick={()=>setRetry(value=>value+1)}>↻</button>}
  </div>;
}
