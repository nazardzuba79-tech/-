import type { ChartTradeOverlay } from './chartTrading';
import { privatePositionPnl,type PrivatePosition } from './privateTradingApi';

/** Convert only verified saved values for display. No financial calculation is performed here. */
export function privateChartOverlays(positions:PrivatePosition[],pair:string):ChartTradeOverlay[]{
  const symbol=pair.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const decimal=(value:string|null|undefined)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
  return positions.filter(position=>position.symbol===symbol&&position.dataStatus!=='UNAVAILABLE'&&(!position.verification||position.verification==='VERIFIED'))
    .flatMap(position=>{
      const price=decimal(position.entryPrice),pnl=decimal(privatePositionPnl(position));
      if(price===null||price<=0||pnl===null)return [];
      return [{id:position.id,symbol,side:position.side,leverage:Number(position.leverage),entryPrice:price,quantity:Number(position.status==='OPEN'?position.quantity:position.initialQuantity??position.quantity),pnl,
        entryTime:Date.parse(position.effectiveOpenedAt),entryCandleOpenTime:position.candleEntry?.openTime,entryInterval:position.candleEntry?.interval,entryModel:position.candleEntry?.pricePoint,
        takeProfit:decimal(position.takeProfit),stopLoss:decimal(position.stopLoss),liquidationPrice:decimal(position.liquidationPrice),
        exits:(position.fills??[]).filter(fill=>fill.kind!=='OPEN').map(fill=>({time:fill.kind==='CLOSE'&&position.candleClose?.pricePoint==='CLOSE'&&fill.effectiveAt===position.candleClose.effectiveAt?fill.effectiveAt-1:fill.effectiveAt,price:Number(fill.price),kind:fill.kind,quantity:Number(fill.quantity)})),
      }];
    });
}
