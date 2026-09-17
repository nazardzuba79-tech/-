import BigNumber from 'bignumber.js';
import { createHash } from 'crypto';
import { amount, decimal } from '../math';
import type { Candle } from '../types';
import { closeDemoPosition, DemoEngineError, demoAccount, DemoInstrument, DemoOrderInput, DemoProtection, DemoState,
  emptyDemoState, evaluateDemoRiskAndProtection, executeDemoBook, fillDemoOrder, markDemoAccount,
  NATIVE_DEMO_MODEL, placeDemoOrder, protectDemoPosition, registerDemoInstrument, setDemoLeverage, settleDemoFunding, cancelDemoOrder } from './engine';
const D=BigNumber.clone({DECIMAL_PLACES:36,ROUNDING_MODE:BigNumber.ROUND_HALF_EVEN,EXPONENTIAL_AT:100});
const n=(v:string)=>decimal(v), f=(v:BigNumber)=>amount(v);
const MINUTE=60_000, DAY=86_400_000;
export const NATIVE_COMMAND_LIMIT=2000;
/** Distinct contracts that may carry exposure (positions or resting orders) at the same time. */
export const NATIVE_MAX_CONCURRENT_CONTRACTS=6;
export interface ReplayBar { time:number; intervalMs:number; trade:Candle; mark:Candle }
export type NativeBook={bids:{price:string;quantity:string}[];asks:{price:string;quantity:string}[];timestamp:number};
export type NativeCandleRef={source:'BYBIT_LINEAR';interval:string;openTime:number;pricePoint:'OPEN'|'CLOSE'};
export type NativeInstruction = {id:string;at:number} & (
  | {kind:'OPEN';order:DemoOrderInput;instrument:DemoInstrument;mark:string;last:string;point?:string;maker?:boolean;book?:NativeBook;candle?:NativeCandleRef}
  | {kind:'CLOSE';positionId:string;quantity?:string;price:string;book?:NativeBook;candle?:NativeCandleRef}
  | {kind:'CANCEL';orderId:string}
  | {kind:'PROTECTION';positionId:string;protection:Partial<DemoProtection>}
  | {kind:'LEVERAGE';positionId:string;leverage:string}
  /** A live quote that actually triggered TP/SL/liquidation. Journaled so a later replay can never undo it. */
  | {kind:'OBSERVE';marks:Record<string,{mark:string;last:string}>}
);
/** Canonical state after every event strictly before `time`; `digest` pins which instructions it contains. */
export interface NativeCheckpoint { time:number; digest:string; state:DemoState }
export interface BarRequest { symbol:string; start:number; end:number; intervalMs:number }
export interface ReplayResolution { intervalMs:number; windowMs:number }
export interface ReplayInput {
  deposit:string; instructions:NativeInstruction[]; asOf:number;
  /** Exclusive canonical boundary. Only complete bars ending at or before it are consumed. */
  until?:number;
  checkpoint?:NativeCheckpoint|null;
  latest?:Record<string,{mark:string;last:string;time:number}>;
  /** Resolution rule; the default is age-tiered relative to `asOf`. */
  resolution?:(cursor:number,asOf:number)=>ReplayResolution & {eraEnd:number};
}
export interface ReplayResult { snapshot:DemoState; checkpoint:NativeCheckpoint; observed:null|Record<string,{mark:string;last:string}> }
interface Tick {time:number;symbol:string;mark:string;last:string;boundary:boolean}

/**
 * Deterministic resolution tiers. Recent history keeps 1-minute paths; older spans use coarser
 * assumed OHLC paths so a long-lived or far-back scenario remains computable.
 */
