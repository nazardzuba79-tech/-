// Read-only discovery of tokenised-stock markets on nine venues. Pure parsers over each venue's
// own public metadata/ticker/candle responses, plus a bounded runner (one metadata read per venue,
// one ticker and one candle read per watch-list match). Unauthenticated GETs only; no order,
// account or websocket endpoint. Every row keeps the venue's raw status and the HTTP code and UTC
// time of the read. Nothing is inferred across venues: a symbol absent from a venue is UNAVAILABLE,
// a venue that could not be read is NOT_VERIFIED with its HTTP code, and no price is ever derived.
//
// sourceType vocabulary (from the review brief): 'spot-token' (a tradeable token on the venue's
// spot book), 'unified-share-equivalent' (the venue's own share-equivalent product under its
// unified account, not an open spot book), 'equity-linked-derivative', 'moex-equity', 'unavailable'.
import { VENUES } from './venues.mjs';

export const WATCH_LIST = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'SPY', 'QQQ'];
const UA = 'voltex-stocks-feed-check/0.1';
const num = v => (v === undefined || v === null || v === '' ? null : Number(v));
const spread = (bid, ask) => (bid && ask && Number(bid) > 0 && Number(ask) >= Number(bid) ? Number(((Number(ask) - Number(bid)) / Number(ask) * 100).toFixed(4)) : null);
// A venue's own status word mapped to the brief's vocabulary. Unknown words stay UNKNOWN.
const status = (map, raw) => (raw === undefined || raw === null ? 'UNKNOWN' : map[String(raw)] ?? 'UNKNOWN');

