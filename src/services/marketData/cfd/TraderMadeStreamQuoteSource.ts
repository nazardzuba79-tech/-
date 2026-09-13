import BigNumber from 'bignumber.js';
import WebSocket, { type RawData } from 'ws';
import { CFD_REFERENCE_CATALOG } from './catalog';
import { assertCfdFreshQuote, CfdQuoteUnavailable, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './CfdQuote';

/**
 * TraderMade streaming adapter. This is deliberately an EXECUTION-capable
 * source only after three independent gates all pass:
 *   1) a streaming key is configured and the server accepts the subscription,
 *   2) the operator explicitly lists the VOLTEX symbol as entitled,
 *   3) a non-secret evidence identifier confirms the permitted financial use.
 *
 * No REST polling, no invented market-open flag, and no freshness based on
 * request time. Every executable observation must carry the per-tick upstream
 * timestamp from the WebSocket stream. When the stream stops, cached quotes
 * simply age out and fail closed.
 */
export const TRADERMADE_CFD_SYMBOLS: Record<string, string> = {
  XAUUSD: 'XAUUSD',
  XAGUSD: 'XAGUSD',
  XPTUSD: 'XPTUSD',
  XPDUSD: 'XPDUSD',
  WTIUSD: 'OILUSD',
  XBRUSD: 'UKOILUSD',
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY',
  AUDUSD: 'AUDUSD',
  USDCAD: 'USDCAD',
  USDCHF: 'USDCHF',
  NZDUSD: 'NZDUSD',
};
const PROVIDER_TO_VOL = new Map(Object.entries(TRADERMADE_CFD_SYMBOLS).map(([voltex, provider]) => [provider, voltex]));
const PRICE = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function decimalText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : null;
  if (typeof value !== 'string' || !PRICE.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  return value;
}

export function traderMadeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value !== 'string') return null;
  if (/^\d{10,13}$/.test(value)) {
    const n = Number(value); return value.length <= 10 ? n * 1000 : n;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const ms = Number((m[7] ?? '').padEnd(3, '0'));
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
  const d = new Date(at);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])
    || d.getUTCHours() !== Number(m[4]) || d.getUTCMinutes() !== Number(m[5]) || d.getUTCSeconds() !== Number(m[6])) return null;
  return at;
}

/** Provider V2 omits `m` on ordinary QUOTE ticks. A midpoint derived exactly
 * from the provider's real bid+ask is deterministic market-data derivation,
 * not a fabricated spread or guessed number. The basis is exposed in diagnostics. */
export function traderMadePrice(bidRaw: unknown, askRaw: unknown, midRaw: unknown): { bid: string; ask: string; mid: string; basis: 'provider_mid' | 'derived_mid' } | null {
  const bid = decimalText(bidRaw), ask = decimalText(askRaw);
  if (!bid || !ask) return null;
  const b = new BigNumber(bid), a = new BigNumber(ask);
  if (!b.isFinite() || !a.isFinite() || b.isGreaterThan(a)) return null;
  const given = decimalText(midRaw);
  if (given) {
    const m = new BigNumber(given);
    if (m.isLessThan(b) || m.isGreaterThan(a)) return null;
    return { bid, ask, mid: given, basis: 'provider_mid' };
  }
  const mid = b.plus(a).div(2).toString(10);
  return { bid, ask, mid, basis: 'derived_mid' };
}

export interface TraderMadeStreamOptions {
  now?: () => number;
  maxQuoteAgeMs?: number;
  entitledSymbols?: string[];
  executionSymbols?: string[];
  /** Contract / provider ticket / agreement ID. It is not an API key. */
  financialUseEvidence?: string;
  url?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  firstQuoteWaitMs?: number;
  socketFactory?: (url: string) => WebSocket;
}

export class TraderMadeStreamQuoteSource implements CfdQuoteSource {
  readonly maxQuoteAgeMs: number;
  private readonly now: () => number;
  private readonly entitled: Set<string>;
  private readonly executable: Set<string>;
  private readonly evidence: string;
  private readonly url: string;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly firstQuoteWaitMs: number;
  private readonly socketFactory: (url: string) => WebSocket;
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private loggedIn = false;
  private accepted = new Set<string>();
  private denied = new Map<string, string>();
  private quotes = new Map<string, CfdQuote>();
  private basis = new Map<string, 'provider_mid' | 'derived_mid'>();
  private waiters = new Map<string, Set<() => void>>();
  private lastMessageAt: number | null = null;
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;