export function defaultResolution(cursor:number,asOf:number):ReplayResolution & {eraEnd:number}{
  const fine=Math.floor((asOf-7*DAY)/DAY)*DAY, medium=Math.floor((asOf-45*DAY)/DAY)*DAY;
  if(cursor>=fine)return{intervalMs:MINUTE,windowMs:DAY,eraEnd:Number.MAX_SAFE_INTEGER};
  if(cursor>=medium)return{intervalMs:15*MINUTE,windowMs:7*DAY,eraEnd:fine};
  return{intervalMs:60*MINUTE,windowMs:30*DAY,eraEnd:medium};
}
function validateBar(b:ReplayBar) {
  if(!Number.isSafeInteger(b.time)||b.time<0||![60000,300000,900000,3600000].includes(b.intervalMs)||b.time%b.intervalMs!==0)throw new DemoEngineError('INVALID_BAR_TIME');
  for(const c of [b.trade,b.mark]){
    for(const v of [c.open,c.high,c.low,c.close])if(!n(v).gt(0))throw new DemoEngineError('INVALID_BAR_PRICE');
    if(c.timestamp!==b.time||n(c.high).lt(D.maximum(c.open,c.close,c.low))||n(c.low).gt(D.minimum(c.open,c.close,c.high)))throw new DemoEngineError('INVALID_OHLC');
  }
}
/** Each candle is an explicit assumed O-L-H-C path, not a claimed tick reconstruction. */
export function ohlcPathOffsets(intervalMs:number){return[0,Math.floor(intervalMs/3),Math.floor(intervalMs*2/3),intervalMs-1];}
function path(b:ReplayBar,symbol:string):Tick[]{
  const offsets=ohlcPathOffsets(b.intervalMs);
  return (['open','low','high','close'] as const).map((point,i)=>({symbol,time:b.time+offsets[i],mark:b.mark[point],last:b.trade[point],boundary:i===0}));
}
function crossed(start:string,end:string,target:string){return n(target).gte(D.minimum(start,end))&&n(target).lte(D.maximum(start,end))&&!n(start).eq(end);}
function ratio(start:string,end:string,target:string){return n(target).minus(start).div(n(end).minus(start));}
const activeOrder=(o:{status:string})=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED';
/** A resting limit never fills beyond its own price because of interpolation rounding. */
const bounded=(side:'LONG'|'SHORT',price:string,limit:string)=>f(side==='LONG'?D.minimum(price,limit):D.maximum(price,limit));
/** Interpolate ONLY inside the declared hypothetical path; do not publish these as actual market ticks. */
function segment(s:DemoState,group:Tick[]) {
  const time=group[0]?.time;if(time===undefined)return;
  const start=s.time;
  const points=group.filter(t=>!!s.marks[t.symbol]).map(to=>({to,from:{...s.marks[to.symbol]}}));
  const lerp=(a:string,b:string,r:BigNumber)=>f(n(a).plus(n(b).minus(a).times(r)).decimalPlaces(18,BigNumber.ROUND_HALF_EVEN));
  const values=(r:BigNumber)=>Object.fromEntries(points.map(({to,from})=>[to.symbol,{mark:lerp(from.mark,to.mark,r),last:lerp(from.last,to.last,r)}]));
  let previous=new D(0),initial=true,iterations=0;
  while(previous.lt(1)||initial){
    if(++iterations>2000)throw new DemoEngineError('SEGMENT_EVENT_LIMIT');
    // A limit fill can install a TP/SL inside this same segment. Rebuild the
    // candidate set after each event rather than jumping to the candle extreme.
    const candidates:BigNumber[]=[new D(1)];
    const include=(a:string,b:string,target:string)=>{if(crossed(a,b,target)){const r=ratio(a,b,target);if(r.gt(previous)||(initial&&r.eq(previous)))candidates.push(r);}};
    for(const {to,from} of points){
      for(const o of s.orders.filter(o=>o.symbol===to.symbol&&o.type==='LIMIT'&&activeOrder(o)))if(o.price)include(from.last,to.last,o.price);
      for(const p of s.positions.filter(p=>p.symbol===to.symbol&&p.status==='OPEN')){
        const a=p.protection.triggerBy==='MARK'?from.mark:from.last,b=p.protection.triggerBy==='MARK'?to.mark:to.last;
        for(const trigger of [p.protection.takeProfit,p.protection.stopLoss])if(trigger!==null)include(a,b,trigger);
      }
    }
    const r=candidates.sort((a,b)=>a.comparedTo(b)??0)[0];initial=false;
    // Whole-portfolio risk is evaluated with simultaneous marks, independent of symbol insertion order.
    const probe={...s,positions:s.positions.map(p=>({...p})),marks:{...s.marks}};markDemoAccount(probe,values(r),time);
    if(!demoAccount(s).liquidatable&&demoAccount(probe).liquidatable){
      let lo=previous,hi=r;
      for(let i=0;i<80;i++){
        const mid=lo.plus(hi).div(2),candidate={...s,positions:s.positions.map(p=>({...p})),marks:{...s.marks}};markDemoAccount(candidate,values(mid),time);
        if(demoAccount(candidate).liquidatable)hi=mid;else lo=mid;
      }
      const at=Math.max(s.time,Math.round(start+(time-start)*hi.toNumber()));
      markDemoAccount(s,values(hi),at);evaluateDemoRiskAndProtection(s,at);
    }
    const at=Math.max(s.time,Math.round(start+(time-start)*r.toNumber()));
    markDemoAccount(s,values(r),at);evaluateDemoRiskAndProtection(s,at);
    for(const o of s.orders.filter(o=>points.some(p=>p.to.symbol===o.symbol)&&o.type==='LIMIT'&&activeOrder(o))){
      const last=s.marks[o.symbol].last;
      if(o.price&&(o.side==='LONG'?n(last).lte(o.price):n(last).gte(o.price))){
        try {fillDemoOrder(s,o.id,o.remaining,bounded(o.side,last,o.price),at,'OHLC_PATH_MODEL',true);}
        catch(e){if(e instanceof DemoEngineError&&['INSUFFICIENT_FILL_MARGIN','POSITION_NOT_OPEN'].includes(e.code))cancelDemoOrder(s,o.id,at);else throw e;}
      }
    }
    evaluateDemoRiskAndProtection(s,at);previous=r;
  }
}
const idsDigest=(ids:string[])=>createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
export function instructionDigest(instructions:NativeInstruction[],before:number){return idsDigest(instructions.filter(c=>c.at<before).map(c=>c.id));}
function exposedSymbols(s:DemoState){
  return new Set([...s.positions.filter(p=>p.status==='OPEN').map(p=>p.symbol),...s.orders.filter(activeOrder).map(o=>o.symbol)]);
}
function sortInstructions(input:NativeInstruction[]){
  if(input.length>NATIVE_COMMAND_LIMIT)throw new DemoEngineError('COMMAND_LIMIT');
  const ids=new Set<string>();
  for(const c of input){if(!c.id||ids.has(c.id)||!Number.isSafeInteger(c.at)||c.at<0)throw new DemoEngineError('INVALID_COMMAND_ID_OR_TIME');ids.add(c.id);}
  return [...input].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
function apply(s:DemoState,c:NativeInstruction,time:number){
  if(c.kind==='OPEN'){
    registerDemoInstrument(s,c.instrument);
    const exposed=exposedSymbols(s);exposed.add(c.order.symbol);
    if(exposed.size>NATIVE_MAX_CONCURRENT_CONTRACTS)throw new DemoEngineError('CONTRACT_LIMIT');
    markDemoAccount(s,{[c.order.symbol]:{mark:c.mark,last:c.last}},time);
    const o=placeDemoOrder(s,c.order,time);
    if(c.point!==undefined)fillDemoOrder(s,o.id,o.remaining,c.point,time,'SELECTED_POINT',c.maker===true);
    else if(c.book)executeDemoBook(s,o.id,c.book,time);
    else if(o.type==='MARKET')throw new DemoEngineError('EXECUTION_PRICE_MISSING');
  }else if(c.kind==='CLOSE'){
    if(c.book){
      const p=s.positions.find(p=>p.id===c.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
      /**
       * A close is risk-REDUCING. The position can legitimately have been
       * opened at 10x while its current notional later grows into a tier whose
       * entry ceiling is 5x. Reusing p.leverage here made the admission check
       * reject the EXIT with TIER_LEVERAGE_EXCEEDED. Leverage has no economic
       * role on a reduce-only IOC (reserve is zero; fill only settles quantity),
       * so use the contract minimum solely as the validation value. The open
       * position keeps its real leverage and every P&L/margin figure unchanged.
       */
      const closeLeverage=s.instruments[p.symbol]?.rules.minLeverage;
      if(!closeLeverage)throw new DemoEngineError('INSTRUMENT_MISSING');
      const o=placeDemoOrder(s,{id:c.id,symbol:p.symbol,side:p.side==='LONG'?'SHORT':'LONG',type:'MARKET',quantity:c.quantity??p.quantity,leverage:closeLeverage,reduceOnly:true,positionId:p.id,marginType:p.marginType},time);
      executeDemoBook(s,o.id,c.book,time);
    }else closeDemoPosition(s,c.positionId,c.quantity,c.price,time);
  }
  else if(c.kind==='CANCEL')cancelDemoOrder(s,c.orderId,time);
  else if(c.kind==='PROTECTION')protectDemoPosition(s,c.positionId,c.protection,time);
  else if(c.kind==='LEVERAGE')setDemoLeverage(s,c.positionId,c.leverage,time);
  else if(c.kind==='OBSERVE'){markDemoAccount(s,c.marks,time);evaluateDemoRiskAndProtection(s,time,'LIVE_QUOTE_MODEL');}
}
function checkCoverage(bars:ReplayBar[],request:BarRequest){
  if(bars.length>50000)throw new DemoEngineError('HISTORY_LIMIT');
  const sorted=[...bars].sort((a,b)=>a.time-b.time);let expected=request.start;
  for(const b of sorted){validateBar(b);if(b.intervalMs!==request.intervalMs||b.time!==expected)throw new DemoEngineError(b.time<expected?'DUPLICATE_BAR':'HISTORY_GAP');expected+=b.intervalMs;}
  if(expected!==request.end)throw new DemoEngineError('HISTORY_GAP');
  return sorted;
}
function processGroups(s:DemoState,ticks:Tick[],commands:NativeInstruction[]){
  const groups=new Map<number,Tick[]>();for(const t of ticks){const g=groups.get(t.time)??[];g.push(t);groups.set(t.time,g);}
  for(const c of commands)if(!groups.has(c.at))groups.set(c.at,[]);
  let cursor=0;
  for(const time of [...groups.keys()].sort((a,b)=>a-b)){
    const group=groups.get(time)!.sort((a,b)=>a.symbol.localeCompare(b.symbol));
    // Funding uses the simultaneous marks at this boundary, not a mixture of old/new symbols.
    const boundary=group.some(t=>t.boundary);
    if(boundary){
      markDemoAccount(s,Object.fromEntries(group.map(t=>[t.symbol,{mark:t.mark,last:t.last}])),time);
      if(time%NATIVE_DEMO_MODEL.funding.intervalMs===0)settleDemoFunding(s,time);
      evaluateDemoRiskAndProtection(s,time);
    }else segment(s,group);
    while(cursor<commands.length&&commands[cursor].at===time)apply(s,commands[cursor++],time);
    if(boundary)for(const t of group){
      for(const o of s.orders.filter(o=>o.symbol===t.symbol&&o.type==='LIMIT'&&activeOrder(o))){
        // Marketable at its own placement moment = taker; resting until this boundary = maker.
        if(o.price&&(o.side==='LONG'?n(t.last).lte(o.price):n(t.last).gte(o.price)))fillDemoOrder(s,o.id,o.remaining,t.last,time,'OHLC_PATH_MODEL',o.createdAt!==time);
      }
    }
  }
  if(cursor!==commands.length)throw new DemoEngineError('INSTRUCTION_ORDER');
}
/**
 * Replay kernel as a generator: it yields the history windows it needs and receives complete bars.
 * The same kernel is driven synchronously (fixtures) and asynchronously (collector history).
 */
export function* nativeReplay(input:ReplayInput):Generator<BarRequest,ReplayResult,ReplayBar[]>{
  const commands=sortInstructions(input.instructions);
  if(!Number.isSafeInteger(input.asOf)||commands.some(c=>c.at>input.asOf))throw new DemoEngineError('INVALID_AS_OF');
  const until=input.until??Math.floor(input.asOf/MINUTE)*MINUTE;
  if(!Number.isSafeInteger(until)||until>input.asOf||until%MINUTE!==0)throw new DemoEngineError('INVALID_AS_OF');
  const resolution=input.resolution??defaultResolution;
  let s:DemoState,cursor:number;
  if(input.checkpoint){
    const cp=input.checkpoint;
    if(!Number.isSafeInteger(cp.time)||cp.time>until||instructionDigest(commands,cp.time)!==cp.digest)throw new DemoEngineError('CHECKPOINT_MISMATCH');
    s=structuredClone(cp.state);cursor=cp.time;
  }else{
    const first=commands[0]?.at??until;cursor=Math.min(first,until);s=emptyDemoState(input.deposit,cursor);
  }
  const pending=commands.filter(c=>c.at>=cursor);let next=0;
  while(cursor<until){
    const exposed=exposedSymbols(s);
    if(!exposed.size){
      // Nothing can change while there is no exposure: jump to the next instruction.
      const at=pending[next]?.at;
      if(at===undefined||at>=until){cursor=until;break;}
      if(at>cursor)cursor=at;
    }
    const tier=resolution(cursor,input.asOf);
    let end=Math.min(until,tier.eraEnd,(Math.floor(cursor/tier.windowMs)+1)*tier.windowMs);
    if(end%tier.intervalMs!==0)end=Math.floor(end/tier.intervalMs)*tier.intervalMs;
    if(end<=cursor)throw new DemoEngineError('INVALID_REPLAY_WINDOW');
    const inWindow:NativeInstruction[]=[];
    while(next<pending.length&&pending[next].at<end)inWindow.push(pending[next++]);
    const symbols=new Set(exposed);
    for(const c of inWindow)if(c.kind==='OPEN')symbols.add(c.order.symbol);
    const ticks:Tick[]=[];
    for(const symbol of [...symbols].sort()){
      const request={symbol,start:Math.floor(cursor/tier.intervalMs)*tier.intervalMs,end,intervalMs:tier.intervalMs};
      const bars=checkCoverage(yield request,request);
      for(const b of bars)ticks.push(...path(b,symbol).filter(t=>t.time>=cursor));
    }
    processGroups(s,ticks,inWindow);
    cursor=end;
  }
  const checkpoint:NativeCheckpoint={time:until,digest:instructionDigest(commands,until),state:structuredClone(s)};
  // Instructions inside the still-forming minute are re-applied on every replay until their minute closes.
  processGroups(s,[],pending.slice(next));
  const observed=input.latest?applyLatestQuotes(s,input.latest,input.asOf):null;
  demoAccount(s);
  return{snapshot:s,checkpoint,observed};
}
/**
 * Values the projected snapshot at fresh live quotes. When those quotes trigger TP/SL/liquidation the
 * marks are returned: the caller MUST journal them as an OBSERVE instruction at `asOf` (identical effect).
 */
export function applyLatestQuotes(s:DemoState,latest:Record<string,{mark:string;last:string;time:number}>,asOf:number):ReplayResult['observed']{
  const fresh:Record<string,{mark:string;last:string}>={};
  for(const[symbol,q]of Object.entries(latest)){
    if(asOf-q.time>5000||q.time>asOf+1000)throw new DemoEngineError('LATEST_MARK_STALE');fresh[symbol]={mark:q.mark,last:q.last};
  }
  if(!Object.keys(fresh).length)return null;
  const signature=()=>JSON.stringify([s.events.length,s.positions.map(p=>[p.status,p.quantity])]),before=signature();
  markDemoAccount(s,fresh,asOf);evaluateDemoRiskAndProtection(s,asOf,'LIVE_QUOTE_MODEL');
  return signature()!==before?fresh:null;
}
export async function replayNativeDemoAsync(input:ReplayInput,load:(request:BarRequest)=>Promise<ReplayBar[]>):Promise<ReplayResult>{
  const run=nativeReplay(input);let step=run.next();
  while(!step.done)step=run.next(await load(step.value));
  return step.value;
}
/** Synchronous fixture driver: every requested window must be fully present in `bars`. */
export function replayNativeDemoWithBars(input:ReplayInput&{bars:Record<string,ReplayBar[]>}):ReplayResult{
  const fixed=(_cursor:number,_asOf:number)=>{
    const interval=Object.values(input.bars).flat()[0]?.intervalMs??MINUTE;
    return{intervalMs:interval,windowMs:30*DAY,eraEnd:Number.MAX_SAFE_INTEGER};
  };
  const run=nativeReplay({...input,resolution:input.resolution??fixed});
  let step=run.next();
  while(!step.done){const r=step.value;step=run.next((input.bars[r.symbol]??[]).filter(b=>b.time>=r.start&&b.time<r.end));}
  return step.value;
}
/** Backwards-compatible full replay used by fixtures: returns the projected snapshot. */
export function replayNativeDemo(input:{deposit:string;instructions:NativeInstruction[];bars:Record<string,ReplayBar[]>;asOf:number;latest?:Record<string,{mark:string;last:string;time:number}>}):DemoState{
  return replayNativeDemoWithBars(input).snapshot;
}
/**
 * OHLC-only rule for a limit placed on a selected historical candle (owner rule):
 * Buy Limit is eligible when Low <= limit, Sell Limit when High >= limit. A limit that is already
 * marketable at the candle open fills at the open as taker. Otherwise it fills at the limit, at the
 * moment the assumed O-L-H-C path first reaches it, as maker. Simulation, not a claimed venue fill.
 */
export function historicalLimitTouch(side:'LONG'|'SHORT',limitPrice:string,candle:{open:string;high:string;low:string;close:string},openTime:number,intervalMs:number):
  null|{at:number;price:string;maker:boolean}{
  const limit=decimal(limitPrice,'limit_price',true),open=decimal(candle.open,'open',true),high=decimal(candle.high,'high',true),low=decimal(candle.low,'low',true);
  const [,toLow,toHigh]=ohlcPathOffsets(intervalMs);
  if(side==='LONG'){
    if(low.gt(limit))return null;
    if(open.lte(limit))return{at:openTime,price:f(open),maker:false};
    // open -> low leg
    return{at:openTime+Math.floor(open.minus(limit).div(open.minus(low)).times(toLow).toNumber()),price:f(limit),maker:true};
  }
  if(high.lt(limit))return null;
  if(open.gte(limit))return{at:openTime,price:f(open),maker:false};
  // open -> low leg cannot reach a sell limit above the open; low -> high leg does.
  return{at:openTime+toLow+Math.floor(limit.minus(low).div(high.minus(low)).times(toHigh-toLow).toNumber()),price:f(limit),maker:true};
}
