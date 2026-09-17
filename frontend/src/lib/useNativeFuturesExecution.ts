import { useMemo } from 'react';
import type { FuturesExecution } from './futuresExecution';
import { REAL_FUTURES_EXECUTION } from './futuresExecution';
import {
  nativeAccountState, terminalOrderToNativeDraft, pairToNativeSymbol,
} from './nativeFuturesAdapter';
import { nativeDemoApi } from './nativeDemoApi';
import type { NativeDemoController } from '../pages/private-trading/useNativeDemo';
import type { FuturesContractRules } from './futuresMath';

function decimalPlaces(value:string):number{const dot=value.indexOf('.');return dot===-1?0:value.length-dot-1;}
function decimalUnits(value:string,places:number):bigint{
  if(!/^\d+(?:\.\d+)?$/.test(value))throw new Error('Некорректное количество позиции');
  const[whole,fraction='']=value.split('.');
  if(fraction.length>places)throw new Error('Количество не соответствует шагу контракта');
  return BigInt((whole||'0')+fraction.padEnd(places,'0'));
}
function unitsText(value:bigint,places:number):string{
  if(places===0)return value.toString();
  const raw=value.toString().padStart(places+1,'0'),whole=raw.slice(0,-places),fraction=raw.slice(-places).replace(/0+$/,'');
  return fraction?`${whole}.${fraction}`:whole;
}
/** One contract-valid slice of a risk-reducing market close. A position can
 * legitimately be larger than Bybit's per-order market ceiling because it
 * may have been accumulated over several fills. The terminal's Close button
 * must therefore behave like an exchange close action, not like one giant
 * order that the contract rejects. */
function marketCloseChunk(quantity:string,rules:FuturesContractRules):string{
  const places=Math.max(decimalPlaces(quantity),decimalPlaces(rules.qtyStep),decimalPlaces(rules.maxMarketOrderQty),decimalPlaces(rules.minOrderQty));
  const total=decimalUnits(quantity,places),step=decimalUnits(rules.qtyStep,places),rawMax=decimalUnits(rules.maxMarketOrderQty,places),rawMin=decimalUnits(rules.minOrderQty,places);
  if(step<=0n||total<=0n||total%step!==0n)throw new Error('Количество позиции не соответствует шагу контракта');
  const maximum=(rawMax/step)*step;if(maximum<=0n)throw new Error('Рыночное закрытие недоступно для этого контракта');
  const minimum=((rawMin+step-1n)/step)*step;
  let chunk=total>maximum?maximum:total;
  const remainder=total-chunk;
  // Do not strand a final remainder below the venue's minimum: move enough
  // from this slice into the last one while both remain step-aligned.
  if(remainder>0n&&minimum>0n&&remainder<minimum){
    const shift=minimum-remainder;
    if(chunk-shift>=minimum)chunk-=shift;
  }
  if(chunk<=0n||chunk>maximum)return unitsText(total,places);
  return unitsText(chunk,places);
}

/**
 * The owner's futures terminal, backed by the simulation engine.
 *
 * This is the whole of the "different account source, same terminal"
 * decision. It returns a `FuturesExecution` for the ORIGINAL components —
 * the same order form, the same tables — whose account state is a
 * projection of the native state and whose writes are native commands.
 */
