/** Unsaved form values only. These guides never place or modify an order. */
export type TerminalOrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET'
  | 'TAKE_PROFIT_LIMIT' | 'TAKE_PROFIT_MARKET' | 'OCO';

export interface TerminalOrderDraft {
  pair: string;
  side: 'BUY' | 'SELL';
  type: TerminalOrderType;
  entryPrice: number | null;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  /** Actual OCO stop-leg execution limit, never an independent entry order. */
  stopLimitPrice?: number | null;
  quantity: number | null;
}

interface DraftInput {
  pair: string;
  side: TerminalOrderDraft['side'];
  type: TerminalOrderType;
  price: string;
  triggerPrice: string;
  ocoTakeProfitPrice: string;
  ocoStopTriggerPrice: string;
  ocoStopLimitPrice?: string;
  quantity: string;
}

export function positiveTerminalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function createTerminalOrderDraft(input: DraftInput): TerminalOrderDraft | null {
  const conditionalLimit = input.type === 'STOP_LIMIT' || input.type === 'TAKE_PROFIT_LIMIT';
  const entryPrice = input.type === 'LIMIT' || conditionalLimit ? positiveTerminalNumber(input.price) : null;
  const stopPrice = input.type === 'OCO' ? positiveTerminalNumber(input.ocoStopTriggerPrice)
    : input.type === 'STOP_LIMIT' || input.type === 'STOP_MARKET' ? positiveTerminalNumber(input.triggerPrice) : null;
  const takeProfitPrice = input.type === 'OCO' ? positiveTerminalNumber(input.ocoTakeProfitPrice)
    : input.type === 'TAKE_PROFIT_LIMIT' || input.type === 'TAKE_PROFIT_MARKET' ? positiveTerminalNumber(input.triggerPrice) : null;
  const quantity = positiveTerminalNumber(input.quantity);
  const stopLimitPrice = input.type === 'OCO' ? positiveTerminalNumber(input.ocoStopLimitPrice) : null;
  if (entryPrice === null && stopPrice === null && takeProfitPrice === null && stopLimitPrice === null && quantity === null) return null;
  // MARKET has no guaranteed entry price. OCO consists of two actual exit
  // legs, not a third entry with invented attached take-profit/stop orders.
  return { pair: input.pair, side: input.side, type: input.type, entryPrice, stopPrice, takeProfitPrice,
    ...(stopLimitPrice !== null ? { stopLimitPrice } : {}), quantity };
}

export interface TerminalDraftGuide {
  kind: 'ENTRY' | 'EXECUTION_LIMIT' | 'STOP' | 'TAKE_PROFIT' | 'STOP_LIMIT';
  price: number;
  title: string;
  color: string;
}

export function terminalDraftGuides(draft: TerminalOrderDraft | null | undefined, pair: string): TerminalDraftGuide[] {
  if (!draft || draft.pair !== pair) return [];
  const guides: TerminalDraftGuide[] = [];
  const entry = positiveTerminalNumber(draft.entryPrice);
  const stop = positiveTerminalNumber(draft.stopPrice);
  const takeProfit = positiveTerminalNumber(draft.takeProfitPrice);
  const stopLimit = positiveTerminalNumber(draft.stopLimitPrice);
  if (entry !== null && ['LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT'].includes(draft.type)) {
    const conditional = draft.type !== 'LIMIT';
    guides.push({ kind: conditional ? 'EXECUTION_LIMIT' : 'ENTRY', price: entry,
      title: conditional ? 'LIMIT EXECUTION · DRAFT' : 'ENTRY · DRAFT', color: '#d6bd79' });
  }
  if (stop !== null && ['STOP_LIMIT', 'STOP_MARKET', 'OCO'].includes(draft.type)) {
    guides.push({ kind: 'STOP', price: stop, title: 'STOP · DRAFT', color: '#df7181' });
  }
  if (takeProfit !== null && ['TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET', 'OCO'].includes(draft.type)) {
    guides.push({ kind: 'TAKE_PROFIT', price: takeProfit, title: 'TAKE PROFIT · DRAFT', color: '#48bfa0' });
  }
  if (stopLimit !== null && draft.type === 'OCO') {
    guides.push({ kind: 'STOP_LIMIT', price: stopLimit, title: 'STOP LIMIT · DRAFT', color: '#bc96cd' });
  }
  return guides;
}

export interface TerminalBookLevel { price: string; quantity: string; orders?: number }
export interface TerminalAggregatedLevel { price: number; quantity: number; cumulative: number }

export function terminalGroupSteps(referencePrice: number | null): number[] {
  if (positiveTerminalNumber(referencePrice) === null) return [0.1, 0.5, 1, 10, 50];
  const unit = 10 ** Math.max(-18, Math.floor(Math.log10(referencePrice!)) - 5);
  return [1, 5, 10, 50, 100, 500].map(factor => Number((unit * factor).toPrecision(14)));
}

export function defaultTerminalGroupStep(referencePrice: number | null): number {
  const steps = terminalGroupSteps(referencePrice);
  return positiveTerminalNumber(referencePrice) === null ? steps[0] : steps[4];
}

export function formatTerminalLevelPrice(price: number, step: number): string {
  const decimals = Math.max(0, Math.min(20, -Math.floor(Math.log10(step))));
  return price.toFixed(decimals);
}

/** Tiny-token prices/spreads must not become a misleading displayed zero. */
export function formatTerminalQuote(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 10 ? 2 : magnitude >= 1 ? 4
    : Math.min(20, Math.max(6, 5 - Math.floor(Math.log10(magnitude || 1))));
  return value.toLocaleString('en-US', { minimumFractionDigits: magnitude >= 1 ? decimals : 0,
    maximumFractionDigits: decimals });
}

export function formatTerminalSpreadPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 0.001 ? 3 : Math.min(14, Math.max(6, 2 - Math.floor(Math.log10(magnitude || 1))));
  return `${value.toLocaleString('en-US', { minimumFractionDigits: magnitude >= 0.001 ? 3 : 0,
    maximumFractionDigits: decimals })}%`;
}

/** Approximation only; EUR, crypto and unsupported quote assets are not USD. */
export function hasTerminalUsdApproximation(pair: string | undefined): boolean {
  return pair !== undefined && ['USD', 'USDT', 'USDC'].includes(pair.split('/')[1]);
}

export function aggregateTerminalBook(levels: readonly TerminalBookLevel[], step: number,
  side: 'BUY' | 'SELL'): TerminalAggregatedLevel[] {
  if (positiveTerminalNumber(step) === null) return [];
  const buckets = new Map<number, number>();
  for (const level of levels) {
    const price = positiveTerminalNumber(level.price);
    const quantity = positiveTerminalNumber(level.quantity);
    if (price === null || quantity === null) continue;
    const units = price / step;
    // Remove only machine-rounding noise at an exact grid boundary.
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(units)) * 4;
    const bucketUnits = side === 'BUY' ? Math.floor(units + tolerance) : Math.ceil(units - tolerance);
    const bucket = Number((bucketUnits * step).toPrecision(14));
    if (bucket <= 0) continue;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + quantity);
  }
  let cumulative = 0;
  return [...buckets.entries()].sort((a, b) => side === 'BUY' ? b[0] - a[0] : a[0] - b[0])
    .map(([price, quantity]) => ({ price, quantity, cumulative: cumulative += quantity }));
}
