import { useMemo } from 'react';
import type { FuturesExecution } from './futuresExecution';
import { REAL_FUTURES_EXECUTION } from './futuresExecution';
import {
  nativeAccountState, terminalOrderToNativeDraft, pairToNativeSymbol,
} from './nativeFuturesAdapter';
import type { NativeDemoController } from '../pages/private-trading/useNativeDemo';
import type { FuturesContractRules } from './futuresMath';

/** Owner terminal backed by the native engine; fail closed, never real fallback. */
export function useNativeFuturesExecution(
  native: NativeDemoController,
  contract: FuturesContractRules | null,
): FuturesExecution | null {
  const state = native.state;
  const binding = native.binding;
  const allowed = native.allowed;
  const checked = native.checked;
  const candle = native.candle;
  const exitId = native.exitId;
  const run = native.run;
  const fetchedAt = state?.asOf ?? 0;

  return useMemo(() => {
    if (binding === 'ordinary') return null;

    const account = nativeAccountState(state, {
      loading: binding === 'unknown' || !checked || (allowed && state === null),
      failed: checked && binding === 'owner' && !allowed,
      fetchedAt,
    });
    const pickedCandle = candle
      ? { source: 'BYBIT_LINEAR' as const, interval: candle.interval, openTime: candle.openTime, pricePoint: 'CLOSE' as const }
      : null;
    // Preview only. The command still sends candle identity and the server resolves the execution price itself.
    const selectedEntryPrice = candle && Number.isFinite(candle.close) && candle.close > 0 ? candle.close : null;
    const aggregate = state?.account ?? null;
    const waiting = state && !state.initialized ? state.demoAvailable ?? null : null;
    const activation = waiting !== null && Number(waiting) > 0
      ? { available: waiting, asset: 'USDT', pending: native.busy, begin: () => { void native.initialize(); } }
      : null;

    const refuse = async () => { throw new Error('Торговый счёт ещё не загружен'); };
    const ready = allowed && state !== null && state.initialized;
    if (!ready) {
      return {
        ...REAL_FUTURES_EXECUTION,
        engine: 'NATIVE' as const,
        ready: false,
        account,
        // Native now accepts the trader's real Cross/Isolated selection.
        marginType: null,
        candle: pickedCandle,
        selectedEntryPrice,
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
      marginType: null,
      candle: pickedCandle,
      selectedEntryPrice,
      contract,
      account_aggregate: aggregate,
      activation,
      async placeOrder(params) {
        const reducing = params.reduceOnly || Boolean(exitId);
        const target = !reducing ? undefined : params.positionId ?? exitId ?? state.positions.find(
          (p) => p.symbol === pairToNativeSymbol(params.symbol)
            && p.side === (params.side === 'SELL' ? 'LONG' : 'SHORT')
            && p.marginType === params.marginType,
        )?.id;
        if (reducing && !target) throw new Error('Нет позиции для сокращения');

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
      showPnlCard: (positionId: string) => { void native.showCard(positionId); },
      refresh: () => { void run({ kind: 'REFRESH' }); },
    };
  }, [binding, allowed, checked, state, fetchedAt, candle, exitId, run, native.error, contract, native.showCard, native.busy, native.initialize]);
}
