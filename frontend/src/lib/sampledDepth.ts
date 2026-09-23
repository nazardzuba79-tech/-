import { DISPLAY_REFRESH_MS, readDisplayJson } from './displaySnapshotCache';
import type { FuturesDepthSnapshot, FuturesDepthLevel, FuturesTrade } from './futuresDepth';

let apiBase = '/api/v1';
const MARKET_EDGE_BASE = 'https://market.voltextech.net';
let futuresDisplayBase = apiBase;
/**
 * Trading/API fallback origin and public display origin are deliberately
 * separate. Public Futures display may live at Cloudflare while every
 * account/execution path stays on the API origin.
 */
export function setFuturesDepthFallbackBase(base: string, displayBase = base): void {
  apiBase = base.replace(/\/$/, '');
  futuresDisplayBase = displayBase.replace(/\/$/, '');
}
const goodNumber = (value: unknown) => typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
export function parseSampledBook(body: any, identity: string, futures: boolean): FuturesDepthSnapshot {
  if (!body || body.available !== true || (futures ? body.symbol !== identity : body.pair !== identity)) throw new Error('Wrong display book');
  const read = (rows: unknown): FuturesDepthLevel[] => {
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid depth shape');
    const seen = new Set<number>();
    return rows.map(row => {
      if (!row || !goodNumber(row.price) || !goodNumber(row.quantity) || Number(row.price) <= 0 || Number(row.quantity) < 0 || seen.has(Number(row.price))) throw new Error('Invalid depth observation');
      seen.add(Number(row.price));
      return { price: row.price as string, quantity: row.quantity as string };
    }).filter(row => Number(row.quantity) > 0);
  };
  const bids = read(body.bids).sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 200);
  const asks = read(body.asks).sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 200);
  if ((!bids.length && !asks.length) || (bids.length && asks.length && Number(bids[0].price) >= Number(asks[0].price))) throw new Error('Unusable depth observation');
  const asOf = body.providerTime ?? body.timestamp ?? body.fetchedAt;
  if (typeof asOf !== 'number' || !Number.isFinite(asOf) || asOf <= 0) throw new Error('Missing observation time');
  return { bids, asks, asOf, source: 'rest', status: body.stale === true ? 'stale' : 'sampled' };
}

export async function readSpotDisplayBook(base: string, pair: string, signal?: AbortSignal) {
  if (!/^[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}$/.test(pair)) throw new Error('Invalid spot pair');
  const host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
  const production = host === 'voltextech.net' || host.endsWith('.voltextech.net');
  const origin = production ? MARKET_EDGE_BASE : base.replace(/\/$/, '');
  const body = await readDisplayJson(`${origin}/market/display/spot-book/${pair.replace('/', '-')}`, DISPLAY_REFRESH_MS, signal);
  return { pair, ...parseSampledBook(body, pair, false) };
}
type Listener = (snapshot: FuturesDepthSnapshot) => void;
type Active = { listeners: Set<Listener>; tapes: Set<(trades: FuturesTrade[]) => void>; timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null; value: FuturesDepthSnapshot; lastSuccess: number | null; visibility: () => void };
const subscriptions = new Map<string, Active>();
const empty = (): FuturesDepthSnapshot => ({ bids: [], asks: [], asOf: null, source: null, status: 'connecting' });

