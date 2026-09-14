import { useEffect,useRef,useState } from 'react';
import { X } from 'lucide-react';
import type { ChartTradeCandle } from '../../lib/chartTrading';
import { privateTradingApi,privateErrorText,privateExplanation,privateNumber,privateUtc,type PrivateCandleSelection,type PrivateMarket,type PrivatePosition,type PrivatePreview,type PrivateState } from '../../lib/privateTradingApi';

/** Coordinates place only this temporary form; chart marks are data-bound series markers. */
export function PrivateChartTicket({candle,wallet,market,exitPosition,onDismiss,onSaved,onDenied}:{
  candle:ChartTradeCandle;wallet:PrivateState['wallet'];market:PrivateMarket|null;
  exitPosition?:PrivatePosition|null;onDismiss:()=>void;onSaved:(id:string)=>void;onDenied:(error:unknown)=>void;
}){
  const[side,setSide]=useState<'LONG'|'SHORT'>(exitPosition?.side||'LONG');
  const[leverage,setLeverage]=useState(exitPosition?.leverage||'10'),[margin,setMargin]=useState('100');
  const[point,setPoint]=useState<'OPEN'|'CLOSE'>(exitPosition?.candleEntry?.pricePoint||'CLOSE'),[tp,setTp]=useState(''),[sl,setSl]=useState('');
  const[capital,setCapital]=useState(wallet.available),[asOf]=useState(()=>new Date().toISOString());
  const[revision,setRevision]=useState(0);
  const[preview,setPreview]=useState<PrivatePreview|null>(null),[error,setError]=useState(''),[calculating,setCalculating]=useState(false),[saving,setSaving]=useState(false);
  const live=useRef(true),saveLock=useRef(false),confirmKey=useRef(crypto.randomUUID()),currentPreview=useRef<string|null>(null),firstInput=useRef<HTMLInputElement>(null);
  const callbacks=useRef({onDismiss,onSaved,onDenied});callbacks.current={onDismiss,onSaved,onDenied};
  const selection:PrivateCandleSelection={source:candle.source,interval:candle.interval,openTime:candle.openTime,pricePoint:point};
  const fingerprint=JSON.stringify({selection,side,leverage,margin,capital,tp,sl,exit:exitPosition?.id,revision});
  useEffect(()=>{live.current=true;firstInput.current?.focus();const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!saveLock.current)callbacks.current.onDismiss();};
    window.addEventListener('keydown',escape);return()=>{live.current=false;window.removeEventListener('keydown',escape);};},[]);
  useEffect(()=>{
    let disposed=false,previewId:string|null=null,timer:number|undefined;const controller=new AbortController();
    setPreview(null);setError('');currentPreview.current=null;confirmKey.current=crypto.randomUUID();
    const valid=!!exitPosition||(Number(margin)>0&&Number(leverage)>0&&Number(capital)>0);
    setCalculating(valid);if(!valid)return;
    const publish=(value:PrivatePreview)=>{if(disposed)return;setPreview(value);setCalculating(value.status==='RUNNING');};
    const poll=async()=>{if(disposed||!previewId)return;try{const next=await privateTradingApi.getPreview(previewId,controller.signal);publish(next);if(next.status==='RUNNING'&&!disposed)timer=window.setTimeout(()=>void poll(),1200);}catch(cause){if(!disposed){setCalculating(false);setError(privateErrorText(cause));callbacks.current.onDenied(cause);}}};
    timer=window.setTimeout(async()=>{
      try{
        // Selection/cursor motion is local. Only this debounced, valid ticket requests a calculation.
        const next=exitPosition?await privateTradingApi.closeOnChart(exitPosition.id,selection,crypto.randomUUID()):await privateTradingApi.preview({
          mode:'HISTORICAL_REPLAY',type:'MARKET',symbol:candle.symbol,side,leverage,margin,capital:capital!,asOf,
          candleEntry:selection,...(tp?{takeProfit:tp}:{}),...(sl?{stopLoss:sl}:{}),idempotencyKey:crypto.randomUUID(),
        });
        previewId=next.id;
        if(disposed){void privateTradingApi.cancelPreview(next.id).catch(()=>{});return;}
        currentPreview.current=next.id;publish(next);if(next.status==='RUNNING')timer=window.setTimeout(()=>void poll(),1200);
      }catch(cause){if(!disposed){setCalculating(false);setError(privateErrorText(cause));callbacks.current.onDenied(cause);}}
    },650);
    return()=>{disposed=true;controller.abort();if(timer!==undefined)clearTimeout(timer);if(previewId&&!saveLock.current)void privateTradingApi.cancelPreview(previewId).catch(()=>{});};
  },[fingerprint]);
  useEffect(()=>{if(preview?.status!=='READY'||!preview.expiresAt)return;const remaining=Date.parse(preview.expiresAt)-Date.now();if(!Number.isFinite(remaining))return;const timer=window.setTimeout(()=>setPreview(current=>current?.id===preview.id?{...current,status:'EXPIRED'}:current),Math.max(0,remaining));return()=>clearTimeout(timer);},[preview?.id,preview?.status,preview?.expiresAt]);
  async function confirm(){
    if(saveLock.current||preview?.status!=='READY'||preview.id!==currentPreview.current)return;
    saveLock.current=true;setSaving(true);setError('');
    try{await privateTradingApi.confirm(preview.id,confirmKey.current);if(live.current)callbacks.current.onSaved(preview.result?.position?.id||exitPosition?.id||preview.id);}
    catch(cause){if(live.current){setError(privateErrorText(cause));callbacks.current.onDenied(cause);}saveLock.current=false;}
    finally{if(live.current)setSaving(false);}
  }
  const ready=preview?.status==='READY',position=preview?.result?.position;
  const panelTop=Math.max(70,Math.min((candle.y??180)-40,window.innerHeight-510));
  const panelStyle={left:Math.max(12,Math.min((candle.x??window.innerWidth/2)+18,window.innerWidth-348)),top:panelTop,maxHeight:Math.max(160,window.innerHeight-panelTop-12)};
  return <section className="private-chart-ticket" role="dialog" aria-label={exitPosition?'Закрытие на графике':'Сделка с графика'} style={panelStyle}>
    <header><div><strong>{candle.symbol}</strong><small>{exitPosition?'Закрытие позиции':'Сделка с графика'} · {candle.interval}</small></div><button type="button" aria-label="Закрыть форму сделки" disabled={saving} onClick={onDismiss}><X size={18}/></button></header>
    <div className="private-candle-choice"><span>{exitPosition?'Выход':'Вход'} {point==='CLOSE'?'по закрытию':'по открытию'} свечи</span><strong>{privateNumber(point==='CLOSE'?candle.close:candle.open,6)}</strong><small>{privateUtc(point==='CLOSE'?candle.closeTime:candle.openTime)}</small></div>
    {!exitPosition&&<><div className="private-segments sides" role="group" aria-label="Направление сделки"><button type="button" className="long" disabled={saving} aria-pressed={side==='LONG'} onClick={()=>setSide('LONG')}>Long</button><button type="button" className="short" disabled={saving} aria-pressed={side==='SHORT'} onClick={()=>setSide('SHORT')}>Short</button></div><div className="private-chart-size"><label>Маржа, USDT<input ref={firstInput} aria-label="Маржа сделки, USDT" type="number" min="0.00000001" step="any" value={margin} disabled={saving} onChange={e=>setMargin(e.target.value)}/></label><label>Плечо<input aria-label="Плечо сделки" type="number" min={market?.instrument.minLeverage||'1'} max={market?.instrument.maxLeverage||'100'} step={market?.instrument.leverageStep||'1'} value={leverage} disabled={saving} onChange={e=>setLeverage(e.target.value)}/></label></div></>}
    {exitPosition&&<p>{exitPosition.side==='LONG'?'Long':'Short'} · {exitPosition.leverage}× · {privateNumber(exitPosition.quantity,8)}</p>}
    <dl className="private-chart-summary"><dt>Капитал сценария</dt><dd>{privateNumber(preview?.result?.capital?.total??(exitPosition?undefined:capital))} USDT</dd><dt>Используемая маржа</dt><dd>{privateNumber(preview?.result?.capital?.usedMargin??preview?.result?.cost.initialMargin)} USDT</dd><dt>Свободный остаток</dt><dd>{privateNumber(preview?.result?.capital?.free)} USDT</dd><dt>Количество</dt><dd>{privateNumber(position?.initialQuantity??position?.quantity,8)}</dd>{position&&<><dt>Прибыль, USDT</dt><dd className={Number(position.netPnl)<0?'negative':'positive'}>{privateNumber(position.netPnl)}</dd><dt>На момент</dt><dd>{privateUtc(position.asOf)}</dd></>}</dl>
    <details><summary>Расширенные настройки</summary><label>Цена свечи<select aria-label="Цена выбранной свечи" disabled={saving} value={point} onChange={e=>setPoint(e.target.value as 'OPEN'|'CLOSE')}><option value="CLOSE">Close</option><option value="OPEN">Open</option></select></label>{!exitPosition&&<><label>Капитал сценария, USDT<input aria-label="Капитал сценария, USDT" type="number" min="0.00000001" step="any" value={capital??''} disabled={saving} onChange={e=>setCapital(e.target.value)}/></label><div className="private-chart-size"><label>Take-profit<input type="number" min="0.00000001" step="any" disabled={saving} value={tp} onChange={e=>setTp(e.target.value)}/></label><label>Stop-loss<input type="number" min="0.00000001" step="any" disabled={saving} value={sl} onChange={e=>setSl(e.target.value)}/></label></div></>}<p>Цена сценария берётся из подтверждённой свечи. Это не подтверждение доступной в прошлом ликвидности.</p></details>
    {calculating&&<p role="status">Расчёт пути цены… {preview?.progress??0}%</p>}
    {(error||preview?.error)&&<p role="alert">{error||(preview?.error?privateExplanation(preview.error):'')}</p>}
    {preview&&!['READY','RUNNING'].includes(preview.status)&&<p className="private-warning">Расчёт не подтверждён. {preview.result?.issues?.map(privateExplanation).join(' ')}</p>}
    {!calculating&&(!!error||!!preview&&!['READY','RUNNING'].includes(preview.status))&&<button type="button" disabled={saving} onClick={()=>setRevision(value=>value+1)}>Пересчитать</button>}
    {ready&&position?.status==='LIQUIDATED'&&<p className="private-warning">Позиция была ликвидирована {privateUtc(position.effectiveClosedAt)}.</p>}
    <button type="button" className={`private-submit ${side==='LONG'?'long':'short'}`} disabled={!ready||saving||calculating} onClick={()=>void confirm()}>{saving?'Сохранение…':exitPosition?'Закрыть':position?.status==='LIQUIDATED'?'Сохранить результат':'Открыть'}</button>
  </section>;
}
