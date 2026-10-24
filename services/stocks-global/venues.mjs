// Venue data adapters for MarketHub: one adapter per exchange, public read-only market data,
// no credentials and no order endpoints. Each adapter maps the venue's own response shapes to
// the hub's native quote fields and to ascending [openTimeMs, open, high, low, close, volume]
// candle rows, the shape the existing Binance path already feeds into parseCandles/nativeOrder.
// Nothing is fabricated: a missing or malformed field is INVALID_DATA / INVALID_CANDLES, a failed
// request is the hub's SOURCE_HTTP_* / SOURCE_UNAVAILABLE, and no adapter answers for another.
// Rights: technical reachability is not permission. Every adapter is DATA_RIGHTS_UNVERIFIED and
// stays off until the operator enables it explicitly (see venuesFromEnv).
import { check } from './engine.mjs';
import { VENUE_CATALOG } from './catalog.mjs';
import { LIVE_REST_ADAPTERS } from './live-rest.mjs';

const str = v => { check(typeof v === 'string' && v.length > 0 && v !== 'null', 'INVALID_DATA'); return v; };
const ms = v => { const n = Number(v); check(Number.isSafeInteger(n) && n > 0, 'INVALID_DATA'); return n; };
const pct = v => { const n = Number(v); check(Number.isFinite(n), 'INVALID_DATA'); return n; };
const rows = (j, width, code = 'INVALID_CANDLES') => { check(Array.isArray(j) && j.every(r => Array.isArray(r) && r.length >= width), code); return j; };

const GATE = 'https://api.gateio.ws/api/v4';
const MEXC = 'https://api.mexc.com/api/v3';

