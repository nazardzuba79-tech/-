import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { History, LayoutList } from 'lucide-react';
import { cfdMarketCopy, cfdQuoteCurrency, formatCfdPrice } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';
import { useCfdTickers } from '../lib/useCfdTickers';
import { closeCfdPaperPosition, getCfdPaperState, subscribeCfdPaperStore, type CfdPaperPosition } from '../lib/cfdPaperStore';
import type { CfdTickerRow } from './CfdInstrumentList';
import { CfdInstrumentIcon } from './CfdInstrumentIcon';

type Tab='open'|'history';
const PARTS=[25,50,75] as const;

/** A quantity a person typed: digits with one optional decimal separator, nothing else. */
const parseQuantity=(raw:string):number|null=>{const text=raw.trim().replace(',','.');if(!/^\d+(?:\.\d+)?$/.test(text))return null;const n=Number(text);return Number.isFinite(n)&&n>0?n:null;};
const share=(size:string,percent:number)=>String(Number((Number(size)*percent/100).toFixed(8)));

/**
 * CFD practice positions (2026-10-15): instrument, side, size, entry, current
 * price, P&L with ROE, margin, the order-time liquidation estimate, opening
 * time and the actions — close all, or close a part at the current quote
 * (lib/cfdPaperStore closeCfdPaperPosition). Amounts are in the instrument's
 * quote currency, as the practice books them. No TP/SL column: the practice
 * has no protective orders.
 */
