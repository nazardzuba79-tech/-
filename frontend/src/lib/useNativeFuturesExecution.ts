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
  const requested = native.requested;
  const allowed = native.allowed;
  const checked = native.checked;
  const candle = native.candle;
  const exitId = native.exitId;
  const run = native.run;
  const fetchedAt = state?.asOf ?? 0;

  return useMemo(() => {
    if (!requested) return null;

    const account = nativeAccountState(state, {
      // `checked` false means the access verdict is still in flight; a
      // state of null after that means the account read is.
      loading: !checked || (allowed && state === null),
      failed: checked && !allowed,
      fetchedAt,
    });

    /** A picked bar only prices the order it was picked for. */
    const pickedCandle = candle
      ? { source: 'BYBIT_LINEAR' as const, interval: candle.interval, openTime: candle.openTime, pricePoint: 'CLOSE' as const }
      : null;

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
      async placeOrder(params) {
        // A reduce-only order is a close of the position it reduces; the
        // native engine models that as CLOSE, not as an opposite OPEN.
        if (params.reduceOnly || exitId) {
          const target = exitId ?? state.positions.find(
            (p) => p.symbol === pairToNativeSymbol(params.symbol)
              && p.side === (params.side === 'SELL' ? 'LONG' : 'SHORT'),
          )?.id;
          if (!target) throw new Error('Нет позиции для сокращения');
          const ok = await run({
            kind: 'CLOSE', positionId: target, quantity: params.quantity,
            ...(pickedCandle ? { candle: pickedCandle } : {}),
          });
          if (!ok) throw new Error(native.error || 'Операция не подтверждена');
          return;
        }
        const ok = await run(terminalOrderToNativeDraft({ ...params, candle: pickedCandle }));
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
      // The native engine answers every command with the WHOLE account, so
      // a command has already refreshed what a real refresh would fetch.
      // An explicit refresh is still honoured — it is how the panel's own
      // reload button and the terminal's post-trade nudge reach the engine.
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [requested, allowed, checked, state, fetchedAt, candle, exitId, run, native.error, contract]);
}
