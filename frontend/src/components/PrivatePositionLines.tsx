import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { chartSymbol, type ChartTradingInteraction } from '../lib/chartTrading';
import './PrivatePositionLines.css';

type Point = { id:string; y:number; x:number };
/** Native priceToCoordinate is the only source of the y coordinate; never clamp a price into view. */
export function PrivatePositionLines({chart,series,interaction,pair}:{
  chart:IChartApi|null; series:ISeriesApi<'Candlestick'>|null;
  interaction?:ChartTradingInteraction; pair:string;
}) {
  const [points,setPoints]=useState<Point[]>([]);
  useEffect(()=>{
    if(!chart||!series||!interaction?.enabled){setPoints([]);return;}
    const trades=interaction.trades.filter(t=>t.status==='OPEN'&&chartSymbol(t.symbol)===chartSymbol(pair));
    if(!trades.length){setPoints([]);return;}
    let frame=0,stopped=false,previous='';
    const sync=()=>{
      if(stopped)return;
      try{
        if(!document.hidden){
          const width=chart.timeScale().width(),height=chart.panes()[0]?.getHeight()??0;
          const next=trades.flatMap(t=>{
            const y=series.priceToCoordinate(t.entryPrice);
            return y!==null&&Number.isFinite(y)&&y>=11&&y<=height-11
              ?[{id:t.id,y:Math.round(y*2)/2,x:Math.max(0,Math.min(width-198,width*.43))}]:[];
          });
          const signature=JSON.stringify(next);
          if(signature!==previous){previous=signature;setPoints(next);}
        }
        frame=requestAnimationFrame(sync);
      }catch{if(!stopped)setPoints([]);}
    };
    sync();return()=>{stopped=true;cancelAnimationFrame(frame);};
  },[chart,series,interaction,pair]);
  if(!interaction?.enabled)return null;
  return <div className="private-position-lines" aria-label="Линии открытых позиций">
    {points.map(point=>{
      const trade=interaction.trades.find(t=>t.id===point.id);if(!trade)return null;
      const color=trade.side==='LONG'?'long':'short';
      const amount=new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(trade.quantity);
      return <div key={trade.id} className={`private-position-line-label ${color}`} data-position-line={trade.id}
        data-entry-price={trade.entryPrice} style={{left:point.x,top:point.y}}
        onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}>
        <button type="button" className="private-line-pnl" onClick={()=>interaction.onTradeSelect(trade.id)}
          aria-label={`Выбрать позицию ${trade.symbol}`} title="Выбрать позицию">
          P&amp;L {trade.pnl>=0?'+':''}{trade.pnl.toFixed(2)}
        </button>
        <button type="button" className="private-line-quantity" onClick={()=>interaction.onTradeSelect(trade.id)}
          aria-label={`Количество ${amount} ${pair.split('/')[0]}`}>{amount}</button>
        <button type="button" className="private-line-action" disabled title="Разворот позиции недоступен в приватном режиме" aria-label="Разворот недоступен">↕</button>
        <button type="button" className="private-line-action" disabled={!interaction.onTradeClose} onClick={()=>interaction.onTradeClose?.(trade.id)}
          aria-label={`Закрыть позицию ${trade.symbol}`} title="Открыть подтверждение закрытия">×</button>
      </div>;
    })}
  </div>;
}
