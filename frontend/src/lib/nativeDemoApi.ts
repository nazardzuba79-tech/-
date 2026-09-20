import { getToken } from './api';
import { PrivateTradingError, type PrivateResultCard } from './privateTradingApi';
export interface NativeCandle {source:'BYBIT_LINEAR';interval:string;openTime:number;pricePoint:'OPEN'|'CLOSE'}
export interface NativeProtection {takeProfit:string|null;stopLoss:string|null;quantity:string|null;triggerBy:'MARK'|'LAST'}
export interface NativePosition {
  id:string;symbol:string;side:'LONG'|'SHORT';quantity:string;entryPrice:string;markPrice:string;lastPrice:string;leverage:string;
  status:'OPEN'|'CLOSED'|'LIQUIDATED';openedAt:number;closedAt:number|null;historical:boolean;
  unrealizedPnl:string;realizedPnl:string;netPnl:string;roiPercent:string|null;roiBasis:string;closedRoiBasis:string;fundingNet:string;
  protection:NativeProtection;
  pendingClose?:{reason:'STOP_LOSS'|'TAKE_PROFIT';quantity:string;triggerPrice:string;triggeredAt:number;actionId:string}|null;
  /**
   * The estimate on the basis that applies to THIS position, named by
   * `liquidationStatus`: an account-level Cross estimate with other
   * contracts frozen, or an Isolated estimate against the position's own
   * posted margin. null = not reachable with the backing it has, or fully
   * hedged.
   */
  liquidationPrice:string|null;liquidationStatus:string;
  /** Which bucket backs it. Reported by the engine, not assumed here. */
  marginMode:'CROSS'|'ISOLATED';
  /** ISOLATED only: the margin posted against this position. '0' for Cross. */
  isolatedMargin:string;
  /** ISOLATED only: loss beyond the post that the simulation insurance model covered (SHORTFALL lines); '0' otherwise. */
  shortfallCovered?:string;
}
export interface NativeOrder {id:string;symbol:string;side:string;type:string;quantity:string;remaining:string;filled:string;averagePrice:string|null;price:string|null;leverage:string;status:string;createdAt:number;marginType:'CROSS'|'ISOLATED';reduceOnly?:boolean;positionId?:string|null}
export interface NativeEvent {id:string;kind:string;time:number;positionId:string|null;orderId:string|null;symbol:string;quantity:string;price:string|null;fee:string;cashflow:string;pricing:string;
  /** The one user action behind this fill; several fills of one close share it. Absent on older journals. */
  actionId?:string;sourcePrice?:string}
