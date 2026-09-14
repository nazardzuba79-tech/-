import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { PrivateTradingMarketData, PrivateChartInterval, assertPrivateFreshQuote } from '../marketData';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { contractRules, simulationProfile } from '../service';
import { NativeAccount, NativeRepository, commandHash } from './store';
import { demoAccount, demoPositionView, DemoEngineError, DemoProtection, NATIVE_DEMO_MODEL } from './engine';
import { NativeInstruction, ReplayBar, replayNativeDemo } from './replay';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:PrivateChartInterval;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export type NativeCommand = {idempotencyKey:string} & (
  | {kind:'REFRESH'}
  | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<DemoProtection>}
  | {kind:'CLOSE';positionId:string;quantity?:string;candle?:NativeCandle}
  | {kind:'CANCEL';orderId:string}
  | {kind:'PROTECTION';positionId:string;protection:Partial<DemoProtection>}
  | {kind:'LEVERAGE';positionId:string;leverage:string}
);
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
  async command(actor:OwnerSession,request:NativeCommand){
    const hash=commandHash(request),prior=await this.repository.prior(actor,request.idempotencyKey,hash);if(prior)return this.view(prior);
    if(this.busy.has(actor.userId))throw new PrivateTradingError('native_busy','Расчёт уже выполняется',409);
    this.busy.add(actor.userId);
    try {
      const row=await this.repository.read(actor);if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите демо-баланс',409);
      let instruction:NativeInstruction|undefined;const id=`native-${randomUUID()}`;
      if(request.kind==='OPEN'){
        const symbol=request.symbol.replace(/[^A-Z0-9]/g,''),instrument=await this.market.instrument(symbol),rules=contractRules(instrument),profile=simulationProfile(instrument);
        profile.riskModelVersion='NATIVE_CROSS_V1:'+instrument.parameterVersion;
        profile.assumptions=['Cross USDT-only demo; gross hedge maintenance; not Bybit matching.','Fixed signed fractional funding -0.001 / +0.004 per 8h UTC; not provider funding.','Historical assumed OHLC path, never a claim of actual past fills.'];
        let at=this.now(),point:string|undefined,candle:NativeCandle|undefined,mark:string,last:string,book:Extract<NativeInstruction,{kind:'OPEN'}>['book'];
        if(request.candle){
          const selected=await this.market.resolveCandle({...request.candle,symbol});at=selected.effectiveAt;candle=request.candle;last=selected.price;mark=selected.price;
          // Resolve the separate Mark candle below before the historical instruction enters the engine.
          if(request.type==='MARKET')point=selected.price;
        }else{
          const q=await this.market.freshQuote(symbol);assertPrivateFreshQuote(q,symbol,this.now());at=this.now();mark=q.markPrice;last=q.lastPrice;
          book={bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt};
        }
        const sizePrice=request.type==='LIMIT'?request.price:last;if(!sizePrice)throw new DemoEngineError('LIMIT_PRICE_REQUIRED');
        const quantity=request.quantity??new BigNumber(request.margin!).times(request.leverage).div(sizePrice).div(rules.qtyStep).integerValue(BigNumber.ROUND_FLOOR).times(rules.qtyStep).toFixed();
        instruction={id,kind:'OPEN',at,order:{id,symbol,side:request.side,type:request.type,quantity,leverage:request.leverage,price:request.price,protection:request.protection,historical:!!candle},instrument:{rules,profile},mark,last,...(point?{point}:{}),...(book?{book}:{}),...(candle?{candle}:{})};
      }else if(request.kind==='CLOSE'){
        const p=row.snapshot.positions.find(p=>p.id===request.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
        let at:number,price:string,book:Extract<NativeInstruction,{kind:'CLOSE'}>['book'];
        if(request.candle){const c=await this.market.resolveCandle({...request.candle,symbol:p.symbol});at=c.effectiveAt;price=c.price;if(at<=p.openedAt)throw new DemoEngineError('EXIT_BEFORE_ENTRY');}
        else {const q=await this.market.freshQuote(p.symbol);assertPrivateFreshQuote(q,p.symbol,this.now());at=this.now();price=p.side==='LONG'?q.bids[0].price:q.asks[0].price;book={bids:q.bids,asks:q.asks,timestamp:q.bookGeneratedAt};}
        instruction={id,kind:'CLOSE',at,positionId:p.id,quantity:request.quantity,price,...(book?{book}:{}),...(request.candle?{candle:request.candle}:{})};
      }else if(request.kind==='CANCEL')instruction={id,kind:'CANCEL',at:this.now(),orderId:request.orderId};
      else if(request.kind==='PROTECTION')instruction={id,kind:'PROTECTION',at:this.now(),positionId:request.positionId,protection:request.protection};
      else if(request.kind==='LEVERAGE')instruction={id,kind:'LEVERAGE',at:this.now(),positionId:request.positionId,leverage:request.leverage};
      const commands=structuredClone(instruction?[...row.commands,instruction]:row.commands),asOf=this.now();
      if(!commands.length)return this.view(row);
      const opens=commands.filter((c):c is Extract<NativeInstruction,{kind:'OPEN'}>=>c.kind==='OPEN');
      const symbols=[...new Set(opens.map(c=>c.order.symbol))];if(symbols.length>4)throw new DemoEngineError('FOUR_CONTRACT_LIMIT');
      const from=Math.floor(Math.min(...commands.map(c=>c.at))/60000)*60000,end=Math.floor(asOf/60000)*60000;
      // Existing collector caches immutable pages. No additional WS universe or always-on collection is introduced.
      const bars:Record<string,ReplayBar[]>={};
      for(const symbol of symbols){
        if(end>from){
          const history=await this.market.history({symbol,startTime:from,endTime:end,intervalMinutes:1,omitProviderFunding:true});
          if(!history.complete)throw new DemoEngineError('HISTORY_GAP');
          const marks=new Map(history.markCandles.map(c=>[c.timestamp,c]));
          bars[symbol]=history.tradeCandles.map(c=>{const mark=marks.get(c.timestamp);if(!mark)throw new DemoEngineError('MARK_HISTORY_GAP');return{time:c.timestamp,intervalMs:60000,trade:c,mark};});
        }else bars[symbol]=[];
      }
      for(const c of opens.filter(c=>!!c.candle)){
        const b=bars[c.order.symbol].find(b=>b.time===c.at)||(c.candle!.pricePoint==='CLOSE'?bars[c.order.symbol].find(b=>b.time+b.intervalMs===c.at):undefined);
        if(b)c.mark=b.time===c.at?b.mark.open:b.mark.close;
        else throw new DemoEngineError('ENTRY_MARK_UNAVAILABLE');
      }
      const latest:Record<string,{mark:string;last:string;time:number}>={};
      // Fetch after history so a long backfill cannot turn a fresh quote into a stale financial write.
      for(const symbol of symbols){const q=await this.market.freshQuote(symbol);latest[symbol]={mark:q.markPrice,last:q.lastPrice,time:q.markProviderTimestamp};}
      const snapshot=replayNativeDemo({deposit:row.deposit,instructions:commands,bars,asOf:this.now(),latest});
      const next={...row,commands,snapshot};
      return this.view(await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash));
    }finally{this.busy.delete(actor.userId);}
  }
  async card(actor:OwnerSession,positionId:string,revision?:number){
    const row=revision===undefined?await this.repository.read(actor):await this.repository.revision(actor,revision);if(!row)throw new DemoEngineError('ACCOUNT_MISSING');
    const p=row.snapshot.positions.find(p=>p.id===positionId);if(!p)throw new DemoEngineError('POSITION_MISSING');const v=demoPositionView(row.snapshot,p);
    return{id:`native:${row.revision}:${p.id}`,symbol:p.symbol,side:p.side,leverage:p.leverage,mode:p.historical?'HISTORICAL_REPLAY':'DEMO_LIVE',status:p.status,
      netPnl:v.netPnl,unrealizedPnl:v.unrealizedPnl,pnl:p.status==='OPEN'?v.unrealizedPnl:v.netPnl,roiPercent:v.roiPercent,entryPrice:p.entryPrice,valuationPrice:p.markPrice,
      usdPnl:null,asOf:new Date(row.snapshot.time).toISOString(),label:p.historical?'Historical Test':'Demo',revision:row.revision};
  }
}
