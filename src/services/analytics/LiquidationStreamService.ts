import WebSocket from 'ws';
import { ProviderHealth, logCircuitTransition, providerHealthRegistry } from '../marketData/ProviderHealth';
import { available, unavailable, type Availability } from '../marketData/types';

const DEFAULT_URL = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_EVENTS = 20_000;
const TRACKED_SYMBOLS: Record<string, string> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  SOLUSDT: 'SOL',
  XRPUSDT: 'XRP',
};
const WINDOW_HOURS = [4, 12, 24] as const;

export interface LiquidationEvent {
  id: string;
  symbol: string;
  baseAsset: string;
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  notionalUsd: number;
  tradeTime: number;
}

export interface LiquidationPriceBucket {
  fromPrice: number;
  toPrice: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  eventCount: number;
}

export interface LiquidationWindow {
  hours: number;
  from: number;
  to: number;
  coverageStartAt: number | null;
  coverageComplete: boolean;
  eventCount: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  totalNotionalUsd: number;
  largestEvent: LiquidationEvent | null;
  buckets: LiquidationPriceBucket[];
  recent: LiquidationEvent[];
}

export interface LiquidationsValue {
  baseAsset: string;
  connected: boolean;
  streamStartedAt: number | null;
  lastMessageAt: number | null;
  windows: LiquidationWindow[];
}

interface BinanceForceOrderPayload {
  e?: string;
  E?: number;
  st?: number;
  o?: {
    s?: string;
    S?: string;
    q?: string;
    p?: string;
    ap?: string;
    z?: string;
    T?: number;
  };
}

export class LiquidationStreamService {
  readonly health: ProviderHealth;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private connected = false;
  private streamStartedAt: number | null = null;
  private continuousSince: number | null = null;
  private lastMessageAt: number | null = null;
  private events: LiquidationEvent[] = [];

