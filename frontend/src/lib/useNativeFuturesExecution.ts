import { useMemo } from 'react';
import type { FuturesExecution } from './futuresExecution';
import { REAL_FUTURES_EXECUTION } from './futuresExecution';
import { nativeAccountState } from './nativeFuturesAdapter';
import { nativeOrderDraft } from './nativeReduceTarget';
import { PrivateTradingError } from './privateTradingError';
import type { NativeDemoController } from '../pages/private-trading/useNativeDemo';
import type { FuturesContractRules } from './futuresMath';

const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const nativeFailure=(native:NativeDemoController,fallback:string)=>
  new PrivateTradingError(native.getError()||native.error||fallback,409);
function retryableCloseMessage(message:string){
  return /устар|временно недоступ|котиров|стакан|market_data|provider|повторите/i.test(message);
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
        // A position may close/change between the form's render and submit.
        // Resolve against the controller's current authoritative transcript,
        // never the older state captured when this execution object rendered.
        const current = native.getState();
        if (!current?.initialized) throw new PrivateTradingError('Торговый счёт ещё не загружен', 409);
        const draft = nativeOrderDraft(current.positions, params, exitId, pickedCandle);
        if (!(await run(draft))) throw nativeFailure(native,'Операция не подтверждена');
      },
      async cancelOrder(orderId) {
        if (!(await run({ kind: 'CANCEL', orderId }))) throw nativeFailure(native,'Ордер не отменён');
      },
      async closePosition(positionId) {
        const first=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
        if(!first)throw new PrivateTradingError('Позиция уже закрыта или не найдена',409);
        /**
         * The server owns CLOSE sizing now. A position may be larger than one
         * venue market order (or older than today's contract limits), so the
         * server consumes the real observed book directly as a risk-reducing
         * close action. If that snapshot has insufficient depth, keep asking
         * for a fresh snapshot; never reuse or invent liquidity.
         */
        let stagnant=0,transientFailures=0;
        for(let pass=0;pass<30;pass++){
          const before=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
          if(!before)return;
          const ok=await run({kind:'CLOSE',positionId});
          if(!ok){
            const message=native.getError()||native.error||'Позиция не закрыта';
            if(transientFailures<4&&retryableCloseMessage(message)){
              transientFailures+=1;
              await wait(350*transientFailures);
              continue;
            }
            throw new PrivateTradingError(message,409);
          }
          transientFailures=0;
          const after=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
          if(!after)return;
          if(after.quantity===before.quantity){
            stagnant+=1;
            if(stagnant>=4)throw new PrivateTradingError('Недостаточно ликвидности для полного закрытия позиции. Повторите через несколько секунд.',409);
            // Give the provider time to publish a genuinely new observed book.
            await wait(500*stagnant);
          }else{
            stagnant=0;
            // A very large close may consume one whole snapshot. Yield briefly
            // so the next command is not guaranteed to hit the identical book.
            await wait(150);
          }
        }
        throw new PrivateTradingError('Позиция закрыта частично. Повторите закрытие оставшегося объёма.',409);
      },
      async setProtection(positionId, body) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: body.takeProfit, stopLoss: body.stopLoss } });
        if (!ok) throw nativeFailure(native,'TP/SL не сохранены');
      },
      async clearProtection(positionId) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: null, stopLoss: null } });
        if (!ok) throw nativeFailure(native,'TP/SL не сняты');
      },
      showPnlCard: (positionId: string) => { void native.showCard(positionId); },
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [binding, allowed, checked, state, fetchedAt, candle, exitId, run, native.error, native.stateLoaded, native.getState, native.getError, contract, native.showCard, native.busy, native.initialize]);
}