// Common: ticker/candle readers return the venue's values as strings; nothing is rounded.
export const VENUE_DISCOVERY = {
  bybit: {
    name: 'Bybit', host: 'api.bybit.com', issuer: 'xstocks', issuerEvidence: 'xstockMultiplier field, X suffix',
    metadataUrl: 'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000',
    timeframes: ['1m','5m','15m','30m','1h','4h','1D'], rights: 'DATA_RIGHTS_UNVERIFIED',
    geo: 'HTTP 403 (CloudFront country block) from the review container on 2026-10-20; api.bytick.com identical',
    match: (j, t) => j?.result?.list?.find(r => r.symbol === `${t}XUSDT`) ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.symbol, base: r.baseCoin, quote: r.quoteCoin, venueStatus: r.status, status: status({ Trading: 'TRADING', PreLaunch: 'SUSPENDED', Delivering: 'SUSPENDED', Closed: 'DELISTED' }, r.status), tickSize: r.priceFilter?.tickSize ?? null, lotSize: r.lotSizeFilter?.basePrecision ?? null, minNotional: r.lotSizeFilter?.minOrderAmt ?? null, multiplier: r.xstockMultiplier ?? null }),
    tickerUrl: s => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}`,
    ticker: (j, s) => { const t = j?.result?.list?.find(t => t.symbol === s); return t ? { last: t.lastPrice, bid: t.bid1Price, ask: t.ask1Price, volume: t.volume24h, quoteVolume: t.turnover24h, ts: num(j.time) } : null; },
    candleUrl: s => `https://api.bybit.com/v5/market/kline?category=spot&symbol=${s}&interval=15&limit=3`,
    candles: j => Array.isArray(j?.result?.list) ? j.result.list.map(r => [num(r[0]), r[1], r[2], r[3], r[4], r[5]]).reverse() : null, candleOrder: 'desc',
  },
  binance: {
    name: 'Binance', host: 'data-api.binance.vision', issuer: 'bstocks', issuerEvidence: 'B suffix (bStocks); issuer name not in the API',
    metadataUrl: 'https://data-api.binance.vision/api/v3/exchangeInfo',
    timeframes: ['1m','5m','15m','30m','1h','4h','1d'], rights: 'DATA_RIGHTS_UNVERIFIED',
    geo: 'api.binance.com answered HTTP 451 from the review container; data-api.binance.vision (documented public-market-data host) answered 200',
    match: (j, t) => j?.symbols?.find(r => r.symbol === `${t}BUSDT`) ?? null,
    row: r => { const f = Object.fromEntries((r.filters ?? []).map(x => [x.filterType, x])); return { sourceType: 'spot-token', venueSymbol: r.symbol, base: r.baseAsset, quote: r.quoteAsset, venueStatus: r.status, status: status({ TRADING: 'TRADING', HALT: 'SUSPENDED', BREAK: 'SUSPENDED', PRE_TRADING: 'SUSPENDED', POST_TRADING: 'SUSPENDED', END_OF_DAY: 'SUSPENDED' }, r.status), tickSize: f.PRICE_FILTER?.tickSize ?? null, lotSize: f.LOT_SIZE?.stepSize ?? null, minNotional: f.NOTIONAL?.minNotional ?? null, multiplier: null }; },
    tickerUrl: s => `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${s}`,
    ticker: (j, s) => (j?.symbol === s ? { last: j.lastPrice, bid: j.bidPrice, ask: j.askPrice, volume: j.volume, quoteVolume: j.quoteVolume, ts: num(j.closeTime) } : null),
    candleUrl: s => `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=15m&limit=3`,
    candles: j => Array.isArray(j) ? j.map(r => [num(r[0]), r[1], r[2], r[3], r[4], r[5]]) : null, candleOrder: 'asc',
  },
  bitget: {
    name: 'Bitget', host: 'api.bitget.com', issuer: 'bitget-rtoken', issuerEvidence: 'r prefix; Bitget "Reality" rToken (UTA product)',
    metadataUrl: 'https://api.bitget.com/api/v2/spot/public/symbols',
    timeframes: ['1min','5min','15min','1h','4h','1day'], rights: 'DATA_RIGHTS_UNVERIFIED',
    geo: 'v2 orderbook answered code 40502 "Please upgrade to access the V3 API" for RAAPLUSDT; last public fill 2026-10-12 while candles show volume: not an open spot book',
    match: (j, t) => j?.data?.find(r => r.symbol === `R${t}USDT`) ?? null,
    row: r => ({ sourceType: 'unified-share-equivalent', venueSymbol: r.symbol, base: r.baseCoin, quote: r.quoteCoin, venueStatus: r.status, status: status({ online: 'TRADING', gray: 'SUSPENDED', halt: 'SUSPENDED', offline: 'DELISTED' }, r.status), tickSize: r.pricePrecision != null ? `1e-${r.pricePrecision}` : null, lotSize: r.quantityPrecision != null ? `1e-${r.quantityPrecision}` : null, minNotional: r.minTradeUSDT ?? null, multiplier: null }),
    tickerUrl: s => `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${s}`,
    ticker: (j, s) => { const t = j?.data?.find(t => t.symbol === s); return t ? { last: t.lastPr, bid: t.bidPr, ask: t.askPr, volume: t.baseVolume, quoteVolume: t.quoteVolume, ts: num(t.ts) } : null; },
    candleUrl: s => `https://api.bitget.com/api/v2/spot/market/candles?symbol=${s}&granularity=15min&limit=3`,
    candles: j => Array.isArray(j?.data) ? j.data.map(r => [num(r[0]), r[1], r[2], r[3], r[4], r[5]]) : null, candleOrder: 'asc',
  },
  bingx: {
    name: 'BingX', host: 'open-api.bingx.com', issuer: 'per-symbol (X: xstocks family, B: bstocks family)', issuerEvidence: 'suffix only; issuer not in the API',
    metadataUrl: 'https://open-api.bingx.com/openApi/spot/v1/common/symbols',
    timeframes: ['1m','5m','15m','30m','1h','4h','1d'], rights: 'DATA_RIGHTS_UNVERIFIED',
    geo: 'ticker and kline values are JSON numbers, not strings (precision caveat); depth asks are listed best-last',
    match: (j, t) => j?.data?.symbols?.find(r => r.symbol === `${t}X-USDT`) ?? j?.data?.symbols?.find(r => r.symbol === `${t}B-USDT`) ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.symbol, base: r.symbol.split('-')[0], quote: r.symbol.split('-')[1], venueStatus: r.status, status: status({ 1: 'TRADING', 0: 'DELISTED', 5: 'SUSPENDED', 25: 'SUSPENDED' }, r.status), tickSize: r.tickSize != null ? String(r.tickSize) : null, lotSize: r.stepSize != null ? String(r.stepSize) : null, minNotional: r.minNotional != null ? String(r.minNotional) : null, multiplier: null }),
    tickerUrl: s => `https://open-api.bingx.com/openApi/spot/v1/ticker/24hr?symbol=${s}`,
    ticker: (j, s) => { const t = j?.data?.find(t => t.symbol === s); return t ? { last: String(t.lastPrice), bid: String(t.bidPrice), ask: String(t.askPrice), volume: String(t.volume), quoteVolume: String(t.quoteVolume), ts: num(t.closeTime) } : null; },
    candleUrl: s => `https://open-api.bingx.com/openApi/spot/v2/market/kline?symbol=${s}&interval=15m&limit=3`,
    candles: j => Array.isArray(j?.data) ? j.data.map(r => [num(r[0]), String(r[1]), String(r[2]), String(r[3]), String(r[4]), String(r[5])]).reverse() : null, candleOrder: 'desc',
  },
  gate: {
    name: 'Gate', host: 'api.gateio.ws', issuer: 'xstocks', issuerEvidence: 'base_name "<Company> xStock"',
    metadataUrl: 'https://api.gateio.ws/api/v4/spot/currency_pairs',
    timeframes: ['1m','5m','15m','30m','1h','4h','1d'], rights: 'DATA_RIGHTS_UNVERIFIED', geo: null,
    match: (j, t) => (Array.isArray(j) ? j.find(r => r.id === `${t}X_USDT`) : null) ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.id, base: r.base, quote: r.quote, venueStatus: r.trade_status, status: status({ tradable: 'TRADING', untradable: 'SUSPENDED', buyable: 'SUSPENDED', sellable: 'SUSPENDED' }, r.trade_status), tickSize: r.precision != null ? `1e-${r.precision}` : null, lotSize: r.amount_precision != null ? `1e-${r.amount_precision}` : null, minNotional: r.min_quote_amount ?? null, multiplier: null, baseName: r.base_name ?? null }),
    tickerUrl: s => `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${s}`,
    ticker: (j, s) => { const t = Array.isArray(j) ? j.find(t => t.currency_pair === s) : null; return t ? { last: t.last, bid: t.highest_bid, ask: t.lowest_ask, volume: t.base_volume, quoteVolume: t.quote_volume, ts: null } : null; },
    candleUrl: s => `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${s}&interval=15m&limit=3`,
    candles: j => Array.isArray(j) ? j.map(r => [num(r[0]) * 1000, r[5], r[3], r[4], r[2], r[6]]) : null, candleOrder: 'asc',
  },
  mexc: {
    name: 'MEXC', host: 'api.mexc.com', issuer: 'xstocks', issuerEvidence: 'fullName "<Company> xStock", Solana contractAddress',
    metadataUrl: 'https://api.mexc.com/api/v3/exchangeInfo',
    timeframes: ['1m','5m','15m','30m','60m','4h','1d'], rights: 'DATA_RIGHTS_UNVERIFIED', geo: 'trades carry id:null; ticker priceChangePercent is a fraction',
    match: (j, t) => j?.symbols?.find(r => r.symbol === `${t}XUSDT`) ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.symbol, base: r.baseAsset, quote: r.quoteAsset, venueStatus: r.status, status: status({ 1: 'TRADING', 2: 'SUSPENDED', 3: 'DELISTED' }, r.status), tickSize: r.quotePrecision != null ? `1e-${r.quotePrecision}` : null, lotSize: r.baseAssetPrecision != null ? `1e-${r.baseAssetPrecision}` : null, minNotional: r.quoteAmountPrecision ?? null, multiplier: null, baseName: r.fullName ?? null, contractAddress: r.contractAddress ?? null }),
    tickerUrl: s => `https://api.mexc.com/api/v3/ticker/24hr?symbol=${s}`,
    ticker: (j, s) => (j?.symbol === s ? { last: j.lastPrice, bid: j.bidPrice, ask: j.askPrice, volume: j.volume, quoteVolume: j.quoteVolume, ts: num(j.closeTime) } : null),
    candleUrl: s => `https://api.mexc.com/api/v3/klines?symbol=${s}&interval=15m&limit=3`,
    candles: j => Array.isArray(j) ? j.map(r => [num(r[0]), r[1], r[2], r[3], r[4], r[5]]) : null, candleOrder: 'asc',
  },
  kucoin: {
    name: 'KuCoin', host: 'api.kucoin.com', issuer: 'xstocks (symbol family)', issuerEvidence: 'market "Stocks", X suffix; issuer not in the API',
    metadataUrl: 'https://api.kucoin.com/api/v2/symbols',
    timeframes: ['1min','5min','15min','30min','1hour','4hour','1day'], rights: 'DATA_RIGHTS_UNVERIFIED', geo: 'only AAPLX and TSLAX of the watch list are listed; candles are [time, open, close, high, low, volume, turnover] newest first',
    match: (j, t) => j?.data?.find(r => r.symbol === `${t}X-USDT`) ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.symbol, base: r.baseCurrency, quote: r.quoteCurrency, venueStatus: `enableTrading=${r.enableTrading},st=${r.st}`, status: r.enableTrading === true ? 'TRADING' : r.enableTrading === false ? 'SUSPENDED' : 'UNKNOWN', tickSize: r.priceIncrement ?? null, lotSize: r.baseIncrement ?? null, minNotional: r.minFunds ?? null, multiplier: null, market: r.market ?? null }),
    tickerUrl: s => `https://api.kucoin.com/api/v1/market/stats?symbol=${s}`,
    ticker: (j, s) => (j?.data?.symbol === s ? { last: j.data.last, bid: j.data.buy, ask: j.data.sell, volume: j.data.vol, quoteVolume: j.data.volValue, ts: num(j.data.time) } : null),
    candleUrl: s => `https://api.kucoin.com/api/v1/market/candles?symbol=${s}&type=15min`,
    candles: j => Array.isArray(j?.data) ? j.data.slice(0, 3).map(r => [num(r[0]) * 1000, r[1], r[3], r[4], r[2], r[5]]).reverse() : null, candleOrder: 'desc',
  },
  okx: {
    name: 'OKX', host: 'www.okx.com', issuer: 'NOT_VERIFIED', issuerEvidence: 'instCategory "3" (Stocks), X prefix; issuer not in the public API',
    metadataUrl: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
    timeframes: ['1m','5m','15m','30m','1H','4H','1D'], rights: 'DATA_RIGHTS_UNVERIFIED', geo: 'OKX API Agreement §9.4 (US text) bars display/redistribution of public Market Data',
    match: (j, t) => j?.data?.find(r => r.instId === `X${t}-USDT` && r.instType === 'SPOT') ?? null,
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.instId, base: r.baseCcy, quote: r.quoteCcy, venueStatus: r.state, status: status({ live: 'TRADING', suspend: 'SUSPENDED', preopen: 'SUSPENDED', test: 'SUSPENDED' }, r.state), tickSize: r.tickSz ?? null, lotSize: r.lotSz ?? null, minNotional: r.minSz ?? null, multiplier: null, instCategory: r.instCategory ?? null, openType: r.openType ?? null }),
    tickerUrl: s => `https://www.okx.com/api/v5/market/ticker?instId=${s}`,
    ticker: (j, s) => { const t = j?.data?.find(t => t.instId === s); return t ? { last: t.last, bid: t.bidPx, ask: t.askPx, volume: t.vol24h, quoteVolume: t.volCcy24h, ts: num(t.ts) } : null; },
    candleUrl: s => `https://www.okx.com/api/v5/market/candles?instId=${s}&bar=15m&limit=3`,
    candles: j => Array.isArray(j?.data) ? j.data.map(r => [num(r[0]), r[1], r[2], r[3], r[4], r[5]]).reverse() : null, candleOrder: 'desc',
  },
  kraken: {
    name: 'Kraken', host: 'api.kraken.com', issuer: 'xstocks', issuerEvidence: 'aclass_base "tokenized_asset", base "<TICKER>x"',
    metadataUrl: 'https://api.kraken.com/0/public/AssetPairs?aclass_base=tokenized_asset',
    timeframes: ['1','5','15','30','60','240','1440'], rights: 'DATA_RIGHTS_UNVERIFIED', geo: 'quote is USD (ZUSD), not USDT; ticker/depth/trades/OHLC need asset_class=tokenized_asset; xStocks not for US/UK/CA/AU clients and not via API for EEA (support article, 2026-06-18)',
    match: (j, t) => { const e = Object.entries(j?.result ?? {}).find(([k, v]) => v.base === `${t}x` && v.quote === 'ZUSD' && k === v.altname); return e ? { key: e[0], ...e[1] } : null; },
    row: r => ({ sourceType: 'spot-token', venueSymbol: r.altname, base: r.base, quote: r.quote, venueStatus: r.status, status: status({ online: 'TRADING', cancel_only: 'SUSPENDED', post_only: 'SUSPENDED', limit_only: 'SUSPENDED', reduce_only: 'SUSPENDED' }, r.status), tickSize: r.tick_size ?? null, lotSize: r.lot_decimals != null ? `1e-${r.lot_decimals}` : null, minNotional: r.costmin ?? null, multiplier: null }),
    tickerUrl: s => `https://api.kraken.com/0/public/Ticker?pair=${s}&asset_class=tokenized_asset`,
    ticker: (j, s) => { const t = j?.result?.[s]; return t ? { last: t.c?.[0], bid: t.b?.[0], ask: t.a?.[0], volume: t.v?.[1], quoteVolume: null, ts: null } : null; },
    candleUrl: s => `https://api.kraken.com/0/public/OHLC?pair=${s}&interval=15&asset_class=tokenized_asset`,
    candles: j => { const k = Object.keys(j?.result ?? {}).find(k => k !== 'last'); return k ? j.result[k].slice(-3).map(r => [num(r[0]) * 1000, r[1], r[2], r[3], r[4], r[6]]) : null; }, candleOrder: 'asc',
  },
};

