import { useEffect, useMemo, useState } from 'react';
import { getCfdPaperState, subscribeCfdPaperStore } from './cfdPaperStore';
import type { ChartPositionLine } from './chartTrading';

/**
 * The open practice positions as chart lines (2026-10-15): the entry price,
 * which is the practice's own fill. No liquidation line: the practice keeps
 * an order-time estimate (lib/futuresMath previewLiquidationPrice) and runs
 * no liquidation engine, and an estimate must never be drawn as a level a
 * trader reads as their liquidation. No TP/SL: the practice has none.
 */
export function useCfdPracticePositionLines(enabled = true): ChartPositionLine[] {
  const [state, setState] = useState(() => (enabled ? getCfdPaperState() : { open: [], history: [] }));
  useEffect(() => {
    if (!enabled) return;
    setState(getCfdPaperState());
    return subscribeCfdPaperStore(() => setState(getCfdPaperState()));
  }, [enabled]);
  const key = state.open.map(p => `${p.id}:${p.side}:${p.entryPrice}`).join('|');
  return useMemo(() => state.open.map(p => ({ id: p.id, symbol: p.symbol, side: p.side, entryPrice: p.entryPrice, liquidationPrice: null, takeProfit: null, stopLoss: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
}
