import type { NativeEvent } from './nativeDemoApi';

export interface ChartExit { time: number; price: number; kind: string; quantity: number }

/**
 * ONE CLOSE ACTION, ONE MARKER.
 *
 * A market close can consume many depth levels. The engine correctly emits
 * one fill event per level — exact accounting stays in the ledger — but the
 * chart is a trade view, not a fill tape: one close action should be one
 * small exit marker. Fills are folded by the `actionId` the engine stamps
 * on every settlement of one journaled instruction; that is an identity,
 * where the old "within 15 seconds" window was a guess that could join two
 * different partial closes or split one large one. Older events with no
 * `actionId` keep the window rule so existing history draws as it did.
 */
export function chartExits(events: NativeEvent[], positionId: string): ChartExit[] {
  type Exit = ChartExit & { lastTime: number; actionId: string | null };
  const result: Exit[] = [];
  const numeric = (id: string) => Number(id.replace(/^e/, ''));
  const source = events.filter(e => e.positionId === positionId && ['CLOSE', 'TAKE_PROFIT', 'STOP_LOSS', 'LIQUIDATION'].includes(e.kind))
    .filter(e => e.price !== null && Number.isFinite(Number(e.price)) && Number.isFinite(Number(e.quantity)) && Number(e.quantity) > 0)
    // Journal order: time, then the engine's monotonic event number (not a string compare, where 'e10' < 'e9').
    .sort((a, b) => a.time - b.time || numeric(a.id) - numeric(b.id) || a.id.localeCompare(b.id));
  for (const event of source) {
    const price = Number(event.price), quantity = Number(event.quantity), previous = result.length ? result[result.length - 1] : undefined;
    const actionId = event.actionId ?? null;
    const sameAction = previous !== undefined && previous.kind === event.kind
      && (actionId !== null ? previous.actionId === actionId : previous.actionId === null && event.kind === 'CLOSE' && event.time - previous.lastTime <= 15_000);
    if (sameAction && previous) {
      const total = previous.quantity + quantity;
      previous.price = (previous.price * previous.quantity + price * quantity) / total;
      previous.quantity = total; previous.time = event.time; previous.lastTime = event.time;
    } else result.push({ time: event.time, price, kind: event.kind, quantity, lastTime: event.time, actionId });
  }
  return result.map(({ lastTime: _l, actionId: _a, ...exit }) => exit);
}