export interface NativeState {
  historyDeferred?:boolean;
  positionHistoryLoaded?:boolean;
  orderHistoryLoaded?:boolean;
  historyFailed?:boolean;
  initialized:boolean;revision:number;source:'DEMO_BALANCE'|'PREVIEW_FIXTURE'|null;asOf:number|null;demoAvailable?:string|null;
  model:{version:string;funding:{longCashflow:string;shortCashflow:string;unit:string;intervalMs:number};fundingSource?:string;historicalLimit?:string;historyResolution?:string[]};
  /**
   * THE AUTHORITATIVE ACCOUNT, computed once on the server.
   *
   * `liquidatable` is `null` — not `false` — while any held asset could not
   * be priced: an incomplete valuation understates collateral, and a
   * liquidation verdict on an understated figure is worse than no verdict.
   * `collateralComplete` and `unpricedAssets` say when that is the case.
   */
  account:null|NativeAccountAggregate;
  /** Every change to the settle balance, with its source. `null` before the account exists. */
  ledger:AccountLedgerView|null;
  positions:NativePosition[];history:NativePosition[];orders:NativeOrder[];events:NativeEvent[];
  entries?:{positionId:string;candle:NativeCandle|null}[];
}
export interface NativeAccountAggregate{
  settleBalance:string;walletCollateral:string;collateral:string;unrealizedPnl:string;equity:string;
  initialMargin:string;orderReserve:string;maintenanceMargin:string;available:string;
  initialMarginRatio:string|null;maintenanceRatio:string|null;liquidatable:boolean|null;
  collateralComplete:boolean;unpricedAssets:string[];collateralAsOf:number|null;
  /**
   * Included in `initialMargin` and in `settleBalance` above — reported
   * separately so the terminal can say how much of the account is ring
   * fenced without subtracting anything itself.
   */
  isolatedMargin?:string;
}
export type LedgerSource='INITIAL_COLLATERAL'|'OPENING_FEE'|'CLOSING_FEE'|'LIQUIDATION_FEE'|'REALIZED_PNL'|'FUNDING'|'SHORTFALL_COVER';
export interface LedgerEntryView{
  id:string;time:number;source:LedgerSource;kind:string;positionId:string|null;symbol:string|null;
  quantity:string|null;price:string|null;amount:string;balanceAfter:string;
}
export interface AccountLedgerView{
  entries:LedgerEntryView[];openingBalance:string;closingBalance:string;
  totals:{realizedPnl:string;fees:string;funding:string;net:string};
  walletBalance:string;reconciled:boolean;
}
export interface NativeContract{
  symbol:string;tickSize:string;qtyStep:string;minOrderQty:string;maxOrderQty:string;maxMarketOrderQty:string;minNotionalValue:string;
  minLeverage:string;maxLeverage:string;leverageStep:string;
  riskTiers:{maxNotional:string;maintenanceRate:string;deduction:string;maxLeverage:string}[];takerFeeRate:string;makerFeeRate:string;
}
/**
 * What the calculator can ask the server to price. One shape per tab, each
 * carrying only what its answer depends on.
 */
export type NativeQuoteInput=
  |{kind:'ORDER';symbol:string;side:'LONG'|'SHORT';quantity:string;price:string;leverage:string;maker?:boolean;market?:boolean}
  |{kind:'POSITION';symbol:string;side:'LONG'|'SHORT';quantity:string;entryPrice:string;markPrice:string;leverage:string;allocatedMargin?:string}
  |{kind:'TARGET';symbol:string;side:'LONG'|'SHORT';quantity:string;entryPrice:string;leverage:string;basis:'GROSS'|'NET';
    targetPnl?:string;targetRoiPercent?:string;allocatedMargin?:string;maker?:boolean}
  |{kind:'FUNDING';symbol:string;side:'LONG'|'SHORT';quantity:string;markPrice:string;rate:string;intervals?:number}
  |{kind:'PNL';symbol:string;side:'LONG'|'SHORT';quantity:string;entryPrice:string;exitPrice:string;leverage:string;maker?:boolean};

/** Which contract rule an order broke, with the limit and what was asked for. */
export interface NativeQuoteViolation{code:string;limit:string;allowed:string;actual:string}

/**
 * Every figure here was computed by the engine's own functions. `null` means
 * the engine has NO answer — an unreachable liquidation boundary, a cost that
 * cannot be quoted — and renders as a dash, never as zero.
 */
export type NativeQuoteResult=
  |{kind:'ORDER';entryNotional:string|null;baseInitialMargin:string|null;closeFeeReserve:string|null;openingFee:string|null;
    positionMargin:string|null;totalCost:string|null;violation:NativeQuoteViolation|null;
    rules:Omit<NativeContract,'riskTiers'|'takerFeeRate'|'makerFeeRate'>;takerFeeRate:string;makerFeeRate:string}
  |{kind:'POSITION';entryNotional:string;markNotional:string;baseInitialMargin:string;closeFeeReserve:string;allocatedMargin:string;
    maintenanceMargin:string;equity:string;unrealizedPnl:string;realizedGross:string;netPnl:string;roiMarginBasis:string;
    roiPercent:string|null;liquidationPrice:string|null;liquidatable:boolean;takerFeeRate:string;makerFeeRate:string}
  |{kind:'TARGET';exitPrice:string|null;targetPnl:string;roiMarginBasis:string;openingFee:string;closingFeeRate:string;
    takerFeeRate:string;makerFeeRate:string}
  |{kind:'FUNDING';perInterval:string;intervals:number;total:string;takerFeeRate:string;makerFeeRate:string}
  |{kind:'PNL';entryNotional:string;baseInitialMargin:string;positionMargin:string;openingFee:string;closingFee:string;
    grossPnl:string;netPnl:string;roiMarginBasis:string;roiPercent:string|null;roiPercentNet:string|null;
    takerFeeRate:string;makerFeeRate:string};

