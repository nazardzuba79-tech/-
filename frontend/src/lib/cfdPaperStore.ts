export type CfdPaperSide = 'LONG' | 'SHORT';
export type CfdPaperStatus = 'OPEN' | 'CLOSED';

export interface CfdPaperPosition {
  id:string;
  symbol:string;
  side:CfdPaperSide;
  size:string;
  entryPrice:string;
  leverage:number;
  initialMargin:string;
  liquidationPrice:string|null;
  status:'OPEN';
  openedAt:number;
}

export interface CfdPaperHistory extends Omit<CfdPaperPosition,'status'> {
  status:'CLOSED';
  closePrice:string;
  realizedPnl:string;
  closedAt:number;
}

interface CfdPaperState { open:CfdPaperPosition[]; history:CfdPaperHistory[]; }
const KEY='voltex_cfd_practice_v1';
const EVENT='voltex-cfd-practice-change';
const empty=():CfdPaperState=>({open:[],history:[]});
const finitePositive=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>0;
const finite=(value:unknown)=>Number.isFinite(Number(value));

function validOpen(raw:any):raw is CfdPaperPosition{
  return raw&&typeof raw==='object'&&typeof raw.id==='string'&&raw.id.length>0&&typeof raw.symbol==='string'&&raw.symbol.length>0
    &&(raw.side==='LONG'||raw.side==='SHORT')&&finitePositive(raw.size)&&finitePositive(raw.entryPrice)
    &&Number.isInteger(raw.leverage)&&raw.leverage>0&&finitePositive(raw.initialMargin)
    &&(raw.liquidationPrice===null||finitePositive(raw.liquidationPrice))&&raw.status==='OPEN'
    &&Number.isFinite(raw.openedAt)&&raw.openedAt>0;
}
function validHistory(raw:any):raw is CfdPaperHistory{
  return raw&&typeof raw==='object'&&typeof raw.id==='string'&&raw.id.length>0&&typeof raw.symbol==='string'&&raw.symbol.length>0
    &&(raw.side==='LONG'||raw.side==='SHORT')&&finitePositive(raw.size)&&finitePositive(raw.entryPrice)
    &&Number.isInteger(raw.leverage)&&raw.leverage>0&&finitePositive(raw.initialMargin)
    &&(raw.liquidationPrice===null||finitePositive(raw.liquidationPrice))&&raw.status==='CLOSED'
    &&finitePositive(raw.closePrice)&&finite(raw.realizedPnl)&&Number.isFinite(raw.openedAt)&&raw.openedAt>0
    &&Number.isFinite(raw.closedAt)&&raw.closedAt>=raw.openedAt;
}

function readState():CfdPaperState{
  if(typeof window==='undefined')return empty();
  try{
    const raw=window.localStorage.getItem(KEY);if(!raw)return empty();
    const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object')return empty();
    return{
      open:Array.isArray(parsed.open)?parsed.open.filter(validOpen).slice(0,100):[],
      history:Array.isArray(parsed.history)?parsed.history.filter(validHistory).slice(0,200):[],
    };
  }catch{return empty();}
}
function writeState(state:CfdPaperState){
  if(typeof window==='undefined')return;
  try{window.localStorage.setItem(KEY,JSON.stringify(state));window.dispatchEvent(new Event(EVENT));}catch{}
}
function id(){return globalThis.crypto?.randomUUID?.()??`paper-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;}

export function getCfdPaperState():CfdPaperState{
  const state=readState();return{open:state.open.map(p=>({...p})),history:state.history.map(p=>({...p}))};
}

export function openCfdPaperPosition(params:{symbol:string;side:'BUY'|'SELL';quantity:number;price:number;leverage:number;initialMargin:number;liquidationPrice:number|null}):CfdPaperPosition{
  for(const value of [params.quantity,params.price,params.initialMargin])if(!Number.isFinite(value)||value<=0)throw new Error('invalid_practice_order');
  if(!Number.isInteger(params.leverage)||params.leverage<=0)throw new Error('invalid_practice_order');
  const position:CfdPaperPosition={
    id:id(),symbol:params.symbol,side:params.side==='BUY'?'LONG':'SHORT',size:String(params.quantity),entryPrice:String(params.price),
    leverage:params.leverage,initialMargin:String(params.initialMargin),liquidationPrice:params.liquidationPrice&&params.liquidationPrice>0?String(params.liquidationPrice):null,
    status:'OPEN',openedAt:Date.now(),
  };
  const state=readState();state.open=[position,...state.open].slice(0,100);writeState(state);return{...position};
}

export function closeCfdPaperPosition(positionId:string,markPrice:number):CfdPaperHistory{
  if(!Number.isFinite(markPrice)||markPrice<=0)throw new Error('price_unavailable');
  const state=readState(),index=state.open.findIndex(p=>p.id===positionId);if(index<0)throw new Error('position_not_found');
  const position=state.open[index],size=Number(position.size),entry=Number(position.entryPrice);
  const pnl=(position.side==='LONG'?markPrice-entry:entry-markPrice)*size;
  const closed:CfdPaperHistory={...position,status:'CLOSED',closePrice:String(markPrice),realizedPnl:String(pnl),closedAt:Date.now()};
  state.open.splice(index,1);state.history=[closed,...state.history].slice(0,200);writeState(state);return{...closed};
}

export function subscribeCfdPaperStore(listener:()=>void):()=>void{
  if(typeof window==='undefined')return()=>{};
  const custom=()=>listener();
  const storage=(event:StorageEvent)=>{if(event.key===KEY)listener();};
  window.addEventListener(EVENT,custom);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(EVENT,custom);window.removeEventListener('storage',storage);};
}
