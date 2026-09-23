export interface DisplayTrade { id: string; price: string; quantity: string; time: number; side: 'BUY' | 'SELL' }
export interface DisplayTrades { symbol: string; trades: DisplayTrade[] }
/** Public, historical observations only. No price interpolation, invented fills or account access. */
export class FuturesDisplayTrades {
  private cache = new Map<string, { at: number; value: DisplayTrades }>();
  private pending = new Map<string, Promise<DisplayTrades>>();
  constructor(private collector?: { url: string; token: string }, private request: typeof fetch = fetch,
    private now: () => number = Date.now) {}
  async get(symbol: string): Promise<DisplayTrades> {
    if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) throw new RangeError('Invalid public trade symbol');
    const hit = this.cache.get(symbol);
    if (hit && this.now() - hit.at < 60_000) return hit.value;
    const previous = this.pending.get(symbol); if (previous) return previous;
    if (this.pending.size >= 8) throw new Error('Public trade display busy');
    const load = (async () => {
      let url = `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${encodeURIComponent(symbol)}&limit=30`;
      const options: RequestInit = { signal: AbortSignal.timeout(8000), redirect: 'error' };
      if (this.collector) {
        const base = new URL(this.collector.url);
        if (!this.collector.token.trim() || base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
          (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) throw new Error('Invalid display collector');
        url = `${base.origin}/internal/v1/futures/trades/${symbol}`;
        options.headers = { Authorization: `Bearer ${this.collector.token}` };
      }
      const response = await this.request(url, options);
      if (!response.ok) throw new Error('Public trade snapshot unavailable');
      const body: any = await response.json();
      let rows: any[];
      if (this.collector) {
        if (body?.symbol !== symbol || !Array.isArray(body.trades)) throw new Error('Trade snapshot identity mismatch');
        rows = body.trades;
      } else {
        if (body?.retCode !== 0 || body.result?.category !== 'linear' || !Array.isArray(body.result.list)) throw new Error('Invalid public trade response');
        rows = body.result.list.map((row: any) => {
          if (row.symbol !== symbol || !['Buy', 'Sell'].includes(row.side)) throw new Error('Trade identity mismatch');
          return { id: row.execId, price: row.price, quantity: row.size, time: Number(row.time), side: row.side === 'Buy' ? 'BUY' : 'SELL' };
        });
      }
      if (rows.length > 30) throw new Error('Oversized trade snapshot');
      const seen = new Set<string>();
      const trades: DisplayTrade[] = rows.map(row => {
        if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 128 || seen.has(row.id) ||
          !['BUY', 'SELL'].includes(row.side) || !Number.isSafeInteger(row.time) || row.time <= 0 ||
          [row.price, row.quantity].some(v => typeof v !== 'string' || v.length > 64 || !/^\d+(?:\.\d+)?$/.test(v) || !Number.isFinite(Number(v)) || Number(v) <= 0)) throw new Error('Invalid trade observation');
        seen.add(row.id);
        return { id: row.id, price: row.price, quantity: row.quantity, time: row.time, side: row.side };
      }).sort((a, b) => b.time - a.time);
      const value = { symbol, trades };
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(symbol, { at: this.now(), value }); return value;
    })();
    this.pending.set(symbol, load);
    try { return await load; } finally { this.pending.delete(symbol); }
  }
}
