import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { cfdDisplayState,cfdMarketCopy,cfdPriceDecimals,formatCfdAsOf,formatCfdPrice } from '../lib/cfdPresentation';
import type { CfdDisplayCopy } from '../lib/cfdDisplayCopy';
import { cfdInfoStripModel, cfdNextSessionChange, cfdSessionOpenAt, relativeTimeUntil, type CfdMarketStatus, type EconomicEvent, type RelativeTime } from '../lib/cfdInfoStrip';
import { cfdAssetName } from '../lib/cfdAssetIdentity';
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
const positive=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null;};
const relText=(rel:RelativeTime,copy:CfdDisplayCopy)=>rel.days>0?`${rel.days}${copy.unitDay} ${rel.hours}${copy.unitHour}`:rel.hours>0?`${rel.hours}${copy.unitHour} ${rel.minutes}${copy.unitMinute}`:`${rel.minutes}${copy.unitMinute}`;

/** A clock that ticks once a minute: the countdown and «updated» age, nothing else. */
function useMinuteClock():number{
  const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(id);},[]);
  return now;
}

/**
 * The CFD instrument bar (2026-10-15): identity, then only figures that come
 * from a source — the price, its change against the previous session close,
 * the session's high and low (the instrument's own daily bar), the provider's
 * bid / ask and their difference when it publishes both, the instant of the
 * quote, and the market status with the time to the next open or close by the
 * exchange calendar. No funding, open interest or volume: an OTC CFD quote has
 * none of them, and a missing figure is left out rather than shown as «—».
 */
