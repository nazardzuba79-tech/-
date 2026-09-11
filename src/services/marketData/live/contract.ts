import type { LiveTicker } from '../bybit/types';

export type LiveStatus = 'disabled' | 'connecting' | 'live' | 'stale';
export interface LiveFrame {
  version: 1;
  type: 'snapshot' | 'delta' | 'state';
  epoch: string;
  revision: number;
  sentAt: number;
  status: LiveStatus;
  rows: LiveTicker[];
}
export interface LiveSource {
  snapshot(): LiveFrame;
  subscribe(listener: (frame: LiveFrame) => void): () => void;
}

/** Bounded by the instrument universe. No per-client event history. */
export class LiveFeed implements LiveSource {
  readonly rows = new Map<string, LiveTicker>();
  private listeners = new Set<(frame: LiveFrame) => void>();
  private revision = 0;
  status: LiveStatus = 'connecting';
  constructor(readonly epoch: string, private now = Date.now) {}
  snapshot(): LiveFrame {
    return { version: 1, type: 'snapshot', epoch: this.epoch, revision: this.revision,
      sentAt: this.now(), status: this.status, rows: [...this.rows.values()] };
  }
  publish(type: LiveFrame['type'], rows: LiveTicker[] = []): void {
    if (type === 'snapshot') this.rows.clear();
    for (const row of rows) this.rows.set(row.id, row);
    const frame: LiveFrame = { version: 1, type, epoch: this.epoch, revision: ++this.revision,
      sentAt: this.now(), status: this.status, rows };
    for (const listener of this.listeners) listener(frame);
  }
  subscribe(listener: (frame: LiveFrame) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  get subscriberCount(): number { return this.listeners.size; }
}

/** Nonzero floor, exponential growth, bounded jitter. Shared transport policy. */
export function reconnectDelay(attempt: number, random = Math.random): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) * (0.75 + random() * 0.25);
}