// Classify one venue's metadata for the watch list. `read` is {status, body, at} for the metadata
// request. A venue that did not answer 200 yields NOT_VERIFIED rows carrying that HTTP code.
export function classify(venue, read, tickers = WATCH_LIST) {
  const v = VENUE_DISCOVERY[venue];
  return tickers.map(ticker => {
    const base = { venue, venueName: v.name, ticker, issuer: v.issuer, issuerEvidence: v.issuerEvidence, timeframes: v.timeframes, rights: v.rights, geo: v.geo, http: read.status, checkedAt: read.at, adapter: ['bybit', 'binance'].includes(venue) ? 'MarketHub (built-in)' : VENUES[venue] ? 'MarketHub adapter' : 'discovery only' };
    if (read.status !== 200 || read.body === null || read.body === undefined) return { ...base, sourceType: 'unavailable', status: 'NOT_VERIFIED', venueSymbol: null, base: null, quote: null, venueStatus: null, tickSize: null, lotSize: null, minNotional: null, multiplier: null };
    const r = v.match(read.body, ticker);
    if (!r) return { ...base, sourceType: 'unavailable', status: 'UNAVAILABLE', venueSymbol: null, base: null, quote: null, venueStatus: null, tickSize: null, lotSize: null, minNotional: null, multiplier: null };
    return { ...base, ...v.row(r) };
  });
}

