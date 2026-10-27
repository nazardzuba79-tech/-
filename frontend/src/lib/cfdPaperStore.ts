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

/** Read-only UI tolerates bad storage, but mutations must not erase positions
 * from an unreadable ledger or acknowledge a write that never persisted. */
function readState(forWrite=false):CfdPaperState{
  if(typeof window==='undefined'){
    if(forWrite)throw new Error('cfd_practice_storage_unavailable');
    return empty();
  }
  try{
    const raw=window.localStorage.getItem(KEY);if(!raw)return empty();
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.open)||!Array.isArray(parsed.history))throw new Error('Invalid CFD ledger');
    const open=parsed.open.filter(validOpen).slice(0,100);
    const history=parsed.history.filter(validHistory).slice(0,200);
    if(forWrite&&(open.length!==parsed.open.length||history.length!==parsed.history.length))throw new Error('Invalid CFD ledger entries');
    return{open,history};
  }catch{
    if(forWrite)throw new Error('cfd_practice_storage_unavailable');
    return empty();
  }
}
function writeState(state:CfdPaperState){
  if(typeof window==='undefined')throw new Error('cfd_practice_storage_unavailable');
  try{window.localStorage.setItem(KEY,JSON.stringify(state));}
  catch{throw new Error('cfd_practice_storage_unavailable');}
  // A notification error cannot undo a successful persistent write.
  try{window.dispatchEvent(new Event(EVENT));}catch{}
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
  const state=readState(true);state.open=[position,...state.open].slice(0,100);writeState(state);return{...position};
}

/** Ten decimals: below any quantity a ticket accepts, above the binary noise of a subtraction. */
const tidy=(value:number)=>String(Number(value.toFixed(10)));

/**
 * Close a practice position at `markPrice`: all of it, or `quantity` of it
 * (2026-10-15). A part is booked exactly as a whole close of that size — the
 * same P&L formula, `(mark − entry) × size` for a long — and takes its share
 * of the initial margin with it; the rest stays open at the same entry,
 * leverage and estimated liquidation price (an isolated position reduced in
 * proportion keeps its liquidation level). Without `quantity`, or with the
 * whole size, the close is the one this store always made.
 */
export function closeCfdPaperPosition(positionId:string,markPrice:number,quantity?:number):CfdPaperHistory{
  if(!Number.isFinite(markPrice)||markPrice<=0)throw new Error('price_unavailable');
  const state=readState(true),index=state.open.findIndex(p=>p.id===positionId);if(index<0)throw new Error('position_not_found');
  const position=state.open[index],size=Number(position.size),entry=Number(position.entryPrice);
  const partial=quantity!==undefined&&Number(tidy(quantity))!==size;
  if(quantity!==undefined&&(!Number.isFinite(quantity)||quantity<=0))throw new Error('invalid_close_quantity');
  if(partial&&Number(tidy(quantity!))>size)throw new Error('close_quantity_exceeds_position');
  if(!partial){
    const pnl=(position.side==='LONG'?markPrice-entry:entry-markPrice)*size;
    const closed:CfdPaperHistory={...position,status:'CLOSED',closePrice:String(markPrice),realizedPnl:String(pnl),closedAt:Date.now()};
    state.open.splice(index,1);state.history=[closed,...state.history].slice(0,200);writeState(state);return{...closed};
  }
  const part=Number(tidy(quantity!)),rest=Number(tidy(size-part));
  const margin=Number(position.initialMargin),partMargin=margin*part/size,restMargin=margin-partMargin;
  if(!(rest>0)||!(partMargin>0)||!(restMargin>0))throw new Error('invalid_close_quantity');
  const pnl=(position.side==='LONG'?markPrice-entry:entry-markPrice)*part;
  const closed:CfdPaperHistory={...position,id:id(),size:String(part),initialMargin:String(partMargin),status:'CLOSED',closePrice:String(markPrice),realizedPnl:String(pnl),closedAt:Date.now()};
  state.open[index]={...position,size:String(rest),initialMargin:String(restMargin)};
  state.history=[closed,...state.history].slice(0,200);writeState(state);return{...closed};
}

export function subscribeCfdPaperStore(listener:()=>void):()=>void{
  if(typeof window==='undefined')return()=>{};
  const custom=()=>listener();
  const storage=(event:StorageEvent)=>{if(event.key===KEY)listener();};
  window.addEventListener(EVENT,custom);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(EVENT,custom);window.removeEventListener('storage',storage);};
}