export function CfdTickerBar({symbol,ticker}:{symbol:string;ticker?:CfdTickerRow}){
  const{t,lang}=useLanguage(),copy=cfdMarketCopy(lang);
  const{session}=useCfdDailySession(symbol);
  const event=useCfdEconomicEvent(symbol);
  const now=useMinuteClock();
  const info=useMemo(()=>cfdInfoStripModel(symbol,ticker,session,now),[symbol,ticker,session,now]);
  const digits=cfdPriceDecimals(symbol),freshness=cfdDisplayState(ticker,lang),asOfText=formatCfdAsOf(info.asOf);
  const sessionText=info.session===null?'':`${sessionDate(info.session,lang)} · ${copy.utcSession}`;
  const freshnessTitle=`${freshness.label}${asOfText?` · ${asOfText}`:''}`;
  const changeTitle=info.previousClose!==null?`${copy.prevClose}: ${formatCfdPrice(info.previousClose,symbol)} (${sessionDate(info.previousSession,lang)}) · ${sessionText}`:undefined;
  const rangeTitle=info.dayRange?`${sessionText}${asOfText?` · ${copy.asOfLabel} ${asOfText}`:''}`:undefined;
  const tone=info.change===null?'':info.change.abs>=0?'text-buy':'text-sell';
  const statusLabel=info.status==='open'?copy.open:info.status==='closed'?copy.closed:copy.sessionUnknown;
  // The provider's bid and ask: shown only as a sane pair, the spread is their difference.
  const bid=positive(ticker?.bid),ask=positive(ticker?.ask);
  const quote=bid!==null&&ask!==null&&ask>=bid?{bid,ask,spread:ask-bid}:null;
  // Time to the next open / close, only where the shown status is the calendar's own (no holiday in the way).
  const calendarOpen=cfdSessionOpenAt(symbol,now);
  const change=info.status!=='unknown'&&calendarOpen===(info.status==='open')?cfdNextSessionChange(symbol,now):null;
  const until=change?relativeTimeUntil(change.at,now):null;
  const changeAt=change?new Intl.DateTimeFormat(dateLocale(lang),{weekday:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC',hourCycle:'h23'}).format(change.at)+' UTC':'';
  const quoteAt=info.asOf===null?null:new Date(info.asOf);
  const quoteAtFull=quoteAt?new Intl.DateTimeFormat(dateLocale(lang),{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(quoteAt)+' UTC':'';
  // Today's quote by its time; an older one (a weekend's last quote) carries its date as well.
  const quoteAtText=!quoteAt?'':quoteAt.toISOString().slice(0,10)===new Date(now).toISOString().slice(0,10)?asOfText
    :`${quoteAt.toLocaleDateString(dateLocale(lang),{day:'2-digit',month:'short',timeZone:'UTC'})} ${asOfText}`;
  return <header className="cfd-ticker-bar cfd-info-strip" data-cfd-stats>
    <div className="cfd-selected-instrument cfd-pair-cluster">
      <CfdInstrumentIcon symbol={symbol} compact />
      <span className="cfd-instrument-identity" title={ticker?.name??undefined}><span className="cfd-symbol mono">{symbol}</span><span className="cfd-instrument-name">{cfdAssetName(symbol,lang,ticker?.name)}</span></span>
    </div>
    <div className="cfd-ticker-metric cfd-ticker-last" title={freshnessTitle} data-cfd-stat="price"><span>{t('markets.price')}</span>{info.price!==null?<PriceCell key={symbol} className={`mono cfd-ticker-price ${tone}`} value={info.price} format={v=>formatCfdPrice(v,symbol)}/>:<span className="mono cfd-ticker-price">—</span>}</div>
    {info.change&&<div className="cfd-ticker-metric cfd-ticker-day-change" title={changeTitle} data-cfd-stat="change"><span>{copy.dayChange}</span><span className={`mono cfd-ticker-change ${tone}`}>{`${signed(info.change.abs,digits)} (${signed(info.change.pct,2)}%)`}</span></div>}
    {info.previousClose!==null&&<div className="cfd-ticker-metric cfd-ticker-prev-close" title={info.previousSession!==null?sessionDate(info.previousSession,lang):undefined} data-cfd-stat="prevclose"><span>{copy.prevClose}</span><span className="mono cfd-ticker-range">{fixed(info.previousClose,digits)}</span></div>}
    {info.dayRange&&<div className="cfd-ticker-metric cfd-ticker-day-high" title={rangeTitle} data-cfd-stat="high"><span>{copy.dayHigh}</span><span className="mono cfd-ticker-range">{fixed(info.dayRange.high,digits)}</span></div>}
    {info.dayRange&&<div className="cfd-ticker-metric cfd-ticker-day-low" title={rangeTitle} data-cfd-stat="low"><span>{copy.dayLow}</span><span className="mono cfd-ticker-range">{fixed(info.dayRange.low,digits)}</span></div>}
    {quote&&<div className="cfd-ticker-metric cfd-ticker-bid-ask" title={asOfText?`${copy.asOfLabel} ${asOfText}`:undefined} data-cfd-stat="bidask"><span>{copy.bidAsk}</span><span className="mono cfd-ticker-range"><span className="text-buy">{fixed(quote.bid,digits)}</span> / <span className="text-sell">{fixed(quote.ask,digits)}</span></span></div>}
    {quote&&<div className="cfd-ticker-metric cfd-ticker-spread" title={asOfText?`${copy.asOfLabel} ${asOfText}`:undefined} data-cfd-stat="spread"><span>{copy.spread}</span><span className="mono cfd-ticker-range">{fixed(quote.spread,digits)}</span></div>}
    {info.weekRange&&<div className="cfd-ticker-metric cfd-ticker-week-range" title={`${copy.closedSessionsOnly} · ${copy.asOfLabel} ${sessionDate(info.weekRange.asOfSession,lang)}`}><span>{copy.range52w}</span><span className="mono cfd-ticker-range">{`${fixed(info.weekRange.low,digits)} – ${fixed(info.weekRange.high,digits)}`}</span></div>}
    {event&&<CfdEventMetric event={event} copy={copy} lang={lang}/>}
    {quoteAt&&<div className="cfd-ticker-metric cfd-ticker-updated" title={`${freshness.label} · ${quoteAtFull}`} data-cfd-stat="updated"><span>{copy.quoteTime}</span><span className="mono cfd-ticker-range">{quoteAtText}</span></div>}
    <div className="cfd-ticker-metric cfd-market-state" title={change?`${change.opens?copy.opensIn:copy.closesIn} ${changeAt}`:freshnessTitle} data-cfd-stat="status" data-cfd-status={info.status}>
      <span>{copy.status}</span>
      <span className="cfd-state-line"><span className={`cfd-state-pill cfd-state-${STATUS_TONE[info.status]}`}>{statusLabel}</span>{until&&<span className="cfd-session-countdown">{`${change!.opens?copy.opensIn:copy.closesIn} ${relText(until,copy)}`}</span>}</span>
    </div>
  </header>;
}

/** Shown only when an official schedule source is attached; the countdown is local, one tick a minute. */
function CfdEventMetric({event,copy,lang}:{event:EconomicEvent;copy:CfdDisplayCopy;lang:string}){
  const now=useMinuteClock();
  const rel=relativeTimeUntil(event.at,now);
  if(!rel)return null;
  const kind={cpi:copy.eventCpi,rate_decision:copy.eventRate,nfp:copy.eventNfp,eia_petroleum:copy.eventEia}[event.kind];
  const when=new Intl.DateTimeFormat(dateLocale(lang),{dateStyle:'medium',timeStyle:'short',timeZoneName:'short'}).format(event.at);
  return <div className="cfd-ticker-metric cfd-ticker-event" title={`${when} · ${copy.officialSource}: ${event.source.name}`}><span>{copy.nextEvent}</span><a className="cfd-ticker-event-link" href={event.source.url} target="_blank" rel="noreferrer">{`${event.region} ${kind} · ${relText(rel,copy)}`}</a></div>;
}
