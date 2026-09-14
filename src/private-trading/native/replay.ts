import BigNumber from 'bignumber.js';
import { amount, decimal } from '../math';
import type { Candle } from '../types';
import { closeDemoPosition, DemoEngineError, demoAccount, DemoInstrument, DemoOrderInput, DemoProtection, DemoState,
  emptyDemoState, evaluateDemoRiskAndProtection, executeDemoBook, fillDemoOrder, markDemoAccount,
  NATIVE_DEMO_MODEL, placeDemoOrder, protectDemoPosition, registerDemoInstrument, setDemoLeverage, settleDemoFunding, cancelDemoOrder } from './engine';
const D=BigNumber.clone({DECIMAL_PLACES:36,ROUNDING_MODE:BigNumber.ROUND_HALF_EVEN,EXPONENTIAL_AT:100});
const n=(v:string)=>decimal(v), f=(v:BigNumber)=>amount(v);
export interface ReplayBar { time:number; intervalMs:number; trade:Candle; mark:Candle }
export type NativeInstruction = {id:string;at:number} & (
  | {kind:'OPEN';order:DemoOrderInput;instrument:DemoInstrument;mark:string;last:string;point?:string;book?:{bids:{price:string;quantity:string}[];asks:{price:string;quantity:string}[];timestamp:number};candle?:{source:'BYBIT_LINEAR';interval:string;openTime:number;pricePoint:'OPEN'|'CLOSE'}}
  | {kind:'CLOSE';positionId:string;quantity?:string;price:string;book?:{bids:{price:string;quantity:string}[];asks:{price:string;quantity:string}[];timestamp:number};candle?:{source:'BYBIT_LINEAR';interval:string;openTime:number;pricePoint:'OPEN'|'CLOSE'}}
  | {kind:'CANCEL';orderId:string}
  | {kind:'PROTECTION';positionId:string;protection:Partial<DemoProtection>}
  | {kind:'LEVERAGE';positionId:string;leverage:string}
);
interface Tick {time:number;symbol:string;mark:string;last:string;boundary:boolean}
function validateBar(b:ReplayBar) {
  if(!Number.isSafeInteger(b.time)||b.time<0||![60000,300000,900000,3600000].includes(b.intervalMs))throw new DemoEngineError('INVALID_BAR_TIME');
  for(const c of [b.trade,b.mark]){
    for(const v of [c.open,c.high,c.low,c.close])if(!n(v).gt(0))throw new DemoEngineError('INVALID_BAR_PRICE');
    if(c.timestamp!==b.time||n(c.high).lt(D.maximum(c.open,c.close,c.low))||n(c.low).gt(D.minimum(c.open,c.close,c.high)))throw new DemoEngineError('INVALID_OHLC');
  }
}
/** Each candle is an explicit assumed O-L-H-C path, not a claimed tick reconstruction. */
function path(b:ReplayBar,symbol:string):Tick[]{
  return (['open','low','high','close'] as const).map((point,i)=>({symbol,time:b.time+[0,Math.floor(b.intervalMs/3),Math.floor(b.intervalMs*2/3),b.intervalMs-1][i],mark:b.mark[point],last:b.trade[point],boundary:i===0}));
}
function crossed(start:string,end:string,target:string){return n(target).gte(D.minimum(start,end))&&n(target).lte(D.maximum(start,end))&&!n(start).eq(end);}
function ratio(start:string,end:string,target:string){return n(target).minus(start).div(n(end).minus(start));}
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
      for(const o of s.orders.filter(o=>o.symbol===to.symbol&&o.type==='LIMIT'&&['OPEN','PARTIALLY_FILLED'].includes(o.status)))if(o.price)include(from.last,to.last,o.price);
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
    for(const o of s.orders.filter(o=>points.some(p=>p.to.symbol===o.symbol)&&o.type==='LIMIT'&&['OPEN','PARTIALLY_FILLED'].includes(o.status))){
      const last=s.marks[o.symbol].last;
      if(o.price&&(o.side==='LONG'?n(last).lte(o.price):n(last).gte(o.price))){
        try {fillDemoOrder(s,o.id,o.remaining,last,at,'OHLC_PATH_MODEL',true);}
        catch(e){if(e instanceof DemoEngineError&&['INSUFFICIENT_FILL_MARGIN','POSITION_NOT_OPEN'].includes(e.code))cancelDemoOrder(s,o.id,at);else throw e;}
      }
    }
    evaluateDemoRiskAndProtection(s,at);previous=r;
  }
}
export function replayNativeDemo(input:{deposit:string;instructions:NativeInstruction[];bars:Record<string,ReplayBar[]>;asOf:number;latest?:Record<string,{mark:string;last:string;time:number}>}):DemoState {
  if(input.instructions.length>500)throw new DemoEngineError('COMMAND_LIMIT');
  const commands=[...input.instructions].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  const first=commands[0]?.at??input.asOf;
  if(!Number.isSafeInteger(input.asOf)||first>input.asOf)throw new DemoEngineError('INVALID_AS_OF');
  const s=emptyDemoState(input.deposit,first),ids=new Set<string>(),ticks:Tick[]=[];
  for(const c of commands){if(ids.has(c.id)||!Number.isSafeInteger(c.at)||c.at<0||c.at>input.asOf)throw new DemoEngineError('INVALID_COMMAND_ID_OR_TIME');ids.add(c.id);if(c.kind==='OPEN')registerDemoInstrument(s,c.instrument);}
  for(const[symbol,bars]of Object.entries(input.bars)){
    if(bars.length>50000)throw new DemoEngineError('HISTORY_LIMIT');const seen=new Set<number>();
    for(const b of bars){validateBar(b);if(seen.has(b.time))throw new DemoEngineError('DUPLICATE_BAR');seen.add(b.time);if(b.time+b.intervalMs<=input.asOf)ticks.push(...path(b,symbol).filter(t=>t.time>=first));}
  }
  // Gaps are errors for an active span: never skip unobserved liquidation/funding and report VERIFIED.
  for(const c of commands.filter((c):c is Extract<NativeInstruction,{kind:'OPEN'}>=>c.kind==='OPEN'&&!!c.order.historical)){
    const bars=input.bars[c.order.symbol]??[];const times=new Set(bars.map(b=>b.time));
    const close=commands.find(x=>x.kind==='CLOSE'&&x.positionId===c.order.id&&x.quantity===undefined&&x.at>=c.at);
    const end=Math.min(close?.at??input.asOf,input.asOf);
    const step=bars[0]?.intervalMs??60000;
    for(let t=Math.floor(c.at/step)*step;t+step<=end;t+=step)if(!times.has(t))throw new DemoEngineError('HISTORY_GAP');
  }
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
    while(cursor<commands.length&&commands[cursor].at===time){
      const c=commands[cursor++];
      if(c.kind==='OPEN'){
        markDemoAccount(s,{[c.order.symbol]:{mark:c.mark,last:c.last}},time);
        const o=placeDemoOrder(s,c.order,time);
        if(c.point!==undefined)fillDemoOrder(s,o.id,o.remaining,c.point,time,'SELECTED_POINT');
        else if(c.book)executeDemoBook(s,o.id,c.book,time);
        else if(o.type==='MARKET')throw new DemoEngineError('EXECUTION_PRICE_MISSING');
      }else if(c.kind==='CLOSE'){
        if(c.book){
          const p=s.positions.find(p=>p.id===c.positionId&&p.status==='OPEN');if(!p)throw new DemoEngineError('POSITION_NOT_OPEN');
          const o=placeDemoOrder(s,{id:c.id,symbol:p.symbol,side:p.side==='LONG'?'SHORT':'LONG',type:'MARKET',quantity:c.quantity??p.quantity,leverage:p.leverage,reduceOnly:true,positionId:p.id},time);
          executeDemoBook(s,o.id,c.book,time);
        }else closeDemoPosition(s,c.positionId,c.quantity,c.price,time);
      }
      else if(c.kind==='CANCEL')cancelDemoOrder(s,c.orderId,time);
      else if(c.kind==='PROTECTION')protectDemoPosition(s,c.positionId,c.protection,time);
      else setDemoLeverage(s,c.positionId,c.leverage,time);
    }
    if(boundary)for(const t of group){
      for(const o of s.orders.filter(o=>o.symbol===t.symbol&&o.type==='LIMIT'&&['OPEN','PARTIALLY_FILLED'].includes(o.status))){
        if(o.price&&(o.side==='LONG'?n(t.last).lte(o.price):n(t.last).gte(o.price)))fillDemoOrder(s,o.id,o.remaining,t.last,time,'OHLC_PATH_MODEL',true);
      }
    }
  }
  if(input.latest){
    const fresh:Record<string,{mark:string;last:string}>={};
    for(const[symbol,q]of Object.entries(input.latest)){
      if(input.asOf-q.time>5000||q.time>input.asOf+1000)throw new DemoEngineError('LATEST_MARK_STALE');fresh[symbol]=q;
    }
    markDemoAccount(s,fresh,input.asOf);evaluateDemoRiskAndProtection(s,input.asOf,'LIVE_QUOTE_MODEL');
  }
  demoAccount(s);return s;
}
