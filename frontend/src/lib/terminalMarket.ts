import type { BookLevel } from './krakenSocket';

/** Quote-currency notional from the observed book only, never a liquidity score. */
export function terminalBookMetrics(bids: BookLevel[], asks: BookLevel[]) {
  const valid = (levels: BookLevel[]) => levels.map(l => ({ price: Number(l.price), quantity: Number(l.quantity) }))
    .filter(l => Number.isFinite(l.price) && Number.isFinite(l.quantity) && l.price > 0 && l.quantity > 0);
  const bidLevels = valid(bids).sort((a, b) => b.price - a.price);
  const askLevels = valid(asks).sort((a, b) => a.price - b.price);
  const bestBid = bidLevels[0]?.price ?? null;
  const bestAsk = askLevels[0]?.price ?? null;
  const complete = bestBid !== null && bestAsk !== null && bestAsk >= bestBid;
  const mid = complete ? (bestBid + bestAsk) / 2 : null;
  const spread = complete ? bestAsk - bestBid : null;
  const bidNotional = mid === null ? null : bidLevels.filter(l => l.price >= mid * 0.995).reduce((s, l) => s + l.price * l.quantity, 0);
  const askNotional = mid === null ? null : askLevels.filter(l => l.price <= mid * 1.005).reduce((s, l) => s + l.price * l.quantity, 0);
  const depth = bidNotional === null || askNotional === null ? null : bidNotional + askNotional;
  return { bestBid, bestAsk, mid, spread, spreadPercent: spread === null || mid === null ? null : spread / mid * 100,
    bidNotional, askNotional, depth, bidShare: depth && bidNotional !== null ? bidNotional / depth : null,
    bidLevels, askLevels };
}

export type TerminalWorkspace = 'standard' | 'chart' | 'flow';
export function workspacePreset(workspace: TerminalWorkspace) {
  return { railCollapsed: workspace === 'chart', dockOpen: workspace !== 'chart', railTab: workspace === 'flow' ? 'book' as const : 'order' as const };
}
