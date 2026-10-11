import { applyQuote,submit,cancel,setBalances,active,snapshot,check } from './engine.mjs';

export const ACCOUNT_MUTATIONS=new Set(['quote','quoteFailed','submit','cancel','balances','observe','observeFailed','submitObserved']);
export const ACCOUNT_READS=new Set(['read','readView','interests']);

// Functions stay in this module/worker. No serialized callbacks, eval, SQL or
// client-selected account identifiers can cross the command boundary.
export function executeAccountCommand(state,type,input,now){
  switch(type){
    case 'quote':return applyQuote(state,input,now);
    case 'quoteFailed':{const id=typeof input==='string'?input:input?.id;check(typeof id==='string','INVALID_PAIR');if(state.quotes[id])state.quotes[id].failed=true;return;}
    case 'submit':return submit(state,input,now);
    case 'cancel':return cancel(state,typeof input==='string'?input:input?.id,now);
    case 'balances':return setBalances(state,input,now);
    case 'read':return snapshot(state,now);
    case 'interests':return [...new Set([...(typeof input?.selected==='string'?[input.selected]:[]),...state.orders.filter(active).map(o=>o.instrumentId),...Object.values(state.positions).filter(p=>Number(p.quantity)>0).map(p=>p.instrumentId)])];
    default:check(false,'ACCOUNT_COMMAND_INVALID');
  }
}
