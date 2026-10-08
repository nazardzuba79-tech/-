import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { cfdDisplayState,cfdMarketCopy,cfdPriceDecimals,formatCfdAsOf,formatCfdPrice } from '../lib/cfdPresentation';
import type { CfdDisplayCopy } from '../lib/cfdDisplayCopy';
import { cfdInfoStripModel, relativeTimeUntil, type CfdMarketStatus, type EconomicEvent } from '../lib/cfdInfoStrip';
import { useCfdDailySession } from '../lib/useCfdDailySession';
import { useCfdEconomicEvent } from '../lib/useCfdEconomicEvent';
import { PriceCell } from './PriceCell';
import type { CfdTickerRow } from './CfdInstrumentList';
import { CfdInstrumentIcon } from './CfdInstrumentIcon';
import '../pages/trade-terminal/CfdInfoStrip.css';

const STATUS_TONE:Record<CfdMarketStatus,'live'|'closed'|'off'>={open:'live',closed:'closed',unknown:'off'};
const fixed=(value:number,digits:number)=>value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const signed=(value:number,digits:number)=>`${value>0?'+':value<0?'-':''}${fixed(Math.abs(value),digits)}`;
const dateLocale=(lang:string)=>lang==='en'?'en-GB':lang;
const sessionDate=(openTime:number|null,lang:string)=>openTime===null?'':new Date(openTime).toLocaleDateString(dateLocale(lang),{day:'2-digit',month:'short',timeZone:'UTC'});

/** The CFD ticker bar doubles as the information strip: identity, price, day change, day range, session status. */
export function CfdTickerBar({symbol,ticker}:{symbol:string;ticker?:CfdTickerRow}){
  const{t,lang}=useLanguage(),copy=cfdMarketCopy(lang);
  const{session}=useCfdDailySession(symbol);
  const event=useCfdEconomicEvent(symbol);
  const info=useMemo(()=>cfdInfoStripModel(symbol,ticker,session),[symbol,ticker,session]);
  const digits=cfdPriceDecimals(symbol),freshness=cfdDisplayState(ticker,lang),asOfText=formatCfdAsOf(info.asOf);
  const sessionText=info.session===null?'':`${sessionDate(info.session,lang)} · ${copy.utcSession}`;
  const freshnessTitle=`${freshness.label}${asOfText?` · ${asOfText}`:''}`;
  const changeTitle=info.previousClose!==null?`${copy.prevClose}: ${formatCfdPrice(info.previousClose,symbol)} (${sessionDate(info.previousSession,lang)}) · ${sessionText}`:undefined;
  const rangeTitle=info.dayRange?`${sessionText}${asOfText?` · ${copy.asOfLabel} ${asOfText}`:''}`:undefined;
  const tone=info.change===null?'':info.change.abs>=0?'text-buy':'text-sell';
  const statusLabel=info.status==='open'?copy.open:info.status==='closed'?copy.closed:copy.sessionUnknown;
  return <header className="cfd-ticker-bar cfd-info-strip">
    <div className="cfd-selected-instrument cfd-pair-cluster">
      <CfdInstrumentIcon symbol={symbol} compact />
      <span className="cfd-instrument-identity"><span className="cfd-symbol mono">{symbol}</span><span className="cfd-instrument-name">{ticker?.name??'—'}</span></span>
    </div>
    <div className="cfd-ticker-metric" title={freshnessTitle}><span>{t('markets.price')}</span>{info.price!==null?<PriceCell key={symbol} className="mono cfd-ticker-price" value={info.price} format={v=>formatCfdPrice(v,symbol)}/>:<span className="mono cfd-ticker-price">—</span>}</div>
    <div className="cfd-ticker-metric cfd-ticker-day-change" title={changeTitle}><span>{copy.dayChange}</span><span className={`mono cfd-ticker-change ${tone}`}>{info.change?`${signed(info.change.abs,digits)} (${signed(info.change.pct,2)}%)`:'—'}</span></div>
    <div className="cfd-ticker-metric cfd-ticker-day-range" title={rangeTitle}><span>{copy.dayRange}</span><span className="mono cfd-ticker-range">{info.dayRange?`${fixed(info.dayRange.low,digits)} – ${fixed(info.dayRange.high,digits)}`:'—'}</span></div>
    {info.weekRange&&<div className="cfd-ticker-metric cfd-ticker-week-range" title={`${copy.closedSessionsOnly} · ${copy.asOfLabel} ${sessionDate(info.weekRange.asOfSession,lang)}`}><span>{copy.range52w}</span><span className="mono cfd-ticker-range">{`${fixed(info.weekRange.low,digits)} – ${fixed(info.weekRange.high,digits)}`}</span></div>}
    <div className="cfd-ticker-metric cfd-market-state" title={freshnessTitle}><span>{copy.status}</span><span className={`cfd-state-pill cfd-state-${STATUS_TONE[info.status]}`}>{statusLabel}</span></div>
    {event&&<CfdEventMetric event={event} copy={copy} lang={lang}/>}
  </header>;
}

/** Shown only when an official schedule source is attached; the countdown is local, one tick a minute. */
function CfdEventMetric({event,copy,lang}:{event:EconomicEvent;copy:CfdDisplayCopy;lang:string}){
  const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(id);},[]);
  const rel=relativeTimeUntil(event.at,now);
  if(!rel)return null;
  const kind={cpi:copy.eventCpi,rate_decision:copy.eventRate,nfp:copy.eventNfp,eia_petroleum:copy.eventEia}[event.kind];
  const when=new Intl.DateTimeFormat(dateLocale(lang),{dateStyle:'medium',timeStyle:'short',timeZoneName:'short'}).format(event.at);
  const relText=rel.days>0?`${rel.days}${copy.unitDay} ${rel.hours}${copy.unitHour}`:rel.hours>0?`${rel.hours}${copy.unitHour} ${rel.minutes}${copy.unitMinute}`:`${rel.minutes}${copy.unitMinute}`;
  return <div className="cfd-ticker-metric cfd-ticker-event" title={`${when} · ${copy.officialSource}: ${event.source.name}`}><span>{copy.nextEvent}</span><a className="cfd-ticker-event-link" href={event.source.url} target="_blank" rel="noreferrer">{`${event.region} ${kind} · ${relText}`}</a></div>;
}