export function CfdPositionsPanel({refreshKey,tickers}:{refreshKey:number;tickers?:CfdTickerRow[]}){
  const{lang,t}=useLanguage(),copy=cfdMarketCopy(lang);
  // The page passes its own ticker rows; only a standalone panel reads the feed itself.
  const feed=useCfdTickers(!tickers);
  const rows=tickers??feed.tickers;
  const[tab,setTab]=useState<Tab>('open');
  const[state,setState]=useState(()=>getCfdPaperState());
  const[error,setError]=useState<string|null>(null);
  const[closingId,setClosingId]=useState<string|null>(null);
  const[partialId,setPartialId]=useState<string|null>(null);
  const[partialQty,setPartialQty]=useState('');

  const reload=()=>setState(getCfdPaperState());
  useEffect(()=>{reload();},[refreshKey]);
  useEffect(()=>subscribeCfdPaperStore(reload),[]);

  const priceBySymbol=useMemo(()=>new Map(rows.flatMap(row=>{
    const price=row.price!==null&&Number.isFinite(Number(row.price))&&Number(row.price)>0?Number(row.price):null;
    return price===null?[]:[[row.symbol,price] as const];
  })),[rows]);
  const when=(at:number)=>new Date(at).toLocaleString(lang==='en'?'en-GB':lang,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});

  function close(position:CfdPaperPosition,quantity?:number){
    const price=priceBySymbol.get(position.symbol);if(!price){setError(copy.priceUnavailable);return;}
    setClosingId(position.id);setError(null);
    try{closeCfdPaperPosition(position.id,price,quantity);reload();setPartialId(null);setPartialQty('');}
    catch(failure){setError((failure as Error)?.message==='price_unavailable'?copy.priceUnavailable:copy.closeQuantityInvalid);}
    finally{setClosingId(null);}
  }
  function submitPartial(event:FormEvent,position:CfdPaperPosition){
    event.preventDefault();
    const quantity=parseQuantity(partialQty);
    if(quantity===null||quantity>=Number(position.size)){setError(copy.closeQuantityInvalid);return;}
    close(position,quantity);
  }

  const openCount=state.open.length,historyCount=state.history.length;
  return <div className="cfd-wrap" data-cfd-positions={openCount}>
    <div className="cfd-tabs" role="tablist" aria-label={t('futures.positions')}>
      <button onClick={()=>setTab('open')} className={`cfd-tab${tab==='open'?' active':''}`} role="tab" aria-selected={tab==='open'}>{t('futures.positions')} <span className="cfd-tab-count">{openCount}</span></button>
      <button onClick={()=>setTab('history')} className={`cfd-tab${tab==='history'?' active':''}`} role="tab" aria-selected={tab==='history'}>{t('futures.positionHistory')} <span className="cfd-tab-count">{historyCount}</span></button>
    </div>
    {error&&<div className="cfd-error" role="alert">{error}</div>}
    <div className="cfd-position-content" role="tabpanel">
      {tab==='open'?(openCount===0?<div className="cfd-empty" role="status"><span className="spot-orders-empty-icon" aria-hidden="true"><LayoutList size={17} strokeWidth={1.5} /></span><strong>{t('futures.noPositions')}</strong></div>:
        <div className="cfd-tableWrap"><table className="cfd-table"><thead><tr>
          <Th>{t('trade.cfdInstrument')}</Th><Th>{t('futures.side')}</Th><Th right>{t('futures.size')}</Th><Th right>{t('futures.entryPrice')}</Th><Th right>{t('futures.markPrice')}</Th><Th right>{t('futures.unrealizedPnl')}</Th><Th right>{t('futures.margin')}</Th><Th right>{copy.liqEstimate}</Th><Th>{copy.openedAt}</Th><Th right>{copy.actions}</Th>
        </tr></thead><tbody>{state.open.map(p=>{
          const mark=priceBySymbol.get(p.symbol)??null,entry=Number(p.entryPrice),size=Number(p.size),margin=Number(p.initialMargin),currency=cfdQuoteCurrency(p.symbol);
          const pnl=mark===null?null:(p.side==='LONG'?mark-entry:entry-mark)*size;
          const roe=pnl===null||!Number.isFinite(margin)||margin<=0?null:pnl/margin*100;
          const positive=(pnl??0)>=0,busy=closingId===p.id,partial=partialId===p.id;
          return [<tr key={p.id} data-cfd-position={p.id}>
            <Td><span className="cfd-cell-instrument"><CfdInstrumentIcon symbol={p.symbol} compact/><strong>{p.symbol}</strong> <span className="cfd-muted">{p.leverage}x</span></span></Td>
            <Td><span className={p.side==='LONG'?'text-buy':'text-sell'}>{p.side==='LONG'?t('futures.long'):t('futures.short')}</span></Td>
            <Td className="mono" right>{p.size}</Td><Td className="mono" right>{formatCfdPrice(entry,p.symbol)}</Td><Td className="mono" right>{mark===null?'—':formatCfdPrice(mark,p.symbol)}</Td>
            <Td className={`mono ${pnl===null?'':positive?'text-buy':'text-sell'}`} right><span className="cfd-pnl">{pnl===null?'—':`${pnl>=0?'+':''}${pnl.toFixed(2)} ${currency}`}{roe!==null&&<small>{`${roe>=0?'+':''}${roe.toFixed(2)}%`}</small>}</span></Td>
            <Td className="mono" right>{`${margin.toFixed(2)} ${currency}`}</Td>
            <Td className="mono cfd-muted" right>{p.liquidationPrice?formatCfdPrice(p.liquidationPrice,p.symbol):'—'}</Td>
            <Td className="mono cfd-muted">{when(p.openedAt)}</Td>
            <Td right><span className="cfd-row-actions">
              <button type="button" className="cfd-closeBtn" disabled={busy||mark===null} onClick={()=>close(p)}>{busy?t('futures.closing'):t('futures.close')}</button>
              <button type="button" className="cfd-closeBtn cfd-partialBtn" aria-expanded={partial} disabled={busy||mark===null} onClick={()=>{setPartialId(partial?null:p.id);setPartialQty(share(p.size,50));setError(null);}}>{copy.closePart}</button>
            </span></Td>
          </tr>,partial&&<tr key={`${p.id}-partial`} className="cfd-partial-row"><td colSpan={10}>
            <form className="cfd-partial-form" onSubmit={event=>submitPartial(event,p)} aria-label={copy.closePartTitle}>
              <label><span>{copy.closeQuantity}</span><input className="mono cfd-input" inputMode="decimal" value={partialQty} onChange={event=>setPartialQty(event.target.value)} aria-describedby={`${p.id}-of`} /></label>
              <span id={`${p.id}-of`} className="cfd-muted mono">/ {p.size}</span>
              <span className="cfd-partial-chips">{PARTS.map(percent=><button key={percent} type="button" onClick={()=>setPartialQty(share(p.size,percent))}>{percent}%</button>)}</span>
              <span className="cfd-muted">{mark===null?'':`≈ ${formatCfdPrice(mark,p.symbol)}`}</span>
              <button type="submit" className="cfd-closeBtn cfd-partialSubmit" disabled={busy}>{copy.closePart}</button>
              <button type="button" className="cfd-closeBtn cfd-partialCancel" onClick={()=>{setPartialId(null);setError(null);}}>{t('futures.cancel')}</button>
            </form>
          </td></tr>];
        })}</tbody></table></div>
      ):(historyCount===0?<div className="cfd-empty" role="status"><span className="spot-orders-empty-icon" aria-hidden="true"><History size={17} strokeWidth={1.5} /></span><strong>{t('futures.noPositionHistory')}</strong></div>:
        <div className="cfd-tableWrap"><table className="cfd-table"><thead><tr>
          <Th>{t('trade.cfdInstrument')}</Th><Th>{t('futures.side')}</Th><Th right>{t('futures.size')}</Th><Th right>{t('futures.entryPrice')}</Th><Th right>{t('markets.price')}</Th><Th right>{t('futures.realizedPnl')}</Th><Th>{copy.openedAt}</Th><Th>{t('trade.status')}</Th>
        </tr></thead><tbody>{state.history.map(p=>{const pnl=Number(p.realizedPnl),positive=pnl>=0;return <tr key={p.id}>
          <Td><span className="cfd-cell-instrument"><CfdInstrumentIcon symbol={p.symbol} compact/><strong>{p.symbol}</strong> <span className="cfd-muted">{p.leverage}x</span></span></Td><Td><span className={p.side==='LONG'?'text-buy':'text-sell'}>{p.side==='LONG'?t('futures.long'):t('futures.short')}</span></Td><Td className="mono" right>{p.size}</Td><Td className="mono" right>{formatCfdPrice(p.entryPrice,p.symbol)}</Td><Td className="mono" right>{formatCfdPrice(p.closePrice,p.symbol)}</Td><Td className={`mono ${positive?'text-buy':'text-sell'}`} right>{`${pnl>=0?'+':''}${pnl.toFixed(2)} ${cfdQuoteCurrency(p.symbol)}`}</Td><Td className="mono cfd-muted">{`${when(p.openedAt)} → ${when(p.closedAt)}`}</Td><Td>{copy.closed}</Td>
        </tr>;})}</tbody></table></div>)}
    </div>
  </div>;
}

function Th({children,right=false}:{children?:React.ReactNode;right?:boolean}){return <th className={`cfd-th${right?' cfd-align-right':''}`}>{children}</th>;}
function Td({children,className,right=false}:{children:React.ReactNode;className?:string;right?:boolean}){return <td className={`cfd-td ${className??''}${right?' cfd-align-right':''}`}>{children}</td>;}