export function withTicker(row, read) {
  if (!row.venueSymbol) return row;
  const v = VENUE_DISCOVERY[row.venue];
  const t = read.status === 200 ? v.ticker(read.body, row.venueSymbol) : null;
  return { ...row, tickerHttp: read.status, tickerAt: read.at, ticker24h: t, spreadPct: t ? spread(t.bid, t.ask) : null };
}

export function withCandles(row, read) {
  if (!row.venueSymbol) return row;
  const v = VENUE_DISCOVERY[row.venue];
  const rows = read.status === 200 ? v.candles(read.body) : null;
  const ok = Array.isArray(rows) && rows.length > 0 && rows.every((r, n) => Number.isSafeInteger(r[0]) && (!n || rows[n - 1][0] < r[0]));
  return { ...row, candleHttp: read.status, candleAt: read.at, candleOrder: v.candleOrder, candlesOk: ok, lastCandle: ok ? rows.at(-1) : null };
}

// Bounded runner: at most 1 + 2 × matches requests per venue, sequential per venue, hosts in
// parallel, 300 ms apart, 20 s timeout, no redirects, 32 MiB cap. Raw bodies are returned to the
// caller for evidence; nothing is cached or retried.
export async function discover({ fetchImpl = fetch, venues = Object.keys(VENUE_DISCOVERY), tickers = WATCH_LIST, now = () => Date.now(), delayMs = 300 } = {}) {
  const read = async url => {
    const at = new Date(now()).toISOString();
    try {
      const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      const text = await res.text(); let body = null; try { body = text.length <= 32 * 1048576 ? JSON.parse(text) : null; } catch { body = null; }
      return { url, status: res.status, at, bytes: text.length, body, text };
    } catch (e) { return { url, status: 0, at, bytes: 0, body: null, text: '', error: e.message }; }
  };
  const sleep = () => new Promise(r => setTimeout(r, delayMs));
  const raw = [], rows = [];
  await Promise.all(venues.map(async venue => {
    const v = VENUE_DISCOVERY[venue];
    const meta = await read(v.metadataUrl); raw.push({ venue, kind: 'metadata', ...meta, body: undefined });
    for (let row of classify(venue, meta, tickers)) {
      if (row.venueSymbol) {
        await sleep(); const t = await read(v.tickerUrl(row.venueSymbol)); raw.push({ venue, kind: 'ticker', ...t, body: undefined }); row = withTicker(row, t);
        await sleep(); const c = await read(v.candleUrl(row.venueSymbol)); raw.push({ venue, kind: 'candles', ...c, body: undefined }); row = withCandles(row, c);
      }
      rows.push(row);
    }
  }));
  return { checkedAt: new Date(now()).toISOString(), tickers, rows, requests: raw };
}