  constructor(private readonly apiKey: string | undefined, options: TraderMadeStreamOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxQuoteAgeMs = quoteAgeLimit(options.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS);
    this.entitled = new Set(options.entitledSymbols ?? []);
    this.executable = new Set(options.executionSymbols ?? []);
    for (const symbol of [...this.entitled, ...this.executable]) if (!(symbol in TRADERMADE_CFD_SYMBOLS)) throw new Error('Unverified TraderMade CFD symbol');
    this.evidence = options.financialUseEvidence?.trim() ?? '';
    this.url = options.url ?? 'wss://stream.tradermade.com/feedAdv';
    this.reconnectBaseMs = Math.max(250, Math.min(30_000, options.reconnectBaseMs ?? 1_000));
    this.reconnectMaxMs = Math.max(this.reconnectBaseMs, Math.min(120_000, options.reconnectMaxMs ?? 30_000));
    this.firstQuoteWaitMs = Math.max(100, Math.min(5_000, options.firstQuoteWaitMs ?? 1_200));
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
  }

  isConfigured(): boolean { return Boolean(this.apiKey && this.evidence); }

  start(): void {
    if (!this.apiKey || !this.stopped) return;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket; this.socket = null;
    if (socket) {
      try { socket.removeAllListeners(); socket.close(); } catch { /* shutdown */ }
    }
    this.loggedIn = false;
    this.accepted.clear();
  }

