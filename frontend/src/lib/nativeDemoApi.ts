import { getToken } from './api';
import { PrivateTradingError, type PrivateResultCard } from './privateTradingApi';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:string;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export interface NativeProtection {takeProfit:string|null;stopLoss:string|null;quantity:string|null;triggerBy:'MARK'|'LAST'}
export interface NativePosition {
  id:string;symbol:string;side:'LONG'|'SHORT';quantity:string;entryPrice:string;markPrice:string;lastPrice:string;leverage:string;
  status:'OPEN'|'CLOSED'|'LIQUIDATED';openedAt:number;closedAt:number|null;historical:boolean;
  unrealizedPnl:string;realizedPnl:string;netPnl:string;roiPercent:string|null;roiBasis:string;closedRoiBasis:string;fundingNet:string;
  protection:NativeProtection;
  /** Account-level Cross estimate (other contracts frozen). null = not reachable with current collateral, or fully hedged. */
  liquidationPrice:string|null;liquidationStatus:string;
}
export interface NativeOrder {id:string;symbol:string;side:string;type:string;quantity:string;remaining:string;filled:string;averagePrice:string|null;price:string|null;leverage:string;status:string;createdAt:number}
export interface NativeEvent {id:string;kind:string;time:number;positionId:string|null;orderId:string|null;symbol:string;quantity:string;price:string|null;fee:string;cashflow:string;pricing:string}
export interface NativeState {
  initialized:boolean;revision:number;source:'DEMO_BALANCE'|'PREVIEW_FIXTURE'|null;asOf:number|null;demoAvailable?:string|null;
  model:{version:string;funding:{longCashflow:string;shortCashflow:string;unit:string;intervalMs:number};fundingSource?:string;historicalLimit?:string;historyResolution?:string[]};
  account:null|{walletBalance:string;initialDeposit:string;unrealizedPnl:string;equity:string;usedMargin:string;orderReserve:string;available:string;maintenanceMargin:string;maintenanceRatio:string|null;liquidatable:boolean;deficit:string};
  positions:NativePosition[];history:NativePosition[];orders:NativeOrder[];events:NativeEvent[];
  entries?:{positionId:string;candle:NativeCandle|null}[];
}
export type NativeDraft=
 | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<NativeProtection>}
 | {kind:'CLOSE';positionId:string;quantity?:string;candle?:NativeCandle}
 | {kind:'CANCEL';orderId:string}
 | {kind:'PROTECTION';positionId:string;protection:Partial<NativeProtection>}
 | {kind:'LEVERAGE';positionId:string;leverage:string}
 | {kind:'REFRESH'};
export function createNativeDemoClient(base:string,token:()=>string|null,fetcher:typeof fetch=fetch){
  async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
    const bearer=token();if(!bearer)throw new PrivateTradingError('Войдите в аккаунт',401);
    const response=await fetcher(`${base.replace(/\/$/,'')}/private-trading${path}`,{method:body===undefined?'GET':'POST',signal,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json().catch(()=>null);if(token()!==bearer)throw new PrivateTradingError('Сессия завершена',401);
    if(!response.ok)throw new PrivateTradingError(typeof data?.error==='string'?data.error:'Демо-счёт временно недоступен',response.status);
    if(data===null)throw new PrivateTradingError('Сервер не подтвердил результат',502);return data;
  }
  return{
    access:(signal?:AbortSignal)=>request<{allowed:boolean;nativeAvailable?:boolean}>('/access',undefined,signal),
    state:(signal?:AbortSignal)=>request<NativeState>('/native/state',undefined,signal),
    initialize:(acceptedModel:string,idempotencyKey:string)=>request<NativeState>('/native/initialize',{acceptedModel,idempotencyKey}),
    command:(draft:NativeDraft,idempotencyKey:string)=>request<NativeState>('/native/commands',{...draft,idempotencyKey}),
    card:(positionId:string)=>request<PrivateResultCard>('/native/cards',{positionId}),
    getCard:(id:string)=>{const m=/^native:(\d+):(native-[a-zA-Z0-9-]+)$/.exec(id);if(!m)throw new PrivateTradingError('Карточка не найдена',404);return request<PrivateResultCard>(`/native/cards/${m[1]}/${m[2]}`);},
  };
}
export const nativeDemoApi=createNativeDemoClient(import.meta.env.VITE_API_URL||'/api/v1',getToken);
/** Signed fraction string -> percent text by decimal shifting (no floating point): '-0.001' -> '−0.1%'. */
export function nativeFundingPercent(value:string):string{
  const m=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);if(!m)return '—';
  const frac=`${m[3]??''}00`,whole=`${m[2]}${frac.slice(0,2)}`.replace(/^0+(?=\d)/,''),rest=frac.slice(2).replace(/0+$/,'');
  const body=rest?`${whole}.${rest}`:whole;
  if(/^0(?:\.0*)?$/.test(body))return '0%';
  return `${m[1]==='-'?'−':'+'}${body}%`;
}
