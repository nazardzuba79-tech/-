// One visible chart visit. Credentials stay in memory and are never put in a URL.
export class StockChartDemand {
  private active: { id: string; view: string; headers: Record<string, string>; csrf?: string; abort: AbortController } | null = null;
  constructor(private readonly send: typeof fetch = fetch, private readonly uuid: () => string = () => crypto.randomUUID()) {}
  open(id: string, headers: Record<string, string>) {
    if (this.active && (this.active.id !== id || this.active.headers.Authorization !== headers.Authorization)) this.close();
    this.active ??= { id, view: this.uuid(), headers, abort: new AbortController() };
    const active = this.active;
    return {
      headers: { ...headers, 'X-Stocks-View': active.view }, signal: active.abort.signal,
      accept: (csrf: string) => { if (this.active === active) active.csrf = csrf; },
    };
  }
  signal() { return this.active?.abort.signal; }
  headers(): Record<string, string> { return this.active ? { 'X-Stocks-View': this.active.view } : {}; }
  close() {
    const active = this.active; this.active = null;
    if (!active) return;
    active.abort.abort();
    if (!active.csrf) return;
    // A release is idempotent; never retry or replay a financial command.
    void this.send('/__stocks_global/lease?id=' + encodeURIComponent(active.id), {
      method: 'DELETE', credentials: 'omit', cache: 'no-store', keepalive: true,
      headers: { ...active.headers, 'X-Stocks-Token': active.csrf, 'X-Stocks-View': active.view },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}
