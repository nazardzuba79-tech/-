import type { NativeState } from './nativeDemoApi';

export const NATIVE_LIVE_POLL_MS=30_000;
export function shouldPollNativeLive(state:NativeState|null,hidden:boolean,pending:number){
  return !hidden&&pending===0&&!!state?.initialized&&(
    state.positions.some(p=>p.status==='OPEN'||!!p.pendingClose)
    ||state.orders.some(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED'));
}
/** Mutation receipts may contain history for legacy consumers; the live
 * terminal deliberately keeps it out of its warm cache and refresh state. */
export function compactNativeUiState(state:NativeState):NativeState{
  return{...state,historyDeferred:true,history:[],events:[],entries:[],
    orders:state.orders.filter(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED'),
    ledger:state.ledger?{...state.ledger,entries:[]}:null};
}