export function renderTable(rows) {
  const cell = v => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|'));
  const head = '| Venue | Ticker | Source type | Issuer | Venue symbol | Base/Quote | Status (venue) | HTTP | Checked (UTC) | Tick/Lot/MinNotional | Timeframes | Last | Bid/Ask | Spread % | 24h base vol | 24h quote vol | Candles | Multiplier | Rights | Notes |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  return head + rows.map(r => `| ${cell(r.venueName)} | ${cell(r.ticker)} | ${cell(r.sourceType)} | ${cell(r.issuer)} | ${cell(r.venueSymbol)} | ${r.base ? `${r.base}/${r.quote}` : '—'} | ${cell(r.status)}${r.venueStatus != null ? ` (${cell(r.venueStatus)})` : ''} | ${cell(r.http)} | ${cell(r.checkedAt)} | ${r.venueSymbol ? `${cell(r.tickSize)} / ${cell(r.lotSize)} / ${cell(r.minNotional)}` : '—'} | ${r.venueSymbol ? r.timeframes.join(' ') : '—'} | ${cell(r.ticker24h?.last)} | ${r.ticker24h ? `${cell(r.ticker24h.bid)} / ${cell(r.ticker24h.ask)}` : '—'} | ${cell(r.spreadPct)} | ${cell(r.ticker24h?.volume)} | ${cell(r.ticker24h?.quoteVolume)} | ${r.candleHttp != null ? `${r.candlesOk ? 'ok' : 'FAIL'} (${r.candleOrder}, HTTP ${r.candleHttp})` : '—'} | ${cell(r.multiplier)} | ${cell(r.rights)} | ${cell(r.geo)} |`).join('\n') + '\n';
}
