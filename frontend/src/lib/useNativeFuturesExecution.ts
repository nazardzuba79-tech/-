import { useMemo } from 'react';
import type { FuturesExecution } from './futuresExecution';
import { REAL_FUTURES_EXECUTION } from './futuresExecution';
import {
  nativeAccountState, terminalOrderToNativeDraft, pairToNativeSymbol,
} from './nativeFuturesAdapter';
import type { NativeDemoController } from '../pages/private-trading/useNativeDemo';
import type { FuturesContractRules } from './futuresMath';

/**
 * The owner's futures terminal, backed by the simulation engine.
 *
 * This is the whole of the "different account source, same terminal"
 * decision. It returns a `FuturesExecution` for the ORIGINAL components —
 * the same order form, the same tables — whose account state is a
 * projection of the native state and whose writes are native commands.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It never falls back to `REAL_FUTURES_EXECUTION` for this account.
 *    `ready` is false while the verdict or the state is unknown, and false
 *    when either failed, so a simulation outage blocks trading rather than
 *    opening the real engine to an account that must never reach it.
 *  - It computes no financial figure. Every string in the projection is
 *    one the server sent; the engine remains the only thing that values a
 *    position, charges funding or decides a liquidation price.
 *  - It invents no order book. A historical order carries the identity of
 *    the bar the trader picked, and the server prices it from the bar it
 *    holds.
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
     * `null` releases the REAL engine, so it is returned for exactly ONE
     * answer: the server said this is an ordinary account.
     *
     * While the verdict is unknown, and for an owner whose access call is
     * failing, a non-null but NOT-READY execution is returned instead. That
     * does two things at once: `useFuturesAccount` sees a replacement
     * source and never subscribes to the real store (so the owner's tab
     * issues no /futures/balances, /futures/positions or /futures/orders/me
     * at all), and `ready: false` blocks trading. Fail closed: an outage
     * stops the owner trading, it never hands them the real engine.
     */
    if (binding === 'ordinary') return null;

    const account = nativeAccountState(state, {
      // `checked` false means the access verdict is still in flight; a
      // state of null after that means the account read is.
      // Unknown is not failure: while the binding is still being decided,
      // and while an owner's access call is retrying, this reads as loading.
      loading: binding === 'unknown' || !checked || (allowed && state === null),
      failed: checked && binding === 'owner' && !allowed,
      fetchedAt,
    });

    /** A picked bar only prices the order it was picked for. */
    const pickedCandle = candle
      ? { source: 'BYBIT_LINEAR' as const, interval: candle.interval, openTime: candle.openTime, pricePoint: 'CLOSE' as const }
      : null;

    /** The engine's own aggregate, passed straight through. */
    const aggregate = state?.account ? {
      walletBalance: state.account.walletBalance,
      equity: state.account.equity,
      unrealizedPnl: state.account.unrealizedPnl,
      initialMargin: state.account.usedMargin,
      maintenanceMargin: state.account.maintenanceMargin,
      orderReserve: state.account.orderReserve,
      available: state.account.available,
      maintenanceRatio: state.account.maintenanceRatio,
      liquidatable: state.account.liquidatable,
    } : null;

    const refuse = async () => {
      throw new Error('Торговый счёт ещё не загружен');
    };
    const ready = allowed && state !== null && state.initialized;
    if (!ready) {
      return {
        ...REAL_FUTURES_EXECUTION,
        engine: 'NATIVE' as const,
        ready: false,
        account,
        marginType: 'CROSS' as const,
        candle: pickedCandle,
        contract,
        account_aggregate: aggregate,
        placeOrder: refuse, cancelOrder: refuse, closePosition: refuse,
        setProtection: refuse, clearProtection: refuse,
        refresh: () => { void run({ kind: 'REFRESH' }); },
      };
    }

    return {
      engine: 'NATIVE' as const,
      ready: true,
      account,
      // The engine settles this account in Cross. The terminal states that
      // rather than offering a toggle whose other position does nothing.
      marginType: 'CROSS' as const,
      candle: pickedCandle,
      contract,
      account_aggregate: aggregate,
      async placeOrder(params) {
        const reducing = params.reduceOnly || Boolean(exitId);
        const target = !reducing ? undefined : exitId ?? state.positions.find(
          (p) => p.symbol === pairToNativeSymbol(params.symbol)
            && p.side === (params.side === 'SELL' ? 'LONG' : 'SHORT'),
        )?.id;
        if (reducing && !target) throw new Error('Нет позиции для сокращения');

        /**
         * A MARKET reduce is a close at the book, which is what CLOSE means.
         *
         * A LIMIT reduce is NOT. It is a resting order at the trader's own
         * price, and the engine has always accepted one (`placeDemoOrder`
         * takes `reduceOnly` with a `positionId` and checks the side and
         * size against that position). Collapsing it into CLOSE priced it at
         * the book instead — a different trade from the one that was placed.
         */
        if (reducing && params.type === 'MARKET') {
          const ok = await run({
            kind: 'CLOSE', positionId: target!, quantity: params.quantity,
            ...(pickedCandle ? { candle: pickedCandle } : {}),
          });
          if (!ok) throw new Error(native.error || 'Операция не подтверждена');
          return;
        }
        const ok = await run(terminalOrderToNativeDraft({
          ...params,
          ...(reducing ? { reduceOnly: true, positionId: target } : {}),
          candle: pickedCandle,
        }));
        if (!ok) throw new Error(native.error || 'Операция не подтверждена');
      },
      async cancelOrder(orderId) {
        if (!(await run({ kind: 'CANCEL', orderId }))) throw new Error(native.error || 'Ордер не отменён');
      },
      async closePosition(positionId) {
        if (!(await run({ kind: 'CLOSE', positionId }))) throw new Error(native.error || 'Позиция не закрыта');
      },
      async setProtection(positionId, body) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: body.takeProfit, stopLoss: body.stopLoss } });
        if (!ok) throw new Error(native.error || 'TP/SL не сохранены');
      },
      async clearProtection(positionId) {
        const ok = await run({ kind: 'PROTECTION', positionId, protection: { takeProfit: null, stopLoss: null } });
        if (!ok) throw new Error(native.error || 'TP/SL не сняты');
      },
      // The frozen result snapshot this account already produces.
      showPnlCard: (positionId: string) => { void native.showCard(positionId); },
      // The native engine answers every command with the WHOLE account, so
      // a command has already refreshed what a real refresh would fetch.
      // An explicit refresh is still honoured — it is how the panel's own
      // reload button and the terminal's post-trade nudge reach the engine.
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [binding, allowed, checked, state, fetchedAt, candle, exitId, run, native.error, contract, native.showCard]);
}