/**
 * The Cross collateral base: the whole wallet priced in the settle asset.
 *
 * `price`/`value` are `null` for an asset whose quote could not be obtained.
 * That is not a zero and must never be rendered as one — `unpriced` names
 * those assets and `complete` says whether `priced` is the whole wallet.
 */
export interface NativeCollateralLine{
  asset:string;available:string;locked:string;quantity:string;price:string|null;value:string|null;
  collateralEnabled:boolean;
  status:'SETTLE'|'PRICED'|'UNPRICED';source:string|null;asOf:number|null;
}
/**
 * One row of the Wallet's asset table, projected server-side from the
 * account and the collateral valuation. `value` is null — never 0 — for an
 * asset that could not be priced.
 */
export interface NativeWalletRow{
  asset:string;walletQuantity:string;tradingBalance:string;total:string;inUse:string;available:string;
  price:string|null;value:string|null;status:'SETTLE'|'PRICED'|'UNPRICED';asOf:number|null;
  collateralEnabled:boolean;collateralToggleable:boolean;
}
export interface NativeCollateral{
  settleAsset:string;lines:NativeCollateralLine[];priced:string;collateralPriced:string;
  unpriced:string[];collateralUnpriced:string[];complete:boolean;asOf:number|null;
}
/**
 * The unified account, as the Wallet reads it.
 *
 * `account.settleBalance` is the part of the wallet that has already moved
 * into the simulation ledger; `collateral.lines` is the part that has not.
 * Initialization DEBITS the settle row it takes, so the two are disjoint
 * and `account.collateral` is their sum without anything counted twice.
 */
