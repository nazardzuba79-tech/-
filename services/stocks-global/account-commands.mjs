import { applyQuote,submit,cancel,setBalances,active,snapshot,check } from './engine.mjs';

export const ACCOUNT_MUTATIONS=new Set(['quote','quoteFailed','submit','cancel','balances','observe','observeFailed','observeBackground','observeFailedBackground','submitObserved']);
export const ACCOUNT_READS=new Set(['read','readView','portfolioView','interests']);

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

// Transport only paper holdings for Wallet; never orders, fills or spendable balances.
export function portfolioSnapshot(state, now) {
  const positions=Object.fromEntries(Object.entries(state.positions).filter(([,p])=>p.currency==='USDT'&&Number(p.quantity)>0));
  const ids=new Set(Object.values(positions).map(p=>p.instrumentId));
  const quotes=Object.fromEntries(Object.entries(state.quotes).filter(([id])=>ids.has(id)));
  const projected=snapshot({wallets:state.wallets,positions,quotes,orders:[]},now);
  return {schema:state.schema,revision:state.revision,serverTime:now,positions:projected.positions,quotes:projected.quotes};
}