export function useNativeFuturesExecution(
  native: NativeDemoController,
  /** The selected contract's rules, loaded per symbol by the page. */
  contract: FuturesContractRules | null,
): FuturesExecution | null {
  const state = native.state;
  /** WHICH engine, not whether it is reachable — see useNativeDemo. */
  const binding = native.binding;
  const allowed = native.allowed;
  const checked = native.checked;
  const candle = native.candle;
  const exitId = native.exitId;
  const run = native.run;
  const fetchedAt = state?.asOf ?? 0;

  return useMemo(() => {
    /**
     * `null` releases the REAL engine for exactly one verdict: ordinary.
     * Unknown/failed owner access returns a non-ready native execution so it
     * can never fall through to the real-money routes.
     */
    if (binding === 'ordinary') return null;

    const account = nativeAccountState(state, {
      loading: binding === 'unknown' || !checked || (allowed && state === null),
      failed: checked && binding === 'owner' && !allowed,
      fetchedAt,
    });

    /** A picked bar only prices the order it was picked for. */
    const pickedCandle = candle
      ? { source: 'BYBIT_LINEAR' as const, interval: candle.interval, openTime: candle.openTime, pricePoint: 'CLOSE' as const }
      : null;

    /** The server's account, passed straight through — never recomputed. */
    const aggregate = state?.account ?? null;
    const waiting = state && !state.initialized ? state.demoAvailable ?? null : null;
    const activation = waiting !== null && Number(waiting) > 0
      ? { available: waiting, asset: 'USDT', pending: native.busy, begin: () => { void native.initialize(); } }
      : null;

    const refuse = async () => { throw new Error('Торговый счёт ещё не загружен'); };
    // A warm browser transcript is display-only. It becomes tradable only
    // after THIS session has received an authoritative server response.
    const ready = allowed && native.stateLoaded && state !== null && state.initialized;
    if (!ready) {
      return {
        ...REAL_FUTURES_EXECUTION,
        engine: 'NATIVE' as const,
        ready: false,
        account,
        marginType: null,
        defaultMarginType: 'CROSS' as const,
        candle: pickedCandle,
        contract,
        account_aggregate: aggregate,
        activation,
        placeOrder: refuse, cancelOrder: refuse, closePosition: refuse,
        setProtection: refuse, clearProtection: refuse,
        refresh: () => { void run({ kind: 'REFRESH' }); },
      };
    }

    return {
      engine: 'NATIVE' as const,
      ready: true,
      account,
      // Trader chooses the real risk bucket; native opens on Cross by default.
      marginType: null,
      defaultMarginType: 'CROSS' as const,
      candle: pickedCandle,
      contract,
      account_aggregate: aggregate,
      activation,
      async placeOrder(params) {
        const reducing = params.reduceOnly || Boolean(exitId);
        const targetPosition = !reducing ? undefined : state.positions.find(
          (p) => (exitId ? p.id === exitId : true)
            && p.symbol === pairToNativeSymbol(params.symbol)
            && p.side === (params.side === 'SELL' ? 'LONG' : 'SHORT'),
        );
        const target = !reducing ? undefined : exitId ?? targetPosition?.id;
        if (reducing && !target) throw new Error('Нет позиции для сокращения');
        const reduceMarginType = targetPosition?.marginMode;

        if (reducing && params.type === 'MARKET') {
          const ok = await run({
            kind: 'CLOSE', positionId: target!, quantity: params.quantity,
            ...(pickedCandle ? { candle: pickedCandle } : {}),
          });
          if (!ok) throw new Error(native.getError() || native.error || 'Операция не подтверждена');
          return;
        }
        const ok = await run(terminalOrderToNativeDraft({
          ...params,
          ...(reducing ? { reduceOnly: true, positionId: target, marginType: reduceMarginType } : {}),
          candle: pickedCandle,
        }));
        if (!ok) throw new Error(native.getError() || native.error || 'Операция не подтверждена');
      },
      async cancelOrder(orderId) {
        if (!(await run({ kind: 'CANCEL', orderId }))) throw new Error(native.getError() || native.error || 'Ордер не отменён');
      },
      async closePosition(positionId) {
        const first=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
        if(!first)throw new Error('Позиция уже закрыта или не найдена');
        // Fetch the rules of THE position being closed. The selected terminal
        // symbol can be different if the click switched instruments a render
        // ago, and using its ceiling would reproduce the same mismatch.
        const rules=await nativeDemoApi.contract(first.symbol);
        let stagnant=0;
        for(let pass=0;pass<64;pass++){
          const before=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
          if(!before)return;
          const quantity=marketCloseChunk(before.quantity,rules);
          const ok=await run({kind:'CLOSE',positionId,quantity});
          if(!ok)throw new Error(native.getError() || native.error || 'Позиция не закрыта');
          const after=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
          if(!after)return;
          // A 1000-level observed book can occasionally be thinner than a
          // large position. Ask for a fresh book rather than pretending the
          // remainder filled. Three zero-progress snapshots means there is
          // genuinely no executable depth right now.
          if(after.quantity===before.quantity){
            stagnant+=1;
            if(stagnant>=3)throw new Error('Недостаточно ликвидности для полного закрытия позиции. Повторите через несколько секунд.');
          }else stagnant=0;
        }
        throw new Error('Позиция слишком велика для одного цикла закрытия. Повторите закрытие оставшегося объёма.');
      },
      async setProtection(positionId, body) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: body.takeProfit, stopLoss: body.stopLoss } });
        if (!ok) throw new Error(native.getError() || native.error || 'TP/SL не сохранены');
      },
      async clearProtection(positionId) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: null, stopLoss: null } });
        if (!ok) throw new Error(native.getError() || native.error || 'TP/SL не сняты');
      },
      showPnlCard: (positionId: string) => { void native.showCard(positionId); },
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [binding, allowed, checked, state, fetchedAt, candle, exitId, run, native.error, native.stateLoaded, native.getState, native.getError, contract, native.showCard, native.busy, native.initialize]);
}