export interface NativeWallet{
  initialized?:boolean;
  account:NativeAccountAggregate;
  ledger:AccountLedgerView;
  collateral:NativeCollateral;
  rows:NativeWalletRow[];
  /** All priced wallet assets, including assets disabled as margin collateral. */
  assetsValue:string;
  /** assetsValue + account P&L; unaffected by collateral on/off choices. */
  assetsEquityValue:string;
  assetsComplete:boolean;
  unpricedAssets:string[];
}
export type NativeDraft=
 | {kind:'OPEN';symbol:string;side:'LONG'|'SHORT';type:'MARKET'|'LIMIT';margin?:string;quantity?:string;leverage:string;price?:string;candle?:NativeCandle;protection?:Partial<NativeProtection>;reduceOnly?:true;positionId?:string;marginType?:'CROSS'|'ISOLATED'}
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
    if(!response.ok)throw new PrivateTradingError(
      typeof data?.error==='string'?data.error:'Счёт временно недоступен',
      response.status,
      typeof data?.code==='string'?data.code:undefined,
      {limit:data?.limit,allowed:data?.allowed,actual:data?.actual},
    );
    if(data===null)throw new PrivateTradingError('Сервер не подтвердил результат',502);return data;
  }
  return{
    access:(signal?:AbortSignal)=>request<{allowed:boolean;nativeAvailable?:boolean;simulationOnly?:boolean}>('/access',undefined,signal),
    state:(signal?:AbortSignal)=>request<NativeState>('/native/state',undefined,signal),
    live:(signal?:AbortSignal)=>request<NativeState>('/native/live',undefined,signal),
    activate:(signal?:AbortSignal)=>request<{ok:true}>('/native/execution-session',{},signal),
    history:<K extends keyof NativeHistoryItems>(kind:K,revision:number,options:{symbol?:string;cursor?:string;signal?:AbortSignal}={})=>{
      const params=new URLSearchParams({kind,revision:String(revision),limit:'50'});
      if(options.symbol)params.set('symbol',options.symbol);
      if(options.cursor)params.set('cursor',options.cursor);
      return request<{revision:number;kind:K;items:NativeHistoryItems[K][];nextCursor:string|null}>(`/native/history?${params}`,undefined,options.signal);
    },
    /** The contract's own trading rules — what the engine will accept as a
     *  quantity. The order form sizes against these instead of guessing. */
    contract:(symbol:string,signal?:AbortSignal)=>request<NativeContract>(`/native/contracts/${encodeURIComponent(symbol)}`,undefined,signal),
    /**
     * The authoritative account: the one object the terminal, the wallet
     * card and the P&L card all read. Whoever renders a figure from
     * anywhere else is showing a second answer.
     */
    account:(signal?:AbortSignal)=>request<{account:NativeAccountAggregate;ledger:AccountLedgerView}>('/native/account',undefined,signal),
    /** The whole wallet as Cross collateral, valued at the same marks the positions use. */
    collateral:(signal?:AbortSignal)=>request<NativeCollateral>('/native/collateral',undefined,signal),
    /**
     * The Wallet page's ONE request: the authoritative account AND the
     * per-asset collateral it was computed from, in a single valuation.
     * Asking `/account` and `/collateral` separately would be two upstream
     * valuations that can disagree — here the rows add up to the header by
     * construction.
     */
    wallet:(signal?:AbortSignal)=>request<NativeWallet>('/native/wallet',undefined,signal),
    setCollateral:(asset:string,enabled:boolean,idempotencyKey:string)=>request<NativeWallet>('/native/collateral-preference',{asset,enabled,idempotencyKey}),
    initialize:(acceptedModel:string,idempotencyKey:string)=>request<NativeState>('/native/initialize',{acceptedModel,idempotencyKey}),
    command:(draft:NativeDraft,idempotencyKey:string)=>request<NativeState>('/native/commands',{...draft,idempotencyKey}),
    /**
     * PRICING, NOT TRADING. The calculator's only call: the server runs the
     * engine's own quoteOrderCost / calculatePosition / liquidationPrice /
     * targetExitPrice / fundingCashflow and returns the figures.
     *
     * It is a request rather than a local computation because the frontend
     * image is built from `frontend/` alone and cannot import `src/`. It is
     * a POST because it carries a body, NOT because it writes — the route
     * touches no repository, issues no command and creates no revision,
     * which is why it takes no idempotency key.
     */
    quote:(input:NativeQuoteInput,signal?:AbortSignal)=>request<NativeQuoteResult>('/native/quote',input,signal),
    card:(positionId:string)=>request<PrivateResultCard>('/native/cards',{positionId}),
    getCard:(id:string)=>{const m=/^native:(\d+):(native-[a-zA-Z0-9-]+)$/.exec(id);if(!m)throw new PrivateTradingError('Карточка не найдена',404);return request<PrivateResultCard>(`/native/cards/${m[1]}/${m[2]}`);},
  };
}
export const nativeDemoApi=createNativeDemoClient(import.meta.env.VITE_API_URL||'/api/v1',getToken);
export interface NativeHistoryItems {
  positions:NativePosition;orders:NativeOrder;events:NativeEvent;entries:{positionId:string;candle:NativeCandle|null};
}
/** Signed fraction string -> percent text by decimal shifting (no floating point): '-0.001' -> '−0.1%'. */
export function nativeFundingPercent(value:string):string{
  const m=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);if(!m)return '—';
  const frac=`${m[3]??''}00`,whole=`${m[2]}${frac.slice(0,2)}`.replace(/^0+(?=\d)/,''),rest=frac.slice(2).replace(/0+$/,'');
  const body=rest?`${whole}.${rest}`:whole;
  if(/^0(?:\.0*)?$/.test(body))return '0%';
  return `${m[1]==='-'?'−':'+'}${body}%`;
}
