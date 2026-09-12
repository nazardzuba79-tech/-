import type { BookSnapshot, LiveTrade, SocketStatus } from '../../lib/krakenSocket';
import type { HomeCandle, HomeHeroFeed } from './useHomeMarket';

export interface HeroStreamSnapshot {
  pair: string;
  book: BookSnapshot | null;
  bookReceivedAt: number | null;
  trades: LiveTrade[];
  receivedAt: number;
}
interface Stream {
  subscribeBook(pair: string, listener: (book: BookSnapshot) => void): () => void;
  subscribeTrades(pair: string, listener: (trade: LiveTrade) => void): () => void;
  subscribeStatus(listener: (status: SocketStatus) => void): () => void;
}
const positive = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
const epoch = (time: number) => time < 1e12 ? time * 1000 : time;

/** Coalesce real messages, never manufacture ticks. Disconnection/silence
 * discards the live overlay so the independent REST fallback stays authoritative. */
export function startHeroStream(stream: Stream, pair: string, publish: (value: HeroStreamSnapshot | null) => void,
  clock = { now: Date.now, set: (fn: () => void, ms: number) => window.setTimeout(fn, ms), clear: (id: number) => window.clearTimeout(id) }) {
  let stopped = false;
  let book: BookSnapshot | null = null;
  let bookReceivedAt: number | null = null;
  let trades: LiveTrade[] = [];
  let pending: number | undefined;
  let expiry: number | undefined;
  const clear = () => {
    if (pending !== undefined) clock.clear(pending);
    if (expiry !== undefined) clock.clear(expiry);
    pending = expiry = undefined;
    book = null; bookReceivedAt = null; trades = [];
    if (!stopped) publish(null);
  };
  const changed = () => {
    if (stopped) return;
    if (expiry !== undefined) clock.clear(expiry);
    expiry = clock.set(clear, 15_000);
    if (pending !== undefined) return;
    pending = clock.set(() => {
      pending = undefined;
      if (!stopped) publish({ pair, book, bookReceivedAt, trades: [...trades], receivedAt: clock.now() });
    }, 1_000);
  };
  const subscriptions = [
    stream.subscribeStatus(status => { if (!stopped && status !== 'connected') clear(); }),
    stream.subscribeBook(pair, incoming => {
      if (stopped) return;
      const valid = (rows: BookSnapshot['bids']) => rows.filter(row => positive(row.price) && positive(row.quantity));
      const bids = valid(incoming.bids).sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 6);
      const asks = valid(incoming.asks).sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 6);
      if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) return;
      book = { bids, asks }; bookReceivedAt = clock.now(); changed();
    }),
    stream.subscribeTrades(pair, trade => {
      if (stopped || !trade.id || !positive(trade.price) || !positive(trade.quantity)
        || !Number.isFinite(trade.time) || trade.time <= 0 || epoch(trade.time) > clock.now() + 5_000
        || (trade.side !== 'BUY' && trade.side !== 'SELL') || trades.some(row => row.id === trade.id)) return;
      // Old subscription snapshots are history, not new executions.
      if (clock.now() - epoch(trade.time) > 60_000) return;
      trades = [trade, ...trades].sort((a, b) => epoch(b.time) - epoch(a.time)).slice(0, 24);
      changed();
    }),
  ];
  return () => { stopped = true; clear(); subscriptions.forEach(unsubscribe => unsubscribe()); };
}

/** Only extend an existing provider candle in the SAME interval. Never invent
 * a new interval's open or volume from an incomplete client trade sample. */
export function extendHeroCandle(candles: HomeCandle[], trades: LiveTrade[]): HomeCandle[] {
  if (!candles.length || !trades.length) return candles;
  const last = candles[candles.length - 1];
  const start = epoch(last.time);
  const matching = trades.filter(trade => epoch(trade.time) >= start && epoch(trade.time) < start + 900_000)
    .sort((a, b) => epoch(a.time) - epoch(b.time));
  if (!matching.length) return candles;
  const prices = matching.map(trade => Number(trade.price));
  return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, ...prices),
    low: Math.min(last.low, ...prices), close: prices[prices.length - 1] }];
}

export function combineHeroFeed(base: HomeHeroFeed, live: HeroStreamSnapshot | null): HomeHeroFeed {
  if (!live || live.pair !== base.pair) return base;
  const liveBook = live.bookReceivedAt !== null && live.receivedAt - live.bookReceivedAt <= 15_000 ? live.book : null;
  const recent = live.trades.filter(trade => live.receivedAt - epoch(trade.time) <= 60_000);
  // A returned REST candle may already include later trades than our buffered
  // messages. Only post-snapshot receipts extend its OHLC.
  const afterSnapshot = recent.filter(trade => epoch(trade.time) > (base.candlesUpdatedAt ?? base.updatedAt ?? 0));
  const trades = [...recent, ...base.trades].sort((a, b) => epoch(b.time) - epoch(a.time))
    .filter((trade, index, all) => all.findIndex(row => epoch(row.time) === epoch(trade.time)
      && Number(row.price) === Number(trade.price) && Number(row.quantity) === Number(trade.quantity) && row.side === trade.side) === index).slice(0, 6);
  const last = afterSnapshot[0];
  return { ...base, book: liveBook ? { ...liveBook, pair: live.pair, timestamp: live.bookReceivedAt! } : base.book,
    candles: extendHeroCandle(base.candles, afterSnapshot), trades,
    bookStatus: liveBook ? 'ok' : base.bookStatus, tradesStatus: recent.length ? 'ok' : base.tradesStatus,
    stale: base.candlesStatus !== 'ok' || (!liveBook && base.bookStatus !== 'ok') || (!recent.length && base.tradesStatus !== 'ok'),
    streaming: !!liveBook, livePrice: last ? Number(last.price) : undefined };
}
