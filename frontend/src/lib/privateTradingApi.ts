import { getToken } from './api';

export type PrivateMode = 'DEMO_LIVE' | 'HISTORICAL_REPLAY';
export type PrivateSide = 'LONG' | 'SHORT';
export type PrivateDecimal = string | null;
export interface PrivatePosition {
  id:string; mode:PrivateMode; symbol:string; side:PrivateSide; leverage:string; quantity:string;
  entryPrice:PrivateDecimal; markPrice:PrivateDecimal; allocatedMargin:PrivateDecimal;
  liquidationPrice:PrivateDecimal; unrealizedPnl:PrivateDecimal; netPnl:PrivateDecimal; roiPercent:PrivateDecimal;
  takeProfit:PrivateDecimal; stopLoss:PrivateDecimal; status:string; createdAt:string;
  effectiveOpenedAt:string; effectiveClosedAt?:string|null; verification?:string;
  notional?:PrivateDecimal;
  dataStatus?:'LIVE'|'UNAVAILABLE';asOf?:string;
  initialQuantity?:string;
}
export interface PrivateOrder {
  id:string; symbol:string; side:PrivateSide; type:string; status:string; quantity:string;
  filledQuantity?:string; remainingQuantity?:string; price?:PrivateDecimal; limitPrice?:PrivateDecimal;
  createdAt:string; effectiveAt?:string;
}
export interface PrivateScenario extends PrivatePosition { asOf:string;verification:string;allocatedCapital:PrivateDecimal;scenarioEquity:PrivateDecimal;version?:number;issues?:string[] }
export interface PrivatePreview {
  id:string; status:'RUNNING'|'READY'|'INCOMPLETE'|'AMBIGUOUS'|'FAILED'|'CANCELLED'|'CONFIRMED'|'EXPIRED'; progress:number; error?:string;
  mode?:PrivateMode;createdAt?:string;expiresAt?:string;
  result?:{position:PrivatePosition|null;cost:{required:PrivateDecimal;initialMargin:PrivateDecimal;fee:PrivateDecimal;closeFeeReserve:PrivateDecimal};issues?:string[];assumptions?:string[];request?:PrivatePreviewRequest;consent?:PrivateExecutionConsent}|null;
}
export interface PrivateExecutionConsent {
  slippageBps:string;slippagePercent?:string;quantity:string;minimumFillQuantity:string;maxRequired:string;
  maxAveragePrice:string|null;minAveragePrice:string|null;
}
export interface PrivateState {
  wallet:{available:PrivateDecimal;reserved:PrivateDecimal;demoAvailable:PrivateDecimal;allocatedCapital:PrivateDecimal;realizedPnl:PrivateDecimal;unrealizedPnl:PrivateDecimal};
  positions:PrivatePosition[];orders:PrivateOrder[];orderHistory?:PrivateOrder[];history:PrivatePosition[];scenarios:PrivateScenario[];previews:PrivatePreview[];copyHistory:PrivatePosition[];
}
export interface PrivatePreviewRequest {
  mode:PrivateMode;symbol:string;side:PrivateSide;type:'MARKET'|'LIMIT';quantity?:string;margin?:string;leverage:string;
  limitPrice?:string;takeProfit?:string;stopLoss?:string;effectiveOpenedAt?:string;asOf?:string;effectiveClosedAt?:string;
  capital?:string;manualEntryPrice?:string;idempotencyKey:string;
  events?:({id:string;effectiveAt:string}&({kind:'MARGIN';amount:string}|{kind:'CLOSE';quantity:string}|{kind:'TPSL';takeProfit:string|null;stopLoss:string|null}))[];
}
export interface PrivateResultCard {
  id:string;symbol:string;side:PrivateSide;leverage:string;mode:PrivateMode;netPnl:PrivateDecimal;unrealizedPnl:PrivateDecimal;
  roiPercent:PrivateDecimal;entryPrice:PrivateDecimal;valuationPrice:PrivateDecimal;usdPnl:PrivateDecimal;asOf:string;status:string;label:string;
  pnl?:PrivateDecimal;pnlKind?:'UNREALIZED'|'NET_REALIZED'|'NET_SCENARIO';
}
export interface PrivateMarket {
  symbol:string;bids:{price:string;quantity:string}[];asks:{price:string;quantity:string}[];markPrice:string;lastPrice:string;
  providerTimestamp:number;fetchedAt:number;
  instrument:{symbol:string;tickSize:string;qtyStep:string;minOrderQty:string;maxOrderQty:string;maxMarketOrderQty:string;minNotionalValue:string;minLeverage:string;maxLeverage:string;leverageStep:string};
}
export class PrivateTradingError extends Error {
  constructor(message:string,readonly status:number){super(message);this.name='PrivateTradingError';}
}