  constructor(
    private readonly url = DEFAULT_URL,
    private readonly WebSocketImpl: typeof WebSocket = WebSocket
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('binance-liquidations', { onStateChange: logCircuitTransition })
    );
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.streamStartedAt === null) this.streamStartedAt = Date.now();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try { socket.close(); } catch {}
    }
  }

  snapshot(baseAsset: string): Availability<LiquidationsValue> {
    const asset = baseAsset.toUpperCase();
    if (!Object.values(TRACKED_SYMBOLS).includes(asset)) {
      return unavailable('unsupported_metric', `Liquidation stream is not tracked for ${asset}.`);
    }
    if (this.streamStartedAt === null) {
      return unavailable('provider_not_configured', 'Binance liquidation stream has not started.');
    }
    if (!this.connected && this.lastMessageAt === null) {
      return unavailable('provider_unavailable', 'Binance liquidation stream is not connected.');
    }

    const now = Date.now();
    this.prune(now);
    const windows = WINDOW_HOURS.map((hours) => this.window(asset, hours, now));
    const fetchedAt = this.lastMessageAt ?? this.continuousSince ?? this.streamStartedAt;
    return available({
      value: {
        baseAsset: asset,
        connected: this.connected,
        streamStartedAt: this.streamStartedAt,
        lastMessageAt: this.lastMessageAt,
        windows,
      },
      source: 'binance',
      fetchedAt,
      stale: !this.connected,
    });
  }

  /** Public for deterministic unit tests; production feeds it only from WS. */
  ingest(raw: unknown): LiquidationEvent | null {
    const event = normalizeLiquidation(raw);
    if (!event) return null;
    this.events.push(event);
    this.lastMessageAt = Math.max(this.lastMessageAt ?? 0, event.tradeTime);
    this.prune(Date.now());
    return event;
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      if (this.stopped) return;
      this.connected = true;
      this.continuousSince = Date.now();
      this.reconnectAttempt = 0;
      this.health.recordSuccess();
    });

    socket.on('message', (data) => {
      if (this.stopped) return;
      try {
        const raw = JSON.parse(data.toString());
        this.ingest(raw);
      } catch {
        // Malformed provider frames are ignored; no synthetic replacement.
      }
    });

    socket.on('error', () => {
      this.health.recordFailure({});
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.connected = false;
      this.continuousSince = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private window(asset: string, hours: number, now: number): LiquidationWindow {
    const from = now - hours * 60 * 60 * 1000;
    const rows = this.events.filter((event) => event.baseAsset === asset && event.tradeTime >= from && event.tradeTime <= now);
    let longNotionalUsd = 0;
    let shortNotionalUsd = 0;
    let largestEvent: LiquidationEvent | null = null;
    for (const event of rows) {
      if (event.side === 'LONG') longNotionalUsd += event.notionalUsd;
      else shortNotionalUsd += event.notionalUsd;
      if (!largestEvent || event.notionalUsd > largestEvent.notionalUsd) largestEvent = event;
    }
    return {
      hours,
      from,
      to: now,
      coverageStartAt: this.continuousSince,
      coverageComplete: this.continuousSince !== null && this.continuousSince <= from,
      eventCount: rows.length,
      longNotionalUsd,
      shortNotionalUsd,
      totalNotionalUsd: longNotionalUsd + shortNotionalUsd,
      largestEvent,
      buckets: buildObservedBuckets(rows),
      recent: rows.slice(-20).reverse(),
    };
  }

  private prune(now: number): void {
    const cutoff = now - RETENTION_MS;
    if (this.events.length > MAX_EVENTS || (this.events[0]?.tradeTime ?? now) < cutoff) {
      this.events = this.events.filter((event) => event.tradeTime >= cutoff).slice(-MAX_EVENTS);
    }
  }
}

export function normalizeLiquidation(raw: unknown): LiquidationEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as BinanceForceOrderPayload;
  if (payload.e !== 'forceOrder' || !payload.o) return null;
  if (payload.st !== undefined && payload.st !== 1) return null;
  const symbol = String(payload.o.s ?? '').toUpperCase();
  const baseAsset = TRACKED_SYMBOLS[symbol];
  if (!baseAsset) return null;
  const orderSide = String(payload.o.S ?? '').toUpperCase();
  if (orderSide !== 'BUY' && orderSide !== 'SELL') return null;
  const average = Number(payload.o.ap);
  const orderPrice = Number(payload.o.p);
  const price = Number.isFinite(average) && average > 0 ? average : orderPrice;
  const filled = Number(payload.o.z);
  const original = Number(payload.o.q);
  const quantity = Number.isFinite(filled) && filled > 0 ? filled : original;
  const tradeTime = Number(payload.o.T ?? payload.E);
  if (![price, quantity, tradeTime].every(Number.isFinite) || price <= 0 || quantity <= 0 || tradeTime <= 0) return null;
  const notionalUsd = price * quantity;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  return {
    id: `${symbol}-${tradeTime}-${orderSide}-${quantity}`,
    symbol,
    baseAsset,
    // A forced SELL closes a long; a forced BUY closes a short.
    side: orderSide === 'SELL' ? 'LONG' : 'SHORT',
    price,
    quantity,
    notionalUsd,
    tradeTime,
  };
}

export function buildObservedBuckets(events: LiquidationEvent[], maxBuckets = 24): LiquidationPriceBucket[] {
  if (events.length === 0) return [];
  const prices = events.map((event) => event.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return [summarizeBucket(events, min, max)];
  }
  const bucketCount = Math.max(1, Math.min(maxBuckets, Math.ceil(Math.sqrt(events.length)) * 2));
  const step = (max - min) / bucketCount;
  const grouped: LiquidationEvent[][] = Array.from({ length: bucketCount }, () => []);
  for (const event of events) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((event.price - min) / step)));
    grouped[index].push(event);
  }
  return grouped
    .map((rows, index) => rows.length ? summarizeBucket(rows, min + index * step, index === bucketCount - 1 ? max : min + (index + 1) * step) : null)
    .filter((bucket): bucket is LiquidationPriceBucket => bucket !== null);
}

function summarizeBucket(events: LiquidationEvent[], fromPrice: number, toPrice: number): LiquidationPriceBucket {
  let longNotionalUsd = 0;
  let shortNotionalUsd = 0;
  for (const event of events) {
    if (event.side === 'LONG') longNotionalUsd += event.notionalUsd;
    else shortNotionalUsd += event.notionalUsd;
  }
  return { fromPrice, toPrice, longNotionalUsd, shortNotionalUsd, eventCount: events.length };
}
