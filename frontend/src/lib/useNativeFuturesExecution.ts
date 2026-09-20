import { useMemo } from 'react';
import type { FuturesExecution } from './futuresExecution';
import { REAL_FUTURES_EXECUTION } from './futuresExecution';
import { nativeAccountState } from './nativeFuturesAdapter';
import { nativeOrderDraft } from './nativeReduceTarget';
import { PrivateTradingError } from './privateTradingError';
import type { NativeDemoController } from '../pages/private-trading/useNativeDemo';
import type { FuturesContractRules } from './futuresMath';

const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** The failure a native command raised, as the structured error it was — never re-flattened into prose. */
const failureOf=(e:unknown,fallback:string)=>e instanceof PrivateTradingError?e:new PrivateTradingError(fallback,409);
function retryableCloseFailure(e:unknown){
  const code=e instanceof PrivateTradingError?e.code??'':'';
  if(['STALE_BOOK','LATEST_MARK_STALE','INCONSISTENT_BOOK','quote_stale','native_queue_full','client_queue_full'].includes(code))return true;
  return false;
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
  const execute = native.execute;
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
    const historicalEntryPending = !!native.entryIntent && !pickedCandle;
    const ready = allowed && native.stateLoaded && state !== null && state.initialized && !historicalEntryPending;
    if (!ready) {
      return {
        ...REAL_FUTURES_EXECUTION,
        engine: 'NATIVE' as const,
        ready: false,
        account,
        marginType: null,
        defaultMarginType: 'CROSS' as const,
        candle: pickedCandle,
        historicalEntryPending,
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
      historicalEntryPending,
      contract,
      account_aggregate: aggregate,
      activation,
      // The simulation engine carries TP/SL on the order itself
      // (`DemoOrderInput.protection`), validates the levels against the
      // order's own price and applies them to the position the fill creates.
      entryProtection: true,
      async placeOrder(params) {
        // A position may close/change between the form's render and submit.
        // Resolve against the controller's current authoritative transcript,
        // never the older state captured when this execution object rendered.
        const current = native.getState();
        if (!current?.initialized) throw new PrivateTradingError('Торговый счёт ещё не загружен', 409);
        // The reference displayed by the form is the reference it submits.
        // A missing/mismatched reference cannot silently become a live order.
        if (params.candle !== undefined && JSON.stringify(params.candle) !== JSON.stringify(pickedCandle)) {
          throw new PrivateTradingError('Выберите точку входа на графике.', 409, 'HISTORICAL_ENTRY_REQUIRED');
        }
        const draft = nativeOrderDraft(current.positions, params, exitId, params.candle === undefined ? pickedCandle : params.candle);
        // The server's refusal travels as the structured error it is (code,
        // status, contract limit), so the terminal localizes the real reason.
        try { await execute(draft); } catch (e) { throw failureOf(e, 'Операция не подтверждена'); }
      },
      async cancelOrder(orderId) {
        try { await execute({ kind: 'CANCEL', orderId }); } catch (e) { throw failureOf(e, 'Ордер не отменён'); }
      },
      async closePosition(positionId) {
        const first=native.getState()?.positions.find(p=>p.id===positionId&&p.status==='OPEN');
        if(!first)throw new PrivateTradingError('Позиция уже закрыта или не найдена',409);
        if(first.executionMode==='HISTORICAL_DEMO'){
          // One current-price command, no automatic resubmission after any failure.
          try{await execute({kind:'CLOSE',positionId});}catch(e){throw failureOf(e,'Позиция не закрыта');}
          return;
        }
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
          try{await execute({kind:'CLOSE',positionId});}
          catch(e){
            if(transientFailures<4&&retryableCloseFailure(e)){
              transientFailures+=1;
              await wait(350*transientFailures);
              continue;
            }
            throw failureOf(e,'Позиция не закрыта');
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
        try { await execute({ kind: 'PROTECTION', positionId, protection: { takeProfit: body.takeProfit, stopLoss: body.stopLoss } }); }
        catch (e) { throw failureOf(e, 'TP/SL не сохранены'); }
      },
      async clearProtection(positionId) {
        try { await execute({ kind: 'PROTECTION', positionId, protection: { takeProfit: null, stopLoss: null } }); }
        catch (e) { throw failureOf(e, 'TP/SL не сняты'); }
      },
      showPnlCard: (positionId: string) => { void native.showCard(positionId); },
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [binding, allowed, checked, state, fetchedAt, candle, exitId, run, execute, native.entryIntent, native.stateLoaded, native.getState, contract, native.showCard, native.busy, native.initialize]);
}