/** This client cannot target production order, wallet or copy-trading routes. */
export function createPrivateTradingClient(base:string,token:()=>string|null,fetcher:typeof fetch=fetch){
  async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
    const bearer=token();
    if(!bearer)throw new PrivateTradingError('Сессия завершена',401);
    const response=await fetcher(`${base.replace(/\/$/,'')}/private-trading${path}`,{
      method,signal,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=response.status===204?undefined:await response.json().catch(()=>null);
    if(token()!==bearer)throw new PrivateTradingError('Сессия завершена',401);
    if(!response.ok)throw new PrivateTradingError(typeof data?.error==='string'?data.error:typeof data?.message==='string'?data.message:'Не удалось выполнить запрос',response.status);
    return data as T;
  }
  const id=(value:string)=>encodeURIComponent(value);
  return {
    access:(signal?:AbortSignal)=>request<{allowed:true;mode:'PRIVATE_SIMULATION'}>('/access','GET',undefined,signal),
    state:(signal?:AbortSignal)=>request<PrivateState>('/state','GET',undefined,signal),
    market:(symbol:string,signal?:AbortSignal)=>request<PrivateMarket>(`/market?symbol=${encodeURIComponent(symbol)}`,'GET',undefined,signal),
    allocate:(amount:string,idempotencyKey:string)=>request('/allocate','POST',{amount,idempotencyKey}),
    preview:(body:PrivatePreviewRequest)=>request<PrivatePreview>('/previews','POST',body),
    getPreview:(previewId:string,signal?:AbortSignal)=>request<PrivatePreview>(`/previews/${id(previewId)}`,'GET',undefined,signal),
    cancelPreview:(previewId:string)=>request(`/previews/${id(previewId)}`,'DELETE'),
    confirm:(previewId:string,idempotencyKey:string)=>request(`/previews/${id(previewId)}/confirm`,'POST',{idempotencyKey}),
    cancelOrder:(orderId:string,idempotencyKey:string)=>request(`/orders/${id(orderId)}`,'DELETE',{idempotencyKey}),
    close:(positionId:string,quantity:string|undefined,idempotencyKey:string)=>request(`/positions/${id(positionId)}/close`,'POST',{quantity,idempotencyKey}),
    amend:(positionId:string,body:{takeProfit?:PrivateDecimal;stopLoss?:PrivateDecimal;marginDelta?:string;leverage?:string;idempotencyKey:string})=>request(`/positions/${id(positionId)}`,'PATCH',body),
    advance:(scenarioId:string,asOf:string,idempotencyKey:string)=>request<PrivatePreview>(`/scenarios/${id(scenarioId)}/advance`,'POST',{asOf,idempotencyKey}),
    card:(positionId:string)=>request<PrivateResultCard>('/cards','POST',{positionId}),
    getCard:(cardId:string)=>request<PrivateResultCard>(`/cards/${id(cardId)}`),
  };
}
export const privateTradingApi=createPrivateTradingClient(import.meta.env.VITE_API_URL||'/api/v1',getToken);

export function privateNumber(value:PrivateDecimal|number|undefined,digits=2):string{
  if(value===null||value===undefined||value==='')return '—';
  const number=Number(value);if(!Number.isFinite(number))return '—';
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(number);
}
export function privateUtc(value:string|number|null|undefined):string{
  if(value===null||value===undefined||value==='')return '—';
  const date=new Date(value);return Number.isFinite(date.getTime())?`${date.toISOString().slice(0,19).replace('T',' ')} UTC`:'—';
}
/** datetime-local inputs deliberately represent UTC in this workspace. */
export function privateInputUtc(value:string):string{
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value))throw new Error('Укажите дату и время UTC');
  const date=new Date(`${value}Z`);if(!Number.isFinite(date.getTime()))throw new Error('Проверьте дату и время UTC');
  if(date.toISOString().slice(0,value.length)!==value)throw new Error('Проверьте дату и время UTC');
  return date.toISOString();
}
export function privateEffectiveSort<T extends {effectiveClosedAt?:string|null;effectiveOpenedAt:string}>(rows:T[]):T[]{
  return [...rows].sort((a,b)=>Date.parse(b.effectiveClosedAt||b.effectiveOpenedAt)-Date.parse(a.effectiveClosedAt||a.effectiveOpenedAt));
}
export function privatePositionPnl(position:PrivatePosition):PrivateDecimal{
  if(position.dataStatus==='UNAVAILABLE')return null;
  return position.mode==='HISTORICAL_REPLAY'||position.status!=='OPEN'?position.netPnl:position.unrealizedPnl;
}
export function privateCardPnl(card:PrivateResultCard):PrivateDecimal{
  return card.pnl!==undefined?card.pnl:card.mode==='HISTORICAL_REPLAY'||card.status!=='OPEN'?card.netPnl:card.unrealizedPnl;
}
/** Refresh exactly the reviewed inputs; exclude server models and the old command key. */
export function privateRefreshDraft(preview:PrivatePreview):Omit<PrivatePreviewRequest,'idempotencyKey'>|null{
  const request=preview.result?.request;if(!request)return null;
  const keys=['mode','symbol','side','type','quantity','margin','leverage','limitPrice','takeProfit','stopLoss','effectiveOpenedAt','asOf','effectiveClosedAt','capital','manualEntryPrice','events'] as const;
  // Server snapshots also retain computed quantity for a margin-based request.
  // Refresh the original size input, never submit both quantity and margin.
  return Object.fromEntries(keys.filter(key=>request[key]!==undefined&&!(key==='quantity'&&request.margin!==undefined)).map(key=>[key,request[key]])) as Omit<PrivatePreviewRequest,'idempotencyKey'>;
}
export function privateExplanation(value:string):string{
  const code=value.split(':')[0].toUpperCase();
  const messages:Record<string,string>={
    ENTRY_AND_MANUAL_CLOSE_AT_NEXT_CANDLE_OPEN:'Вход и ручное закрытие моделируются по открытию следующей свечи.',
    MARK_TPSL_TRIGGER_NEXT_TRADE_CANDLE_OPEN:'TP/SL срабатывают по Mark Price; исполнение — на следующей торговой свече.',
    INTRABAR_LIQUIDATION_MODEL_AT_MARK_BOUNDARY:'Ликвидация внутри свечи оценивается по границе Mark Price.',
    FUNDING_FREE_SCENARIO_CASH_FIRST_THEN_ISOLATED_COLLATERAL:'Funding списывается сначала из свободного капитала сценария, затем из обеспечения.',
    BOUNDARY_PRIORITY_RISK_FUNDING_RISK_CLOSE_MARGIN_TPSL:'В одинаковый момент сначала проверяется риск и funding, затем закрытие, маржа и TP/SL.',
    ENTRY_FIXED_MARGIN_PROFILE_NOT_EXACT_HISTORICAL_BYBIT:'Используется сохранённый профиль маржи; это модель исторических условий.',
    MANUAL_ENTRY_PRICE_ASSUMPTION:'Цена входа задана вручную и сохранена как допущение.',
    LIQUIDATION_TIME_RECORDED_AT_CONTAINING_CANDLE_END:'Время ликвидации зафиксировано по закрытию соответствующей свечи.',
    PROVIDER_HISTORY_INCOMPLETE:'История рынка неполная.',
    EVENT_REQUIRES_FINER_HISTORY:'Для времени события нужна более подробная история.',
    FUNDING_REQUIRES_FINER_HISTORY:'Для funding нужна более подробная история.',
    FUNDING_HISTORY_INCOMPLETE:'История funding неполная.',
    FUNDING_HISTORY_GAP:'В истории funding есть пропуски.',
    TRADE_HISTORY_GAP:'В истории торговых свечей есть пропуски.',
    MARK_HISTORY_GAP:'В истории Mark Price есть пропуски.',
    FUNDING_MARK_MISSING:'Нет подтверждённой Mark Price для funding.',
    MISSING_CANDLE:'В выбранном периоде отсутствует свеча.',
    FUNDING_MARK_MISMATCH:'Mark Price в истории funding не совпадает с историей свечей.',
    AS_OF_REQUIRES_CLOSED_CANDLE:'Конечное время требует закрытой свечи.',
    INTRABAR_PATH_AMBIGUOUS:'Внутри свечи возможны разные последовательности TP, SL и ликвидации.',
    LIQUIDATION_BOUNDARY_OUTSIDE_MODEL:'Граница ликвидации выходит за условия модели.',
    TRIGGER_AWAITS_NEXT_CANDLE_EXECUTION:'Для исполнения TP/SL нужна следующая свеча.',
    NO_EXECUTABLE_ENTRY_CANDLE:'Нет свечи, по которой можно подтвердить вход.',
    HISTORY_DID_NOT_REACH_AS_OF:'История не покрывает весь выбранный период.',
    FUNDING_PAGE_LIMIT:'Период funding превышает доступный объём расчёта.',
  };
  return messages[code]??(/^[A-Za-z0-9_]+(?::.*)?$/.test(value)?'Условие расчёта не подтверждено доступными данными.':value);
}
export function privateErrorText(error:unknown):string{
  if(error instanceof PrivateTradingError){
    if(error.status===401||error.status===403)return 'Доступ к приватному режиму завершён';
    if(/quote.*stale|stale.*quote|quote.*expired/i.test(error.message))return 'Котировка обновилась. Рассчитайте предпросмотр ещё раз.';
    if(/insufficient|balance|capital/i.test(error.message))return 'Недостаточно выделенных средств для этой операции.';
    if(/history.*gap|incomplete|unavailable/i.test(error.message))return 'Данные сейчас недоступны. Повторите запрос позже.';
    if(error.status===429)return 'Расчёт уже выполняется. Дождитесь завершения.';
    if(error.status>=500)return 'Не удалось обновить данные. Повторите запрос.';
    if(/^[a-z0-9_]+$/i.test(error.message))return 'Проверьте параметры операции и повторите запрос.';
    return error.message;
  }
  return error instanceof Error&&error.message&&!/fetch|network|abort/i.test(error.message)?error.message:'Не удалось связаться с сервером. Повторите запрос.';
}
