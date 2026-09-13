import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { cfdMarketCopy } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';
import '../pages/trade-terminal/CfdPractice.css';

type Interval='5m'|'15m'|'1h'|'4h'|'1d';
const INTERVALS:Interval[]=['5m','15m','1h','4h','1d'];
const API_BASE=(import.meta.env.VITE_API_URL||'/api/v1').replace(/\/$/,'');
interface CandleBar{openTime:number;open:number;high:number;low:number;close:number;volume:number|null;tickVolume:number|null;isOpen:boolean;}
interface CandleResponse{symbol:string;providerSymbol:string;interval:Interval;fetchedAt:number;bars:CandleBar[];source:'biquote';}

/**
 * VOLTEX-owned CFD chart. It uses the same public display-data boundary as
 * the price list, via our own /cfd/candles endpoint, so the terminal does not
 * disappear when a third-party embed/CDN is blocked. No synthetic candles.
 */
export function CfdChart({symbol}:{symbol:string}){
  const{lang}=useLanguage(),copy=cfdMarketCopy(lang);
  const hostRef=useRef<HTMLDivElement>(null),chartRef=useRef<IChartApi|null>(null),seriesRef=useRef<ISeriesApi<'Candlestick'>|null>(null),volumeRef=useRef<ISeriesApi<'Histogram'>|null>(null);
  const[interval,setInterval]=useState<Interval>('15m'),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0),[asOf,setAsOf]=useState<number|null>(null);

  useEffect(()=>{
    const host=hostRef.current;if(!host)return;
    const chart=createChart(host,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#0b1118'},textColor:'#aeb9c4',fontFamily:'var(--font-ui)',fontSize:11},grid:{vertLines:{color:'rgba(137,151,165,.04)'},horzLines:{color:'rgba(137,151,165,.06)'}},rightPriceScale:{borderColor:'#263440'},timeScale:{borderColor:'#263440',timeVisible:true,secondsVisible:false},crosshair:{mode:0}});
    const candles=chart.addSeries(CandlestickSeries,{upColor:'#12c98d',downColor:'#ef5350',borderVisible:false,wickUpColor:'#12c98d',wickDownColor:'#ef5350',priceLineVisible:true,priceLineColor:'#d9b95b'});
    const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',base:0});
    volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0},visible:false});
    chart.priceScale('right').applyOptions({scaleMargins:{top:.08,bottom:.2}});
    chartRef.current=chart;seriesRef.current=candles;volumeRef.current=volume;
    const observer=new ResizeObserver(()=>chart.applyOptions({width:host.clientWidth,height:host.clientHeight}));observer.observe(host);
    return()=>{observer.disconnect();chartRef.current=null;seriesRef.current=null;volumeRef.current=null;chart.remove();};
  },[]);

  useEffect(()=>{
    let cancelled=false;const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),8_000);setStatus('loading');
    fetch(`${API_BASE}/cfd/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=260`,{headers:{Accept:'application/json'},signal:controller.signal,cache:'no-store'})
      .then(async response=>{if(!response.ok)throw new Error('cfd_chart_unavailable');return response.json() as Promise<CandleResponse>;})
      .then(body=>{
        if(cancelled||body.symbol!==symbol||body.interval!==interval||!Array.isArray(body.bars)||body.bars.length<2)throw new Error('cfd_chart_invalid');
        const rows=body.bars.filter(bar=>Number.isFinite(bar.openTime)&&[bar.open,bar.high,bar.low,bar.close].every(value=>Number.isFinite(value)&&value>0));
        if(rows.length<2)throw new Error('cfd_chart_empty');
        seriesRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));
        volumeRef.current?.setData(rows.map(bar=>({time:Math.floor(bar.openTime/1000) as Time,value:bar.volume??bar.tickVolume??0,color:bar.close>=bar.open?'rgba(18,201,141,.28)':'rgba(239,83,80,.28)'})));
        chartRef.current?.timeScale().fitContent();setAsOf(body.fetchedAt);setStatus('ready');
      })
      .catch(()=>{if(!cancelled){seriesRef.current?.setData([]);volumeRef.current?.setData([]);setAsOf(null);setStatus('error');}})
      .finally(()=>window.clearTimeout(timer));
    return()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};
  },[symbol,interval,retry]);

  return <div className="cfd-chart cfd-owned-chart">
    <div className="cfd-chart-toolbar"><div><strong>{symbol}</strong><span>{status==='ready'&&asOf?new Date(asOf).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div><div className="cfd-chart-intervals" role="group" aria-label="Chart interval">{INTERVALS.map(item=><button key={item} type="button" className={item===interval?'active':undefined} aria-pressed={item===interval} onClick={()=>setInterval(item)}>{item}</button>)}</div></div>
    <div className="cfd-owned-chart-canvas" ref={hostRef}/>
    {status==='loading'&&<div className="cfd-chart-overlay" role="status"><span className="cfd-chart-loader"/></div>}
    {status==='error'&&<div className="cfd-chart-overlay cfd-chart-error" role="status"><strong>{copy.priceUnavailable}</strong><button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}
    <p className="cfd-disclaimer">{copy.chartNote}</p>
  </div>;
}
