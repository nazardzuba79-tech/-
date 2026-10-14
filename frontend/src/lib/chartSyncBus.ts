/**
 * Cursor and time synchronisation between the charts of one workspace
 * (2026-10-13). A pane publishes what its own user did; every other pane
 * applies it. The bus carries nothing but times and ranges — no prices
 * are invented and no request is made on its account.
 */
export type ChartSyncEvent =
  | { kind: 'crosshair'; time: number | null }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'timeframe'; timeframe: string };

type Listener = (event: ChartSyncEvent, source: string) => void;

export interface ChartSyncBus {
  publish(source: string, event: ChartSyncEvent): void;
  subscribe(listener: Listener): () => void;
  /** How many panes listen (diagnostics and tests). */
  size(): number;
}

export function createChartSyncBus(): ChartSyncBus {
  const listeners = new Set<Listener>();
  let depth = 0;
  return {
    publish(source, event) {
      // A pane applying an event may fire its own listeners: those echoes stop here.
      if (depth > 0) return;
      depth += 1;
      try { listeners.forEach(fn => fn(event, source)); } finally { depth -= 1; }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    size: () => listeners.size,
  };
}