export const VENUES = {
  ...LIVE_REST_ADAPTERS,
  // Gate spot (xStocks: AAPLX_USDT ...). Instrument: GET /spot/currency_pairs/{pair}; 404/400 for
  // an unknown pair. Ticker: GET /spot/tickers?currency_pair=. Book: GET /spot/order_book with
  // `id` (sequence) and `update` (ms). Candles: GET /spot/candlesticks, rows ascending as
  // [t seconds, quote volume, close, high, low, open, base amount, window closed] ("true"/"false").
  gate: {
    id: 'gate', name: 'Gate', hosts: ['api.gateio.ws'], rights: 'DATA_RIGHTS_UNVERIFIED', maxRows: 1000,
    intervals: { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1D':'1d' },
    instrumentUrl: i => `${GATE}/spot/currency_pairs/${i.sourceSymbol}`,
    parseInstrument(j, i, now) {
      check(j && typeof j === 'object' && !Array.isArray(j), 'INVALID_DATA');
      const exists = j.id === i.sourceSymbol;
      return { exists, online: exists && j.trade_status === 'tradable', venueStatus: exists ? String(j.trade_status) : null, multiplier: null, checkedAt: now,
        filters: exists ? { pricePrecision: j.precision, amountPrecision: j.amount_precision, minBase: j.min_base_amount, minQuote: j.min_quote_amount } : null };
    },
    tickerUrl: i => `${GATE}/spot/tickers?currency_pair=${i.sourceSymbol}`,
    parseTicker(j, i) {
      const t = Array.isArray(j) && j.length === 1 && j[0].currency_pair === i.sourceSymbol ? j[0] : null; check(t, 'INVALID_DATA');
      // The ticker carries no venue timestamp; the hub stamps receipt time on the display row only.
      return { last: str(t.last), change24h: pct(t.change_percentage), volume: str(t.base_volume), timestamp: null };
    },
    quoteUrls(i) { return [[`${GATE}/spot/order_book?currency_pair=${i.sourceSymbol}&limit=1&with_id=true`, 0], [this.tickerUrl(i), 15000]]; },
    parseQuote([book, ticker], i) {
      check(book && Array.isArray(book.bids) && Array.isArray(book.asks) && book.bids.length === 1 && book.asks.length === 1, 'INVALID_DATA');
      const t = this.parseTicker(ticker, i);
      return { bid: str(book.bids[0][0]), ask: str(book.asks[0][0]), last: t.last, timestamp: ms(book.update), eventId: String(ms(book.id)), change24h: t.change24h, volume: t.volume };
    },
    historyUrl(i, interval, limit, end) { return `${GATE}/spot/candlesticks?currency_pair=${i.sourceSymbol}&interval=${this.intervals[interval]}&limit=${limit}${end ? '&to=' + Math.floor(end / 1000) : ''}`; },
    parseHistory(j) { return rows(j, 7).map(r => [ms(r[0]) * 1000, r[5], r[3], r[4], r[2], r[6]]); },
  },
  // MEXC spot (xStocks: AAPLXUSDT ...). Instrument: one GET /exchangeInfo?symbols=a,b,c for all
  // configured MEXC pairs (status "1" online, "2" pause, "3" offline per MEXC docs; an unknown
  // symbol is simply absent from the list, not an error).
  // Ticker: GET /ticker/24hr?symbol= (priceChangePercent is a fraction). Book: GET /depth with
  // `lastUpdateId` and `timestamp` (ms). Candles: GET /klines, rows ascending as
  // [openTime ms, open, high, low, close, volume, closeTime, quote volume]; max 500 rows.
  mexc: {
    id: 'mexc', name: 'MEXC', hosts: ['api.mexc.com'], rights: 'DATA_RIGHTS_UNVERIFIED', maxRows: 500,
    intervals: { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'60m','4h':'4h','1D':'1d' },
    instrumentUrl: () => `${MEXC}/exchangeInfo?symbols=${VENUE_CATALOG.filter(i => i.provider === 'mexc').map(i => i.sourceSymbol).join(',')}`,
    parseInstrument(j, i, now) {
      check(j && Array.isArray(j.symbols), 'INVALID_DATA');
      const r = j.symbols.find(s => s.symbol === i.sourceSymbol);
      return { exists: !!r, online: !!r && r.status === '1' && r.isSpotTradingAllowed === true, venueStatus: r ? String(r.status) : null, multiplier: null, checkedAt: now,
        filters: r ? { pricePrecision: r.quotePrecision, amountPrecision: r.baseAssetPrecision, maxQuote: r.maxQuoteAmount } : null };
    },
    tickerUrl: i => `${MEXC}/ticker/24hr?symbol=${i.sourceSymbol}`,
    parseTicker(j, i) {
      check(j && j.symbol === i.sourceSymbol, 'INVALID_DATA');
      // priceChangePercent is a fraction ("-0.0039"); keep the venue's own digits when scaling to percent.
      return { last: str(j.lastPrice), change24h: Number((100 * pct(j.priceChangePercent)).toFixed(6)), volume: str(j.volume), timestamp: ms(j.closeTime) };
    },
    quoteUrls(i) { return [[`${MEXC}/depth?symbol=${i.sourceSymbol}&limit=1`, 0], [this.tickerUrl(i), 15000]]; },
    parseQuote([book, ticker], i) {
      check(book && Array.isArray(book.bids) && Array.isArray(book.asks) && book.bids.length === 1 && book.asks.length === 1, 'INVALID_DATA');
      const t = this.parseTicker(ticker, i);
      return { bid: str(book.bids[0][0]), ask: str(book.asks[0][0]), last: t.last, timestamp: ms(book.timestamp), eventId: String(ms(book.lastUpdateId)), change24h: t.change24h, volume: t.volume };
    },
    historyUrl(i, interval, limit, end) { return `${MEXC}/klines?symbol=${i.sourceSymbol}&interval=${this.intervals[interval]}&limit=${limit}${end ? '&endTime=' + end : ''}`; },
    parseHistory(j) { return rows(j, 6).map(r => [ms(r[0]), r[1], r[2], r[3], r[4], r[5]]); },
  },
};

// Operator opt-in. STOCKS_VENUES_ENABLED lists adapter ids; each must also appear in
// STOCKS_VENUE_RIGHTS_CONFIRMED, the operator's record that display rights for that venue were
// established. Unset means no venue: the hub then behaves exactly as before this module existed.
export function venuesFromEnv(env = process.env) {
  const list = s => String(s ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const enabled = list(env.STOCKS_VENUES_ENABLED), confirmed = new Set(list(env.STOCKS_VENUE_RIGHTS_CONFIRMED));
  // Legacy REST configuration remains unchanged. New WS-only providers require
  // STOCKS_LIVE_WS_VENUES, not silent activation through this older switch.
  check(enabled.every(v => ['gate','mexc'].includes(v)), 'VENUE_UNKNOWN');
  check(enabled.every(v => confirmed.has(v)), 'DATA_RIGHTS_UNVERIFIED');
  return enabled;
}
