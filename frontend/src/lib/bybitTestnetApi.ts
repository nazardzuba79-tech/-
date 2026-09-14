import { getToken } from './api';

export interface TestnetStatus {
  configured:boolean;source:'BYBIT_TESTNET';accountType:'UNIFIED';executionHost:string;
}
export interface TestnetPosition {
  symbol:string;side:'Buy'|'Sell';size:string;avgPrice:string;markPrice:string;liqPrice:string;leverage:string;
  unrealisedPnl:string;cumRealisedPnl:string;positionValue:string;positionIM:string;positionMM:string;positionIdx:number;updatedTime?:string;
}
export interface TestnetOrder {
  orderId:string;orderLinkId:string;symbol:string;side:'Buy'|'Sell';orderType:string;price:string;qty:string;avgPrice:string;
  orderStatus:string;leavesQty:string;cumExecQty:string;reduceOnly:boolean;createdTime:string;updatedTime:string;
}
export interface TestnetState {
  source:'BYBIT_TESTNET';fetchedAt:number;
  wallet:null|{accountType:string;totalEquity:string;totalWalletBalance:string;totalMarginBalance:string;totalAvailableBalance:string;totalPerpUPL:string;coins:Array<{coin:string;equity:string;walletBalance:string;usdValue:string;unrealisedPnl:string;locked:string}>};
  positions:TestnetPosition[];openOrders:TestnetOrder[];orderHistory:TestnetOrder[];
  closedPnl:Array<{symbol:string;orderId:string;side:string;qty:string;avgEntryPrice:string;avgExitPrice:string;closedPnl:string;openFee:string;closeFee:string;createdTime:string;updatedTime:string}>;
}
export interface TestnetOrderRequest {
  symbol:string;side:'Buy'|'Sell';orderType:'Market'|'Limit';qty:string;price?:string;leverage?:string;takeProfit?:string;stopLoss?:string;reduceOnly?:boolean;
}
export class TestnetApiError extends Error { constructor(message:string,readonly status:number){super(message);this.name='TestnetApiError';} }

function createClient(base:string,token:()=>string|null,fetcher:typeof fetch=fetch){
  async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
    const bearer=token();if(!bearer)throw new TestnetApiError('Сессия завершена',401);
    const response=await fetcher(`${base.replace(/\/$/,'')}/private-trading/testnet${path}`,{
      method,signal,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json().catch(()=>null);
    if(token()!==bearer)throw new TestnetApiError('Сессия завершена',401);
    if(!response.ok)throw new TestnetApiError(typeof data?.error==='string'?data.error:'Bybit Testnet недоступен',response.status);
    return data as T;
  }
  return {
    status:(signal?:AbortSignal)=>request<TestnetStatus>('/status','GET',undefined,signal),
    state:(signal?:AbortSignal)=>request<TestnetState>('/state','GET',undefined,signal),
    createOrder:(body:TestnetOrderRequest)=>request<{orderId:string;orderLinkId:string}>('/orders','POST',body),
    cancelOrder:(orderId:string,symbol:string)=>request<{orderId:string;orderLinkId:string}>(`/orders/${encodeURIComponent(orderId)}/cancel`,'POST',{symbol}),
    setLeverage:(symbol:string,leverage:string)=>request<{symbol:string;leverage:string}>('/leverage','POST',{symbol,leverage}),
    closePosition:(symbol:string,quantity?:string)=>request<{orderId:string;orderLinkId:string}>(`/positions/${encodeURIComponent(symbol)}/close`,'POST',quantity?{quantity}:{}),
  };
}
export const bybitTestnetApi=createClient(import.meta.env.VITE_API_URL||'/api/v1',getToken);
export { createClient as createBybitTestnetClient };

export function testnetNumber(value:string|number|null|undefined,digits=2):string{
  if(value===null||value===undefined||value==='')return '—';
  const number=Number(value);if(!Number.isFinite(number))return '—';
  return new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(number);
}
export function testnetTime(value:string|number|null|undefined):string{
  if(value===null||value===undefined||value==='')return '—';
  const numeric=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;
  const date=new Date(numeric as any);return Number.isFinite(date.getTime())?date.toLocaleString('ru-RU'):'—';
}
