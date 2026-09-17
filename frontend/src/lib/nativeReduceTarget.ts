import type { NativePosition } from './nativeDemoApi';
import { pairToNativeSymbol } from './nativeFuturesAdapter';

/**
 * Pure, testable, and free of `.tsx`/`import.meta`: the hook that uses this
 * imports the execution seam and the page controller, which ts-jest cannot
 * compile from a plain `.ts` test. A resolver that lives in the hook file
 * has no test that actually runs in CI — which is how PR #111's test file
 * came to exist without ever being executed there.
 */
export type ReduceTargetResolution=
  | {position:NativePosition;refusal?:undefined}
  | {position?:undefined;refusal:{code:'reduce_target_not_open'|'reduce_target_symbol'|'reduce_target_side'|'reduce_target_missing'|'reduce_target_ambiguous';message:string}};

/**
 * THE ONE open position a reducing order may touch — or a named refusal.
 *
 * The identity is the position ID, carried from the table row through the
 * order form to here (`params.positionId`), or the position picked for a
 * chart exit (`exitId`). A named position either fits — open, same
 * contract, opposite side — or the order is refused; nothing else is tried.
 *
 * Without a name, the order can only reduce the ONE open position of that
 * contract and direction in the bucket the form is on. Two candidates are
 * a refusal, not a guess: quantity is not an identity (two positions can be
 * the same size), row order is not an identity, and a candidate in the
 * OTHER bucket is never substituted — a Cross close must not release
 * margin posted to an isolated position.
 */
export function resolveNativeReduceTarget(
  positions:NativePosition[],
  params:{symbol:string;side:'BUY'|'SELL';marginType?:'ISOLATED'|'CROSS';positionId?:string},
  exitId:string|null,
):ReduceTargetResolution{
  const symbol=pairToNativeSymbol(params.symbol),expectedSide=params.side==='SELL'?'LONG':'SHORT';
  const named=params.positionId??exitId;
  if(named){
    const p=positions.find(x=>x.id===named);
    if(!p||p.status!=='OPEN')return{refusal:{code:'reduce_target_not_open',message:'Позиция уже закрыта или не найдена.'}};
    if(p.symbol!==symbol)return{refusal:{code:'reduce_target_symbol',message:'Выбранная позиция относится к другому контракту.'}};
    if(p.side!==expectedSide)return{refusal:{code:'reduce_target_side',message:'Сокращающий ордер должен быть противоположен стороне позиции.'}};
    return{position:p};
  }
  const candidates=positions.filter(p=>p.status==='OPEN'&&p.symbol===symbol&&p.side===expectedSide&&(params.marginType===undefined||p.marginMode===params.marginType));
  if(candidates.length===1)return{position:candidates[0]};
  if(candidates.length===0)return{refusal:{code:'reduce_target_missing',message:'Нет открытой позиции для сокращения в выбранном типе маржи.'}};
  return{refusal:{code:'reduce_target_ambiguous',message:'Несколько позиций подходят под этот ордер. Выберите позицию в таблице (кнопка «Лимитный») и повторите.'}};
}

