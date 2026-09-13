import { useEffect, useMemo, useState } from 'react';
import { cfdMarketCopy, formatCfdPrice } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';
import { useCfdTickers } from '../lib/useCfdTickers';
import { closeCfdPaperPosition, getCfdPaperState, subscribeCfdPaperStore } from '../lib/cfdPaperStore';
import type { CfdTickerRow } from './CfdInstrumentList';

type Tab='open'|'history';

export function CfdPositionsPanel({refreshKey,tickers}:{refreshKey:number;tickers?:CfdTickerRow[]}){
  const{lang,t}=useLanguage(),copy=cfdMarketCopy(lang);
  const feed=useCfdTickers();
  const rows=tickers??feed.tickers;
  const[tab,setTab]=useState<Tab>('open');
  const[state,setState]=useState(()=>getCfdPaperState());
  const[error,setError]=useState<string|null>(null);
  const[closingId,setClosingId]=useState<string|null>(null);

  const reload=()=>setState(getCfdPaperState());
  useEffect(()=>{reload();},[refreshKey]);
  useEffect(()=>subscribeCfdPaperStore(reload),[]);

  const priceBySymbol=useMemo(()=>new Map(rows.flatMap(row=>{
    const price=row.price!==null&&Number.isFinite(Number(row.price))&&Number(row.price)>0?Number(row.price):null;
    return price===null?[]:[[row.symbol,price] as const];
  })),[rows]);

  function close(id:string,symbol:string){
    const price=priceBySymbol.get(symbol);if(!price){setError(copy.priceUnavailable);return;}
    setClosingId(id);setError(null);
    try{closeCfdPaperPosition(id,price);reload();}catch{setError(copy.priceUnavailable);}finally{setClosingId(null);}
  }

  return <div className="cfd-wrap">
    <div className="cfd-tabs" role="tablist" aria-label={t('futures.positions')}>
      <button onClick={()=>setTab('open')} className={`cfd-tab${tab==='open'?' active':''}`} role="tab" aria-selected={tab==='open'}>{t('futures.positions')} <span className="cfd-tab-count">{state.open.length}</span></button>
      <button onClick={()=>setTab('history')} className={`cfd-tab${tab==='history'?' active':''}`} role="tab" aria-selected={tab==='history'}>{t('futures.positionHistory')} <span className="cfd-tab-count">{state.history.length}</span></button>
      <span className="cfd-practice-mode" title={copy.practiceNote}>{copy.practice}</span>
    </div>
    {error&&<div className="cfd-error" role="alert">{error}</div>}
    <div className="cfd-position-content" role="tabpanel">
      {tab==='open'?(state.open.length===0?<div className="cfd-empty">{t('futures.noPositions')}</div>:
        <div className="cfd-tableWrap"><table className="cfd-table"><thead><tr>
          <Th>{t('trade.cfdInstrument')}</Th><Th>{t('futures.side')}</Th><Th>{t('futures.size')}</Th><Th>{t('futures.entryPrice')}</Th><Th>{t('futures.markPrice')}</Th><Th>{t('futures.liqPrice')}</Th><Th>{t('futures.unrealizedPnl')}</Th><Th>{t('futures.roe')}</Th><Th></Th>
        </tr></thead><tbody>{state.open.map(p=>{
          const mark=priceBySymbol.get(p.symbol)??null,entry=Number(p.entryPrice),size=Number(p.size),margin=Number(p.initialMargin);
          const pnl=mark===null?null:(p.side==='LONG'?mark-entry:entry-mark)*size;
          const roe=pnl===null||!Number.isFinite(margin)||margin<=0?null:pnl/margin*100;
          const positive=(pnl??0)>=0;
          return <tr key={p.id}>
            <Td><strong>{p.symbol}</strong> <span className="cfd-muted">{p.leverage}x</span></Td>
            <Td><span className={p.side==='LONG'?'text-buy':'text-sell'}>{p.side==='LONG'?t('futures.long'):t('futures.short')}</span></Td>
            <Td className="mono">{p.size}</Td><Td className="mono">{formatCfdPrice(entry,p.symbol)}</Td><Td className="mono">{mark===null?'—':formatCfdPrice(mark,p.symbol)}</Td><Td className="mono text-sell">{p.liquidationPrice?formatCfdPrice(p.liquidationPrice,p.symbol):'—'}</Td>
            <Td className={`mono ${pnl===null?'':positive?'text-buy':'text-sell'}`}>{pnl===null?'—':`${pnl>=0?'+':''}${pnl.toFixed(2)} USDT`}</Td><Td className={`mono ${roe===null?'':positive?'text-buy':'text-sell'}`}>{roe===null?'—':`${roe>=0?'+':''}${roe.toFixed(2)}%`}</Td>
            <Td><button className="cfd-closeBtn" disabled={closingId===p.id||mark===null} onClick={()=>close(p.id,p.symbol)}>{closingId===p.id?t('futures.closing'):t('futures.close')}</button></Td>
          </tr>;
        })}</tbody></table></div>
      ):(state.history.length===0?<div className="cfd-empty">{t('futures.noPositionHistory')}</div>:
        <div className="cfd-tableWrap"><table className="cfd-table"><thead><tr>
          <Th>{t('trade.cfdInstrument')}</Th><Th>{t('futures.side')}</Th><Th>{t('futures.size')}</Th><Th>{t('futures.entryPrice')}</Th><Th>{t('markets.price')}</Th><Th>{t('futures.realizedPnl')}</Th><Th>{t('trade.status')}</Th>
        </tr></thead><tbody>{state.history.map(p=>{const pnl=Number(p.realizedPnl),positive=pnl>=0;return <tr key={p.id}>
          <Td><strong>{p.symbol}</strong> <span className="cfd-muted">{p.leverage}x</span></Td><Td><span className={p.side==='LONG'?'text-buy':'text-sell'}>{p.side==='LONG'?t('futures.long'):t('futures.short')}</span></Td><Td className="mono">{p.size}</Td><Td className="mono">{formatCfdPrice(p.entryPrice,p.symbol)}</Td><Td className="mono">{formatCfdPrice(p.closePrice,p.symbol)}</Td><Td className={`mono ${positive?'text-buy':'text-sell'}`}>{`${pnl>=0?'+':''}${pnl.toFixed(2)} USDT`}</Td><Td>{copy.closed}</Td>
        </tr>;})}</tbody></table></div>)}
    </div>
  </div>;
}

function Th({children}:{children?:React.ReactNode}){return <th className="cfd-th">{children}</th>;}
function Td({children,className}:{children:React.ReactNode;className?:string}){return <td className={`cfd-td ${className??''}`}>{children}</td>;}
