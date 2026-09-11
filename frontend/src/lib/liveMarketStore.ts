import type { LiveQuote, LiveState } from './liveMarketTypes';

type Source = Pick<EventSource, 'addEventListener' | 'close' | 'onerror'>;
/** Reference-only store. Existing marketDataStore continues polling Kraken
 * for existing consumers; no execution-adjacent quote is overwritten. */
export class LiveMarketStore {
  private state: LiveState = { status: 'connecting', rows: new Map(), revision: 0 };
  private listeners = new Set<(state: LiveState) => void>();
  private source: Source | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private epoch: string | null = null;
  private wireRevision = -1;
  private lastMessage = 0;
  private attempts = 0;
  constructor(private createSource: () => Source) {}
  getState = (): LiveState => this.state;
  subscribe = (listener: (state: LiveState) => void): (() => void) => {
    this.listeners.add(listener); listener(this.state);
    if (!this.source && !this.retry) this.connect();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.stopTransport(); this.stale(); }
    };
  };
  private emit(): void { for (const listener of this.listeners) listener(this.state); }
  private stale(): void {
    this.state = { status: 'stale', revision: this.state.revision + 1,
      rows: new Map([...this.state.rows].map(([id,row]) => [id,{ ...row, stale: true }])) };
    this.emit();
  }
  private connect(): void {
    if (!this.listeners.size || this.source) return;
    try {
      const source = this.createSource(); this.source = source; this.lastMessage = Date.now();
      const connectedAt = Date.now();
      let initialized = false;
      const receive = (event: Event) => {
        if (this.source !== source) return;
        try {
          const frame = JSON.parse((event as MessageEvent).data);
          if (frame.status === 'disabled') {
            this.stopTransport(); this.stale(); this.state = { ...this.state, status: 'disabled' }; this.emit(); this.schedule(60_000); return;
          }
          if (frame.version !== 1 || !['snapshot','delta','state'].includes(frame.type) ||
              !['live','connecting','stale'].includes(frame.status) || !Array.isArray(frame.rows) || frame.rows.length > 20_000 ||
              !Number.isSafeInteger(frame.revision) || typeof frame.epoch !== 'string') throw new Error('Invalid live frame');
          if ((!initialized && frame.type !== 'snapshot') || (initialized &&
              (frame.epoch !== this.epoch || frame.revision < this.wireRevision ||
               (frame.type === 'delta' && frame.revision !== this.wireRevision + 1)))) throw new Error('Live stream gap');
          const rows = frame.type === 'snapshot' ? new Map<string, LiveQuote>() : new Map(this.state.rows);
          for (const row of frame.rows) {
            if (!row || typeof row.id !== 'string' || row.id !== `${row.marketType}:${row.providerSymbol}` ||
                typeof row.baseAsset !== 'string' || typeof row.quoteAsset !== 'string' || typeof row.stale !== 'boolean' ||
                ['lastPrice','changePercent24h','quoteVolume24h'].some(k => row[k] !== null && (typeof row[k] !== 'number' || !Number.isFinite(row[k])))) throw new Error('Invalid live row');
            rows.set(row.id,row);
          }
          initialized = true; this.epoch = frame.epoch; this.wireRevision = frame.revision;
          this.lastMessage = Date.now(); if (Date.now() - connectedAt >= 60_000) this.attempts = 0;
          this.state = { rows, status: frame.status, revision: this.state.revision + 1 }; this.emit();
        } catch { this.failed(); }
      };
      for (const name of ['snapshot','delta','state']) source.addEventListener(name, receive);
      source.onerror = () => { if (this.source === source) this.failed(); };
      this.watchdog = setInterval(() => { if (Date.now() - this.lastMessage > 40_000) this.failed(); }, 10_000);
    } catch { this.failed(); }
  }
  private failed(): void {
    this.stopTransport(); this.stale();
    this.schedule(Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.75 + Math.random() * 0.25));
  }
  private schedule(ms: number): void {
    if (this.listeners.size && !this.retry) this.retry = setTimeout(() => { this.retry = null; this.connect(); }, ms);
  }
  private stopTransport(): void {
    const source = this.source; this.source = null; source?.close();
    if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null;
    if (this.retry) clearTimeout(this.retry); this.retry = null;
  }
}
