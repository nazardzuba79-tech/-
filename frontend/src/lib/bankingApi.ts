import { getToken } from './api';

export type BankingAsset='USDT'|'USDC'|'BTC'|'ETH'|'SOL';
export type BankingProgramId='MONTHLY_17_24M'|'COMPOUND_21_12M';
export interface BankingProgram {id:BankingProgramId;name:string;monthlyRate:string;termMonths:number;minUsd:string;assets:BankingAsset[];compound:boolean;payoutFrequency:'MONTHLY'|'MATURITY';lockRule:string;enabled:boolean;availableFrom:string|null;availableUntil:string|null}
export interface BankingConfig {programs:BankingProgram[];assets:{asset:BankingAsset;priceUsd:string|null;minimumAssetQty:string|null}[];rewardCurrencyRule:string;usdValuesAreReferenceOnly:true;cardYield:{annualRate:string;asset:'USDT';locked:false;availableCardBalance:string|null;accruedReward:string|null;dataStatus:string;reason?:string}}
export interface BankingCalculation {programId:BankingProgramId;asset:BankingAsset;principal:string;completedMonths:number;startDate:string;endDate:string;maturityDate:string;monthlyReward:string|null;totalRewards:string;balance:string;profit:string;priceUsd:string;minimumAssetQty:string;usdEquivalent:string;rewardCurrency:BankingAsset}
export interface BankingPlacement {id:string;programId:BankingProgramId;programName:string;asset:BankingAsset;principal:string;monthlyRate:string;termMonths:number;compound:boolean;payoutFrequency:string;lockRule:string;openedAt:string;maturityDate:string;completedMonths:number;status:'ACTIVE'|'MATURED';rewardAccrued:string;currentBalance:string;rewardCurrency:BankingAsset;priceUsd:string|null;principalUsd:string|null}
export interface BankingState {placements:BankingPlacement[];ledger:{id:string;placement_id:string|null;entry_type:string;asset:string;amount:string;period_index:number|null;effectiveAt:string;createdAt:string}[];summary:{totalUsd:string|null;accruedUsd:string|null;activeCount:number};cardYield:BankingConfig['cardYield']}

class BankingApiError extends Error{constructor(readonly status:number,readonly code:string){super(code)}}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const token=getToken();if(!token)throw new BankingApiError(401,'auth_required');
  const response=await fetch(`${import.meta.env.VITE_API_URL||'/api/v1'}${path}`,{...init,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(init.headers||{})}});
  const body=await response.json().catch(()=>null);if(!response.ok)throw new BankingApiError(response.status,body?.error||'banking_unavailable');return body as T;
}
export const bankingApi={
  config:()=>request<BankingConfig>('/banking/config'),
  state:()=>request<BankingState>('/banking/state'),
  calculate:(body:{programId:BankingProgramId;asset:BankingAsset;amount:string;startDate:string;periodMonths?:number;endDate?:string})=>request<BankingCalculation>('/banking/calculate',{method:'POST',body:JSON.stringify(body)}),
  createPlacement:(body:{programId:BankingProgramId;asset:BankingAsset;amount:string;idempotencyKey:string})=>request('/banking/placements',{method:'POST',body:JSON.stringify(body)}),
};
export const bankingNumber=(value:string|null|undefined,digits=2)=>{if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n):'—'};
export const bankingErrorText=(error:unknown)=>{const code=error instanceof BankingApiError?error.code:'';return ({below_minimum:'Сумма ниже минимального эквивалента $2,500.',insufficient_available_balance:'Недостаточно доступного баланса в выбранном активе.',asset_price_unavailable:'Текущая USD-цена недоступна. Размещение временно отключено.',program_unavailable:'Программа недоступна.',idempotency_key_reused:'Повторная команда не совпадает с исходной.',auth_required:'Войдите в аккаунт.'} as Record<string,string>)[code]||'Не удалось выполнить операцию.'};
