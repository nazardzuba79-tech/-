import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { PrivateTradingMarketData, PrivateChartInterval, assertPrivateFreshQuote } from '../marketData';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { contractRules, simulationProfile } from '../service';
import { NativeAccount, NativeRepository, commandHash } from './store';
import { demoAccount, demoPositionView, DemoEngineError, DemoProtection, NATIVE_DEMO_MODEL } from './engine';
import { valueCollateral, CollateralPrice, CollateralValuation } from './collateral';
import { crossAccount, CrossAccount } from './accountModel';
import { accountLedger, AccountLedger } from './ledger';
import { applyLatestQuotes, BarRequest, historicalLimitTouch, NativeBook, NativeInstruction, ReplayBar, ReplayResult, replayNativeDemoAsync } from './replay';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:PrivateChartInterval;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export type NativeCommand = {idempotencyKey:string} & (
  | {kind:'REFRESH'}
  /**
   * `reduceOnly` + `positionId` make this a REDUCING order that keeps its
   * own type. A reduce-only LIMIT is a resting close at a price — the
   * engine has always supported it (`placeDemoOrder` validates the side
   * and size against the position) — and it must NOT be collapsed into a
   * CLOSE, which prices at the book instead of at the price the trader set.
   */
  | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<DemoProtection>;reduceOnly?:boolean;positionId?:string}
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
  /**
   * WHAT THE WHOLE WALLET IS WORTH, as the Cross collateral base.
   *
   * Every asset the owner holds is priced in the settle asset from the SAME
   * market data the terminal trades on — one price source, no second table
   * of numbers to disagree with the first. An asset whose quote cannot be
   * fetched comes back UNPRICED and named: the valuation says so and stays
   * `complete: false`, rather than pretending the holding is worth nothing.
   * A caller that needs a collateral figure must read `complete`.
   *
   * No total is written into the code. The figure is whatever the owner's
   * rows and the live quotes make it.
   */
  async collateral(actor:OwnerSession):Promise<CollateralValuation>{
    const holdings=await this.repository.holdings(actor);
    const settle='USDT';
    const prices=await Promise.all(holdings
      .filter(h=>h.asset!==settle)
      .map(async(h):Promise<CollateralPrice>=>{
        try{
          const quote=await this.market.freshQuote(`${h.asset}${settle}`);
          // Mark, not last: the collateral is valued the way the positions
          // it backs are valued, so the two cannot drift apart.
          return{asset:h.asset,price:quote.markPrice,source:'BYBIT_LINEAR_MARK',asOf:quote.markProviderTimestamp??quote.fetchedAt};
        }catch{
          // A contract that does not exist and a provider that is down are
          // the same answer here: we do not know what this is worth.
          return{asset:h.asset,price:null,source:'BYBIT_LINEAR_MARK',asOf:null};
        }
      }));
    return valueCollateral(holdings,prices,settle);
  }
  /**
   * ONE ACCOUNT OBJECT, WHATEVER ASKED FOR IT.
   *
   * `view()` projects the engine's own settle-denominated figures. Every
   * response the terminal receives — a state poll, an order, a close, a
   * refresh — replaces that with the AUTHORITATIVE account: the same
   * engine figures folded together with the wallet's other collateral by
   * `crossAccount`, plus the ledger that explains the balance.
   *
   * Going through one helper is the point. When the poll and the order
   * response each built their own account, a trader could place an order
   * and watch available margin disagree with itself for five seconds.
   */
  private async authoritative<T extends ReturnType<NativeDemoService['view']>>(actor:OwnerSession,view:T,row:NativeAccount|null){
    if(!row||!view.initialized)return{...view,ledger:null};
    const valuation=await this.collateral(actor);
    const open=row.snapshot.positions.some(p=>p.status==='OPEN');
    return{...view,account:crossAccount(demoAccount(row.snapshot),valuation,open),ledger:accountLedger(row.snapshot)};
  }
  /**
   * THE AUTHORITATIVE ACCOUNT — one computation, server-side.
   *
   * Equity, available margin, both margins, the liquidation verdict and the
   * ledger all come from here. Nothing downstream recomputes any of them:
   * two derivations of one figure are two figures, and the terminal has
   * already been bitten once by exactly that (a maintenance margin derived
   * a second time from the real tier table read 0.00%).
   *
   * The collateral valuation is folded in here rather than in the engine
   * because the engine is denominated in the settle asset and knows nothing
   * about the owner's other holdings. Keeping it out of the engine also
   * keeps replay deterministic: the journal does not depend on what BTC was
   * worth when the account happened to be read.
   */
  async account(actor:OwnerSession):Promise<{account:CrossAccount;ledger:AccountLedger}|null>{
    const row=await this.repository.read(actor);
    if(!row)return null;
    const view=await this.authoritative(actor,this.view(row),row);
    return{account:view.account as CrossAccount,ledger:view.ledger as AccountLedger};
  }
  async state(actor:OwnerSession){
    const row=await this.repository.read(actor);
    const view=await this.authoritative(actor,this.view(row),row);
    return{...view,demoAvailable:row?null:await this.repository.available(actor)};
  }
  /**
   * The contract's own trading rules, for the terminal's order form.
   *
   * These are the numbers `validateContractOrder` enforces. Publishing them
   * is what lets the form SIZE to the contract — snap to `qtyStep`, stop at
   * `maxMarketOrderQty`, refuse below `minNotionalValue` — instead of
   * sending a quantity the engine then has to refuse. The rules are the
   * instrument service's cached Bybit values; nothing here invents or
   * relaxes one. `actor` is required so this stays behind the same
   * owner+ADMIN+session gate as every other native route.
   */
  async contract(actor:OwnerSession,symbol:string){
    void actor;
    const instrument=await this.market.instrument(symbol);
    return{...contractRules(instrument),riskTiers:simulationProfile(instrument).riskTiers,
      takerFeeRate:simulationProfile(instrument).takerFeeRate,makerFeeRate:simulationProfile(instrument).makerFeeRate};
  }
  async initialize(actor:OwnerSession,key:string){const row=await this.repository.initialize(actor,key);return this.authoritative(actor,this.view(row),row);}
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
    const hash=commandHash(request),prior=await this.repository.prior(actor,request.idempotencyKey,hash);if(prior)return this.authoritative(actor,this.view(prior),prior);
    if(this.busy.has(actor.userId))throw new PrivateTradingError('native_busy','Расчёт уже выполняется',409);
    this.busy.add(actor.userId);
    try {
      const row=await this.repository.read(actor);if(!row)throw new PrivateTradingError('initialize_demo','Сначала подключите демо-баланс',409);
      const instruction=await this.instruction(row,request);
      const commands=structuredClone(instruction?[...row.commands,instruction]:row.commands);
      if(!commands.length&&!options.persist)return this.authoritative(actor,this.view(row),row);
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
      if(request.kind==='REFRESH'&&!options.persist&&!changed&&!stale){const unchanged={...next,revision:row.revision};return this.authoritative(actor,this.view(unchanged),unchanged);}
      const committed=await this.repository.commit(actor,row.revision,next,request.idempotencyKey,hash);
      return this.authoritative(actor,this.view(committed),committed);
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
      const order=(quantity:string)=>({id,symbol,side:request.side,type:request.type,quantity,leverage:request.leverage,...(request.price?{price:request.price}:{}),...(request.protection?{protection:request.protection}:{}),
        // A reducing order keeps its type and its price; the engine checks
        // the side and the size against the named position itself.
        ...(request.reduceOnly?{reduceOnly:true,positionId:request.positionId}:{}),historical:!!request.candle});
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
