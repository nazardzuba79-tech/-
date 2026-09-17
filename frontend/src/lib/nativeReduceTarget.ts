import type { NativeCandle, NativeDraft, NativePosition } from './nativeDemoApi';
import { pairToNativeSymbol, terminalOrderToNativeDraft } from './nativeFuturesAdapter';
import { PrivateTradingError } from './privateTradingError';

/** A table close names a position, not merely a symbol and a coincidentally equal size. */
export interface FuturesCloseTicket {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  marginType: 'CROSS' | 'ISOLATED';
  seq: number;
}

interface NativeOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price?: string;
  quantity: string;
  leverage: number;
  marginType: 'CROSS' | 'ISOLATED';
  reduceOnly?: boolean;
  /** An explicit table target. Never inferred from quantity. */
  positionId?: string;
}

type TargetParams = Pick<NativeOrderParams, 'symbol' | 'side' | 'marginType'>;

/**
 * An explicit id must match an OPEN position on this symbol and closing side.
 * Its own margin mode wins over an old form default. An invalid id never
 * falls back to a neighbour. Without an id, exactly ONE candidate in the
 * selected bucket is required. Quantity is deliberately not an input.
 */
export function resolveNativeReduceTarget(
  positions: readonly NativePosition[],
  params: TargetParams,
  positionId: string | null | undefined,
): NativePosition | undefined {
  const symbol = pairToNativeSymbol(params.symbol);
  const side = params.side === 'SELL' ? 'LONG' : 'SHORT';
  const candidates = positions.filter(p => p.status === 'OPEN' && p.symbol === symbol && p.side === side);
  if (positionId !== null && positionId !== undefined) {
    return positionId ? candidates.find(p => p.id === positionId) : undefined;
  }
  const bucket = candidates.filter(p => p.marginMode === params.marginType);
  return bucket.length === 1 ? bucket[0] : undefined;
}

/**
 * Used by the real native execution hook and tested without importing React
 * or Vite. The hook supplies its CURRENT state ref at the moment of submit.
 * Table closes are live intents: an earlier chart pick cannot change their
 * target or silently backdate them. Deliberate chart-only orders keep their
 * existing historical behaviour.
 */
export function nativeOrderDraft(
  positions: readonly NativePosition[],
  params: NativeOrderParams,
  chartExitId: string | null,
  pickedCandle: NativeCandle | null,
): NativeDraft {
  const tableTarget = params.positionId !== undefined;
  if (tableTarget && !params.reduceOnly) {
    throw new PrivateTradingError('Закрытие выбранной позиции должно быть Reduce-only.', 409);
  }
  const reducing = !!params.reduceOnly || chartExitId !== null;
  const candle = tableTarget ? null : pickedCandle;
  if (!reducing) return terminalOrderToNativeDraft({ ...params, candle });

  const target = resolveNativeReduceTarget(positions, params, tableTarget ? params.positionId : chartExitId);
  if (!target) {
    throw new PrivateTradingError(
      'Невозможно однозначно определить позицию для сокращения. Выберите открытую позицию в таблице и повторите.',
      409,
    );
  }
  if (params.type === 'MARKET') {
    return { kind: 'CLOSE', positionId: target.id, quantity: params.quantity, ...(candle ? { candle } : {}) };
  }
  return terminalOrderToNativeDraft({
    ...params,
    reduceOnly: true,
    positionId: target.id,
    marginType: target.marginMode,
    candle,
  });
}