/** One request/minute per watched contract, coalesced across consumers. No synthetic book updates. */
export function subscribeFuturesDepth(pair: string, listener: Listener, onTrades?: (trades: FuturesTrade[]) => void): () => void {
  if (!/^[A-Z0-9]{1,28}\/USDT$/.test(pair)) { listener({ ...empty(), status: 'unavailable' }); return () => {}; }
  const symbol = pair.replace('/', ''), key = `${futuresDisplayBase}:${symbol}`, base = futuresDisplayBase;
  let active = subscriptions.get(key);
  if (!active) {
    const state: Active = { listeners: new Set(), tapes: new Set(), timer: null, controller: null, value: empty(), lastSuccess: null, visibility: () => {} };
    const emit = () => { for (const cb of state.listeners) cb({ ...state.value, bids: state.value.bids.map(x => ({ ...x })), asks: state.value.asks.map(x => ({ ...x })) }); };
    const schedule = (delay: number) => {
      if (state.timer) clearTimeout(state.timer); state.timer = null;
      if (subscriptions.get(key) !== state || !state.listeners.size || (typeof document !== 'undefined' && document.hidden)) return;
      state.timer = setTimeout(() => { state.timer = null; void load(); }, delay);
    };
    const load = async () => {
      if (state.controller || subscriptions.get(key) !== state || !state.listeners.size || (typeof document !== 'undefined' && document.hidden)) return;
      const controller = new AbortController(); state.controller = controller;
      const book = readDisplayJson(`${base}/market/display/futures-book/${symbol}`, DISPLAY_REFRESH_MS, controller.signal)
        .then(body => {
          if (controller.signal.aborted || subscriptions.get(key) !== state) return;
          state.value = parseSampledBook(body, symbol, true); state.lastSuccess = Date.now(); emit();
        }).catch(() => {
          if (controller.signal.aborted || subscriptions.get(key) !== state) return;
          const retain = state.lastSuccess !== null && Date.now() - state.lastSuccess < 300_000;
          state.value = retain ? { ...state.value, status: 'stale' } : { ...empty(), status: 'unavailable' }; emit();
        });
      // Retain the real tape feature. These are sampled public trades, never animation-generated trades.
      const tape = state.tapes.size ? readDisplayJson(`${base}/market/display/futures-trades/${symbol}`, DISPLAY_REFRESH_MS, controller.signal)
        .then(body => {
          if (controller.signal.aborted || subscriptions.get(key) !== state || body.symbol !== symbol || !Array.isArray(body.trades) || body.trades.length > 30) return;
          const trades: FuturesTrade[] = body.trades.filter((row: any) => typeof row.id === 'string' && row.id && goodNumber(row.price) && Number(row.price) > 0 &&
            goodNumber(row.quantity) && Number(row.quantity) > 0 && Number.isSafeInteger(row.time) && row.time > 0 && ['BUY', 'SELL'].includes(row.side));
          for (const cb of state.tapes) cb(trades.map(row => ({ ...row })));
        }).catch(() => {}) : Promise.resolve();
      await Promise.all([book, tape]);
      if (state.controller === controller) state.controller = null;
      schedule(controller.signal.aborted && !(typeof document !== 'undefined' && document.hidden) ? 0 : DISPLAY_REFRESH_MS);
    };
    state.visibility = () => {
      if (document.hidden) { if (state.timer) clearTimeout(state.timer); state.timer = null; state.controller?.abort(); }
      else schedule(0); // readDisplayJson enforces the remaining snapshot TTL across tab changes.
    };
    active = state; subscriptions.set(key, state);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', state.visibility);
    // Microtask lets the first listeners attach before the initial public read.
    void Promise.resolve().then(load);
  }
  const state = active;
  state.listeners.add(listener); if (onTrades) state.tapes.add(onTrades); listener(state.value);
  let stopped = false;
  return () => {
    if (stopped) return; stopped = true;
    state.listeners.delete(listener); if (onTrades) state.tapes.delete(onTrades);
    if (state.listeners.size) return;
    subscriptions.delete(key); if (state.timer) clearTimeout(state.timer); state.controller?.abort();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', state.visibility);
  };
}
export type { FuturesTrade, FuturesDepthStatus } from './futuresDepth';

export function closeSampledDepth(): void {
  for (const state of subscriptions.values()) {
    if (state.timer) clearTimeout(state.timer);
    state.controller?.abort();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', state.visibility);
  }
  subscriptions.clear();
}