  private connect(): void {
    if (this.stopped || !this.apiKey || this.socket) return;
    let socket: WebSocket;
    try { socket = this.socketFactory(this.url); }
    catch { this.scheduleReconnect(); return; }
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.lastConnectedAt = this.now(); this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ action: 'login', key: this.apiKey, fmt: 'JSON' }));
    });
    socket.on('message', (data: RawData) => { if (this.socket === socket && !this.stopped) this.handleMessage(data.toString()); });
    socket.on('error', () => {
      if (this.socket !== socket || this.stopped) return;
      try { socket.terminate(); } catch { /* close handler reconnects */ }
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null; this.loggedIn = false; this.accepted.clear(); this.lastDisconnectedAt = this.now();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.apiKey) return;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** Math.min(10, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Kept public for deterministic parser/stream tests; contains no credentials. */
  handleMessage(text: string): void {
    if (text.length > 128_000) return;
    let raw: any;
    try { raw = JSON.parse(text); } catch { return; }
    this.lastMessageAt = this.now();
    if (raw?.type === 'login_ok') {
      this.loggedIn = true;
      const symbols = Object.values(TRADERMADE_CFD_SYMBOLS).map(s => `${s}:QUOTE`);
      try { this.socket?.send(JSON.stringify({ action: 'subscribe', symbols, send_last: true })); } catch { /* reconnect path owns failure */ }
      return;
    }
    if (raw?.type === 'login_reject' || raw?.type === 'logout') {
      this.loggedIn = false; this.accepted.clear();
      try { this.socket?.close(); } catch { /* no-op */ }
      return;
    }
    if (raw?.type === 'sub_ack') {
      this.accepted = new Set(Array.isArray(raw.accepted) ? raw.accepted.filter((x: unknown): x is string => typeof x === 'string') : []);
      this.denied.clear();
      const reasons = raw.denied_reasons && typeof raw.denied_reasons === 'object' ? raw.denied_reasons : {};
      for (const item of [...(Array.isArray(raw.denied) ? raw.denied : []), ...(Array.isArray(raw.invalid) ? raw.invalid : [])]) {
        if (typeof item === 'string') this.denied.set(item, typeof reasons[item] === 'string' ? reasons[item] : 'denied');
      }
      return;
    }
    if (raw?.t !== 'QUOTE' && raw?.t !== 'LAST_QUOTE') return;
    const providerSymbol = typeof raw.s === 'string' ? raw.s : '';
    const symbol = PROVIDER_TO_VOL.get(providerSymbol);
    if (!symbol || !this.accepted.has(`${providerSymbol}:QUOTE`)) return;
    const at = traderMadeTimestamp(raw.ts), price = traderMadePrice(raw.b, raw.a, raw.m);
    const receivedAt = this.now();
    if (at === null || !price || at <= 0 || at > receivedAt + 1_000) return;
    const rights = this.evidence.length > 0;
    const entitled = rights && this.entitled.has(symbol);
    const stale = receivedAt - at > this.maxQuoteAgeMs;
    const quote: CfdQuote = {
      provider: 'tradermade', symbol, providerSymbol,
      bid: Number(price.bid), ask: Number(price.ask), mid: Number(price.mid), last: Number(price.mid), lastDecimal: price.mid,
      providerTimestamp: at, fetchedAt: receivedAt, stale,
      status: entitled ? (stale ? 'stale' : 'live') : 'entitlement_required',
      referenceStatus: stale ? 'stale' : 'available', entitlementVerified: entitled,
      executionAllowed: entitled && this.executable.has(symbol),
    };
    this.quotes.set(symbol, quote); this.basis.set(symbol, price.basis);
    for (const notify of this.waiters.get(symbol) ?? []) notify();
  }

  private current(symbol: string): CfdQuote {
    const providerSymbol = TRADERMADE_CFD_SYMBOLS[symbol];
    const saved = this.quotes.get(symbol);
    const accepted = this.accepted.has(`${providerSymbol}:QUOTE`);
    const entitled = Boolean(this.evidence) && this.entitled.has(symbol) && accepted;
    if (!saved) return {
      provider: 'tradermade', symbol, providerSymbol, bid: null, ask: null, mid: null, last: null,
      providerTimestamp: null, fetchedAt: null, stale: false,
      status: this.apiKey && (!this.evidence || !entitled) ? 'entitlement_required' : 'unavailable', referenceStatus: 'unavailable',
      entitlementVerified: false, executionAllowed: false,
    };
    const now = this.now();
    const stale = saved.providerTimestamp === null || saved.fetchedAt === null || saved.providerTimestamp > now + 1_000
      || saved.fetchedAt > now + 1_000 || now - saved.providerTimestamp > this.maxQuoteAgeMs || now - saved.fetchedAt > this.maxQuoteAgeMs;
    return { ...saved, stale, status: entitled ? (stale ? 'stale' : 'live') : 'entitlement_required',
      referenceStatus: stale ? 'stale' : 'available', entitlementVerified: entitled,
      executionAllowed: entitled && this.executable.has(symbol) };
  }

  async getQuotes(): Promise<CfdQuote[]> {
    return CFD_REFERENCE_CATALOG.map(i => this.current(i.symbol));
  }

  async getFreshQuote(symbol: string): Promise<CfdQuote> {
    if (!(symbol in TRADERMADE_CFD_SYMBOLS) || !this.isConfigured()) {
      assertCfdFreshQuote(undefined, symbol, this.maxQuoteAgeMs, this.now());
    }
    let quote = this.current(symbol);
    try { assertCfdFreshQuote(quote, symbol, this.maxQuoteAgeMs, this.now()); return quote; }
    catch { /* wait for one fresh tick */ }
    if (this.stopped) this.start();
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(symbol) ?? new Set<() => void>();
      let timer: NodeJS.Timeout;
      const done = () => { clearTimeout(timer); set.delete(done); if (!set.size) this.waiters.delete(symbol); resolve(); };
      set.add(done); this.waiters.set(symbol, set); timer = setTimeout(done, this.firstQuoteWaitMs);
    });
    quote = this.current(symbol);
    assertCfdFreshQuote(quote, symbol, this.maxQuoteAgeMs, this.now());
    return quote;
  }

  catalog() {
    return CFD_REFERENCE_CATALOG.map(i => ({ ...i, provider: 'tradermade', providerSymbol: TRADERMADE_CFD_SYMBOLS[i.symbol],
      entitlement: this.current(i.symbol).entitlementVerified ? 'verified' : 'entitlement_required',
      executionAllowed: this.current(i.symbol).executionAllowed }));
  }

  diagnostics() {
    return {
      provider: 'tradermade', keyConfigured: Boolean(this.apiKey), financialUseEvidenceConfigured: Boolean(this.evidence),
      configured: this.isConfigured(), started: !this.stopped, connected: this.socket?.readyState === WebSocket.OPEN,
      loggedIn: this.loggedIn, acceptedSymbols: [...this.accepted].sort(), deniedSymbols: [...this.denied.entries()].map(([symbol, reason]) => ({ symbol, reason })),
      lastMessageAt: this.lastMessageAt, lastConnectedAt: this.lastConnectedAt, lastDisconnectedAt: this.lastDisconnectedAt,
      reconnectAttempt: this.reconnectAttempt,
      priceBasis: Object.fromEntries([...this.basis.entries()]),
      quotes: CFD_REFERENCE_CATALOG.map(i => { const q = this.current(i.symbol); return { symbol: i.symbol, status: q.status, stale: q.stale,
        providerTimestamp: q.providerTimestamp, fetchedAt: q.fetchedAt, entitlementVerified: q.entitlementVerified, executionAllowed: q.executionAllowed }; }),
    };
  }
}
