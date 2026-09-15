import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { PrivateTradingMarketData, PrivateChartInterval, assertPrivateFreshQuote } from '../marketData';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { contractRules, simulationProfile } from '../service';
import { NativeAccount, NativeRepository, commandHash } from './store';
import { demoAccount, demoPositionView, DemoEngineError, DemoProtection, NATIVE_DEMO_MODEL } from './engine';
import { applyLatestQuotes, BarRequest, historicalLimitTouch, NativeBook, NativeInstruction, ReplayBar, ReplayResult, replayNativeDemoAsync } from './replay';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:PrivateChartInterval;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export type NativeCommand = {idempotencyKey:string} & (
  | {kind:'REFRESH'}
  | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<DemoProtection>}
  | {kind:'CLOSE';positionId:string;quantity?:string;candle?:NativeCandle}
  | {kind:'CANCEL';orderId:string}
  | {kind:'PROTECTION';positionId:string;protection:Partial<DemoProtection>}
  | {kind:'LEVERAGE';positionId:string;leverage:string}
);
const MINUTE=60_000;
/** A plain refresh is persisted only when something happened or the stored canonical checkpoint is this old. */
export const NATIVE_REFRESH_PERSIST_MS=15*MINUTE;
const outcome=(s:NativeAccount['snapshot'])=>JSON.stringify([s.events.map(e=>e.id+e.kind+e.time+e.price),s.orders.map(o=>o.status+o.filled),s.positions.map(p=>p.status+p.quantity)]);
/** Keep only the observed depth a command can consume (deterministic replay without storing 1000 levels). */
export function truncateBook(book:NativeBook,side:'BUY'|'SELL',quantity:string,limit?:string):NativeBook{
  const need=new BigNumber(quantity),levels=side==='BUY'?book.asks:book.bids,kept:NativeBook['bids']=[];let total=new BigNumber(0);
  for(const level of levels){
    if(limit!==undefined&&(side==='BUY'?new BigNumber(level.price).gt(limit):new BigNumber(level.price).lt(limit)))break;
    kept.push({price:level.price,quantity:level.quantity});total=total.plus(level.quantity);if(total.gte(need))break;
  }
  return side==='BUY'?{bids:[],asks:kept,timestamp:book.timestamp}:{bids:kept,asks:[],timestamp:book.timestamp};
}
export class NativeDemoService {
  private busy=new Set<string>();
  constructor(readonly repository:NativeRepository,private readonly market:PrivateTradingMarketData,private readonly now:()=>number=Date.now){}
  view(row:NativeAccount|null){
    if(!row)return{initialized:false,model:NATIVE_DEMO_MODEL,revision:0,account:null,positions:[],history:[],orders:[],events:[],source:null,asOf:null};
    const positions=row.snapshot.positions.map(p=>demoPositionView(row.snapshot,p));
    return{initialized:true,model:NATIVE_DEMO_MODEL,revision:row.revision,account:demoAccount(row.snapshot),positions:positions.filter(p=>p.status==='OPEN'),history:positions.filter(p=>p.status!=='OPEN'),
      orders:row.snapshot.orders,events:row.snapshot.events,source:row.source,asOf:row.snapshot.time,
      entries:row.commands.filter((c):c is Extract<NativeInstruction,{kind:'OPEN'}>=>c.kind==='OPEN').map(c=>({positionId:c.order.id,candle:c.candle??null}))};
  }
  async state(actor:OwnerSession){const row=await this.repository.read(actor);return{...this.view(row),demoAvailable:row?null:await this.repository.available(actor)};}
  async initialize(actor:OwnerSession,key:string){return this.view(await this.repository.initialize(actor,key));}
  private async bars(request:BarRequest):Promise<ReplayBar[]>{
    const history=await this.market.history({symbol:request.symbol,startTime:request.start,endTime:request.end,intervalMinutes:(request.intervalMs/MINUTE) as 1|15|60,omitProviderFunding:true});
    if(!history.complete)throw new DemoEngineError('HISTORY_GAP');
    const marks=new Map(history.markCandles.map(c=>[c.timestamp,c]));
    return history.tradeCandles.map(c=>{const mark=marks.get(c.timestamp);if(!mark)throw new DemoEngineError('MARK_HISTORY_GAP');return{time:c.timestamp,intervalMs:request.intervalMs,trade:c,mark};});
  }
  /** Mark price at a minute boundary: the open of the minute starting there, or the close of the minute ending there. */
  private async markAt(symbol:string,time:number,edge:'START'|'END'):Promise<string>{
    if(time%MINUTE!==0)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    const start=edge==='START'?time:time-MINUTE,bars=await this.bars({symbol,start,end:start+MINUTE,intervalMs:MINUTE});
    const bar=bars.find(b=>b.time===start);if(!bar)throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
    return edge==='START'?bar.mark.open:bar.mark.close;
  }
  async command(actor:OwnerSession,request:NativeCommand,options:{persist?:boolean}={}){
    const hash=commandHash(request),prior=await this.repository.prior(actor,request.idempotencyKey,hash);if(prior)return this.view(prior);
    if(this.busy.has(actor.userId))throw new PrivateTradingError('native_busy','Расчёт уже выполняется',409);
    this.busy.add(actor.userId);
    try {
      const row=await this.repository.read(actor);if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите демо-баланс',409);
      const instruction=await this.instruction(row,request);
      const commands=structuredClone(instruction?[...row.commands,instruction]:row.commands);
      if(!commands.length&&!options.persist)return this.view(row);
      // Backdated trades re-simulate the scenario from the beginning; everything else continues the
      // canonical checkpoint, so outcomes already shown are never recomputed away.
      const incremental=row.checkpoint&&(!instruction||instruction.at>=row.checkpoint.time)?row.checkpoint:null;
      const result=await this.replay(row,commands,incremental);
      if(result.observed){
        // Same effect as the quotes just applied to the projected snapshot; never undone by a later replay.
        commands.push({id:`observe-${randomUUID()}`,kind:'OBSERVE',at:result.snapshot.time,marks:result.observed});
      }
      const next:NativeAccount={...row,commands,snapshot:result.snapshot,checkpoint:result.checkpoint};
      const changed=!!instruction||!!result.observed||outcome(result.snapshot)!==outcome(row.snapshot);
      const stale=!row.checkpoint||result.checkpoint.time-row.checkpoint.time>=NATIVE_REFRESH_PERSIST_MS;
      if(request.kind==='REFRESH'&&!options.persist&&!changed&&!stale)return this.view({...next,revision:row.revision});
      return this.view(await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash));
    }finally{this.busy.delete(actor.userId);}
  }
  private async replay(row:NativeAccount,commands:NativeInstruction[],checkpoint:NativeAccount['checkpoint']|null):Promise<ReplayResult>{
    const load=(r:BarRequest)=>this.bars(r),asOf=this.now();
    let result:ReplayResult;
    try{result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf,checkpoint},load);}
    catch(e){
      // A checkpoint that no longer matches (clock skew, legacy row) falls back to the full scenario.
      if(!(checkpoint&&e instanceof DemoEngineError&&e.code==='CHECKPOINT_MISMATCH'))throw e;
      result=await replayNativeDemoAsync({deposit:row.deposit,instructions:commands,asOf},load);
    }
    // Quotes are fetched only after the (possibly long) history pass, then checked for freshness again.
    const latest:Record<string,{mark:string;last:string;time:number}>={};
    const symbols=[...new Set(result.snapshot.positions.filter(p=>p.status==='OPEN').map(p=>p.symbol))].sort();
    // Small parallel batches keep every quote inside the freshness window without exceeding upstream concurrency.
    for(let i=0;i<symbols.length;i+=3){
      const quotes=await Promise.all(symbols.slice(i,i+3).map(symbol=>this.market.freshQuote(symbol)));
      for(const q of quotes){const checked=assertPrivateFreshQuote(q,q.symbol,this.now());latest[checked.symbol]={mark:checked.markPrice,last:checked.lastPrice,time:checked.markProviderTimestamp};}
    }
    const at=Math.max(this.now(),result.snapshot.time);
    return{...result,observed:applyLatestQuotes(result.snapshot,latest,at)};
  }
  private async instruction(row:NativeAccount,request:NativeCommand):Promise<NativeInstruction|undefined>{
    const id=`native-${randomUUID()}`;
    if(request.kind==='OPEN'){
      const symbol=request.symbol.replace(/[^A-Z0-9]/g,''),instrument=await this.market.instrument(symbol),rules=contractRules(instrument),profile=simulationProfile(instrument);
      profile.riskModelVersion='NATIVE_CROSS_V2:'+instrument.parameterVersion;
      profile.assumptions=['Cross USDT-only demo; gross hedge maintenance; not Bybit matching.','Custom demo funding -0.001 / +0.004 of position value per 8h UTC; not provider funding.','Historical assumed OHLC path, never a claim of actual past fills.'];
      const sizePrice=request.type==='LIMIT'?request.price:undefined;
      const size=(price:string)=>request.quantity??new BigNumber(request.margin!).times(request.leverage).div(price).div(rules.qtyStep).integerValue(BigNumber.ROUND_FLOOR).times(rules.qtyStep).toFixed();
      const order=(quantity:string)=>({id,symbol,side:request.side,type:request.type,quantity,leverage:request.leverage,...(request.price?{price:request.price}:{}),...(request.protection?{protection:request.protection}:{}),historical:!!request.candle});
      if(request.candle){
        const selected=await this.market.resolveCandle({...request.candle,symbol}),candle=request.candle;
        if(request.type==='LIMIT'){
          // Owner rule on the SELECTED candle: Buy fills if Low <= limit, Sell if High >= limit.
          const touch=historicalLimitTouch(request.side,request.price!,selected.candle,selected.openTime,selected.intervalMs);
          const quantity=size(sizePrice!);
          if(touch){
            const mark=touch.at===selected.openTime?await this.markAt(symbol,touch.at,'START'):touch.price;
            return{id,kind:'OPEN',at:touch.at,order:order(quantity),instrument:{rules,profile},mark,last:touch.price,point:touch.price,maker:touch.maker,candle:{...candle,pricePoint:'OPEN'}};
          }
          // Not reached inside the selected candle: the order rests from that candle's close.
          const at=selected.closeTime,mark=await this.markAt(symbol,at,'END');
          return{id,kind:'OPEN',at,order:order(quantity),instrument:{rules,profile},mark,last:selected.candle.close,candle:{...candle,pricePoint:'CLOSE'}};
        }
        const at=selected.effectiveAt,mark=await this.markAt(symbol,at,request.candle.pricePoint==='OPEN'?'START':'END');
        return{id,kind:'OPEN',at,order:order(size(selected.price)),instrument:{rules,profile},mark,last:selected.price,point:selected.price,candle};
      }
      const q=await this.market.freshQuote(symbol);assertPrivateFreshQuote(q,symbol,this.now());
      const quantity=size(sizePrice??q.lastPrice);
      const book=truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},request.side==='LONG'?'BUY':'SELL',quantity,request.type==='LIMIT'?request.price:undefined);
      return{id,kind:'OPEN',at:this.now(),order:order(quantity),instrument:{rules,profile},mark:q.markPrice,last:q.lastPrice,book};
    }
    if(request.kind==='CLOSE'){
      const p=row.snapshot.positions.find(p=>p.id===request.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
      if(request.candle){
        const c=await this.market.resolveCandle({...request.candle,symbol:p.symbol});
        if(c.effectiveAt<=p.openedAt)throw new DemoEngineError('EXIT_BEFORE_ENTRY');
        return{id,kind:'CLOSE',at:c.effectiveAt,positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:c.price,candle:request.candle};
      }
      const q=await this.market.freshQuote(p.symbol);assertPrivateFreshQuote(q,p.symbol,this.now());
      const book=truncateBook({bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt},p.side==='LONG'?'SELL':'BUY',request.quantity??p.quantity);
      return{id,kind:'CLOSE',at:this.now(),positionId:p.id,...(request.quantity?{quantity:request.quantity}:{}),price:p.side==='LONG'?q.bids[0].price:q.asks[0].price,book};
    }
    if(request.kind==='CANCEL')return{id,kind:'CANCEL',at:this.now(),orderId:request.orderId};
    if(request.kind==='PROTECTION')return{id,kind:'PROTECTION',at:this.now(),positionId:request.positionId,protection:request.protection};
    if(request.kind==='LEVERAGE')return{id,kind:'LEVERAGE',at:this.now(),positionId:request.positionId,leverage:request.leverage};
    return undefined;
  }
  /** Card values come from ONE persisted revision; an open position is revalued and frozen first. */
  async card(actor:OwnerSession,positionId:string,revision?:number){
    let row=revision===undefined?await this.repository.read(actor):await this.repository.revision(actor,revision);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    if(revision===undefined&&row.snapshot.positions.some(p=>p.id===positionId&&p.status==='OPEN')){
      await this.command(actor,{kind:'REFRESH',idempotencyKey:`card-${randomUUID()}`},{persist:true});
      row=await this.repository.read(actor);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    }
    const p=row.snapshot.positions.find(p=>p.id===positionId);if(!p)throw new DemoEngineError('POSITION_MISSING');const v=demoPositionView(row.snapshot,p);
    return{id:`native:${row.revision}:${p.id}`,symbol:p.symbol,side:p.side,leverage:p.leverage,mode:p.historical?'HISTORICAL_REPLAY':'DEMO_LIVE',status:p.status,
      netPnl:v.netPnl,unrealizedPnl:v.unrealizedPnl,pnl:p.status==='OPEN'?v.unrealizedPnl:v.netPnl,roiPercent:v.roiPercent,entryPrice:p.entryPrice,
      valuationPrice:p.status==='OPEN'?p.markPrice:(row.snapshot.events.filter(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind)).at(-1)?.price??null),
      usdPnl:null,asOf:new Date(row.snapshot.time).toISOString(),label:p.historical?'Historical Test':'Demo',revision:row.revision};
  }
}
