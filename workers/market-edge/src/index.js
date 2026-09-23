// VOLTEX market edge — PUBLIC market data only.
// NO trading commands, NO cookies, NO Authorization forwarding, NO balances/orders/positions, NO Neon.
//
// Phase 1 deliberately moves the heaviest public display path first:
// Futures order book + public trade tape. Trading/execution keeps using Render.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const EDGE_TTL_SECONDS = 15;
const BOOK_LEVELS = 25;
const SYMBOL_RE = /^[A-Z0-9]{1,28}USDT$/;
const RENDER_API_BASE = "https://api.voltextech.net/api/v1";
const APP_INTERVAL_BY_PROVIDER = { "5":"5m", "15":"15m", "60":"1h", "240":"4h", "D":"1d", "W":"1w" };
const SPOT_INTERVAL_MINUTES = { "1m":"1", "5m":"5", "15m":"15", "1h":"60", "4h":"240", "1d":"1440", "1w":"10080" };
const KRAKEN_ASSET = { BTC: "XBT", DOGE: "XDG" };
const SPOT_SLUG_RE = /^[A-Z0-9]{1,32}-[A-Z0-9]{2,12}$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": status === 200
        ? `public, max-age=${EDGE_TTL_SECONDS}, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=30`
        : "no-store",
      ...extra,
    },
  });
}

function validPositiveDecimal(value) {
  return typeof value === "string"
    && value.length <= 64
    && /^\d+(?:\.\d+)?$/.test(value)
    && Number.isFinite(Number(value))
    && Number(value) > 0;
}

function normalizeRenderBookRows(rows) {
  if (!Array.isArray(rows)) throw new Error("render_book_shape");
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || !validPositiveDecimal(row.price) || !validPositiveDecimal(row.quantity)) throw new Error("render_book_level");
    if (seen.has(row.price)) throw new Error("render_book_duplicate");
    seen.add(row.price);
    out.push({ price: row.price, quantity: row.quantity });
    if (out.length >= BOOK_LEVELS) break;
  }
  return out;
}

function normalizedSnapshotToBybitTickers(snapshot) {
  if (snapshot?.type !== "snapshot" || !Array.isArray(snapshot.rows)) throw new Error("render_ticker_shape");
  const list = snapshot.rows
    .filter(row => row?.marketType === "linear_perpetual" && row?.provider === "bybit" && row?.quoteAsset === "USDT"
      && row?.settleAsset === "USDT" && typeof row?.providerSymbol === "string" && SYMBOL_RE.test(row.providerSymbol)
      && Number(row.lastPrice) > 0)
    .map(row => ({
      symbol: row.providerSymbol,
      lastPrice: String(row.lastPrice),
      bid1Price: row.bidPrice == null ? null : String(row.bidPrice),
      ask1Price: row.askPrice == null ? null : String(row.askPrice),
      highPrice24h: row.high24h == null ? null : String(row.high24h),
      lowPrice24h: row.low24h == null ? null : String(row.low24h),
      volume24h: row.volume24h == null ? null : String(row.volume24h),
      turnover24h: row.quoteVolume24h == null ? null : String(row.quoteVolume24h),
      price24hPcnt: row.changePercent24h == null ? null : String(Number(row.changePercent24h) / 100),
      indexPrice: row.indexPrice == null ? null : String(row.indexPrice),
      markPrice: row.markPrice == null ? null : String(row.markPrice),
      fundingRate: row.fundingRate == null ? null : String(row.fundingRate),
      openInterest: row.openInterest == null ? null : String(row.openInterest),
      openInterestValue: row.openInterestValue == null ? null : String(row.openInterestValue),
    }));
  if (!list.length) throw new Error("render_ticker_empty");
  return { retCode: 0, time: Number(snapshot.sentAt) || Date.now(), result: { category: "linear", list } };
}

function normalizeBookRows(rows) {
  if (!Array.isArray(rows)) throw new Error("book_shape");
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2 || !validPositiveDecimal(row[0]) || !validPositiveDecimal(row[1])) {
      throw new Error("book_level");
    }
    const price = row[0];
    if (seen.has(price)) throw new Error("book_duplicate");
    seen.add(price);
    out.push({ price, quantity: row[1] });
    if (out.length >= BOOK_LEVELS) break;
  }
  return out;
}

async function publicJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return response.json();
}

async function firstPublicJson(urls) {
  let lastError;
  for (const url of urls) {
    try { return await publicJson(url); }
    catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("provider_unavailable");
}

function bybitUrl(host, path, params) {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function futuresBook(symbol) {
  try {
    const body = await firstPublicJson([
      bybitUrl("https://api.bybit.com", "/v5/market/orderbook", { category: "linear", symbol, limit: "50" }),
      bybitUrl("https://api.bytick.com", "/v5/market/orderbook", { category: "linear", symbol, limit: "50" }),
    ]);
    if (body?.retCode !== 0 || body?.result?.s !== symbol) throw new Error("provider_identity");

    const bids = normalizeBookRows(body.result.b);
    const asks = normalizeBookRows(body.result.a);
    if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("provider_book");

    const providerTime = Number(body.time);
    const updateId = Number(body.result.u);
    if (!Number.isSafeInteger(updateId) || updateId < 1) throw new Error("provider_update");
    return {
      available: true, symbol, source: "bybit", fetchedAt: Date.now(),
      providerTime: Number.isFinite(providerTime) && providerTime > 0 ? providerTime : Date.now(),
      stale: false, updateId, bids, asks,
    };
  } catch {
    // Rare fallback only. Normal production viewers use Bybit directly from the browser,
    // so this does not put Render back in the hot market-data path.
    const body = await publicJson(`${RENDER_API_BASE}/market/futures/orderbook/${encodeURIComponent(symbol)}`);
    if (body?.available !== true || body?.symbol !== symbol) throw new Error("render_book_identity");
    const bids = normalizeRenderBookRows(body.bids);
    const asks = normalizeRenderBookRows(body.asks);
    if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("render_book");
    const updateId = Number(body.updateId);
    if (!Number.isSafeInteger(updateId) || updateId < 1) throw new Error("render_book_update");
    return { ...body, bids, asks, source: body.source || "bybit" };
  }
}

async function futuresTrades(symbol) {
  try {
    const body = await firstPublicJson([
      bybitUrl("https://api.bybit.com", "/v5/market/recent-trade", { category: "linear", symbol, limit: "30" }),
      bybitUrl("https://api.bytick.com", "/v5/market/recent-trade", { category: "linear", symbol, limit: "30" }),
    ]);
    if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) throw new Error("provider_trade_shape");
    const seen = new Set();
    const rows = body.result.list.map((row) => {
      if (row?.symbol !== symbol || !["Buy", "Sell"].includes(row.side)
        || typeof row.execId !== "string" || !row.execId || seen.has(row.execId)
        || !validPositiveDecimal(row.price) || !validPositiveDecimal(row.size)
        || !Number.isSafeInteger(Number(row.time)) || Number(row.time) <= 0) throw new Error("provider_trade_identity");
      seen.add(row.execId);
      return { id: row.execId, price: row.price, quantity: row.size, time: Number(row.time), side: row.side === "Buy" ? "BUY" : "SELL" };
    }).slice(0, 30).sort((a, b) => b.time - a.time);
    return { symbol, trades: rows };
  } catch {
    const body = await publicJson(`${RENDER_API_BASE}/market/display/futures-trades/${encodeURIComponent(symbol)}`);
    if (body?.symbol !== symbol || !Array.isArray(body.trades) || body.trades.length > 30) throw new Error("render_trade_shape");
    return body;
  }
}

const KLINE_INTERVALS = new Set(["1","3","5","15","30","60","120","240","360","720","D","W","M"]);

async function futuresTickers() {
  try {
    const body = await firstPublicJson([
      bybitUrl("https://api.bybit.com", "/v5/market/tickers", { category: "linear" }),
      bybitUrl("https://api.bytick.com", "/v5/market/tickers", { category: "linear" }),
    ]);
    if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) throw new Error("provider_ticker_shape");
    return body;
  } catch {
    return normalizedSnapshotToBybitTickers(await publicJson(`${RENDER_API_BASE}/market/display`));
  }
}

async function futuresCandles(symbol, searchParams) {
  const interval = searchParams.get("interval") || "";
  const limitRaw = Number(searchParams.get("limit") || "320");
  const endRaw = searchParams.get("end");
  if (!KLINE_INTERVALS.has(interval) || !Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 1000) {
    throw new RangeError("invalid_candle_query");
  }
  if (endRaw !== null && (!/^\d+$/.test(endRaw) || !Number.isSafeInteger(Number(endRaw)) || Number(endRaw) <= 0)) {
    throw new RangeError("invalid_candle_end");
  }
  const params = { category: "linear", symbol, interval, limit: String(limitRaw) };
  if (endRaw !== null) params.end = endRaw;
  try {
    const body = await firstPublicJson([
      bybitUrl("https://api.bybit.com", "/v5/market/kline", params),
      bybitUrl("https://api.bytick.com", "/v5/market/kline", params),
    ]);
    if (body?.retCode !== 0 || body?.result?.category !== "linear" || body?.result?.symbol !== symbol || !Array.isArray(body?.result?.list)) throw new Error("provider_candle_shape");
    return body;
  } catch {
    const appInterval = APP_INTERVAL_BY_PROVIDER[interval];
    if (!appInterval) throw new Error("render_candle_interval");
    const pair = symbol.replace(/USDT$/, "-USDT");
    const query = new URLSearchParams({ interval: appInterval, limit: String(limitRaw) });
    if (endRaw !== null) query.set("endTime", endRaw);
    const body = await publicJson(`${RENDER_API_BASE}/market/futures/candles/${pair}?${query}`);
    if (body?.retCode !== 0 || body?.result?.category !== "linear" || body?.result?.symbol !== symbol || !Array.isArray(body?.result?.list)) throw new Error("render_candle_shape");
    return body;
  }
}


function spotIdentity(slug) {
  if (!SPOT_SLUG_RE.test(slug)) throw new RangeError("invalid_spot_pair");
  const [base, quote] = slug.split("-");
  return {
    pair: `${base}/${quote}`,
    kraken: `${KRAKEN_ASSET[base] ?? base}${KRAKEN_ASSET[quote] ?? quote}`,
  };
}

function krakenResultValue(body) {
  if (!body || !Array.isArray(body.error) || body.error.length || !body.result || typeof body.result !== "object") {
    throw new Error("kraken_shape");
  }
  const key = Object.keys(body.result).find(name => name !== "last");
  if (!key) throw new Error("kraken_empty");
  return body.result[key];
}

async function spotBook(slug) {
  const { pair, kraken } = spotIdentity(slug);
  try {
    const query = new URLSearchParams({ pair: kraken, count: String(BOOK_LEVELS) });
    const body = await publicJson(`https://api.kraken.com/0/public/Depth?${query}`);
    const raw = krakenResultValue(body);
    const map = rows => {
      if (!Array.isArray(rows)) throw new Error("kraken_book_shape");
      return rows.slice(0, BOOK_LEVELS).map(row => {
        if (!Array.isArray(row) || !validPositiveDecimal(row[0]) || !validPositiveDecimal(row[1])) throw new Error("kraken_book_level");
        return { price: row[0], quantity: row[1] };
      });
    };
    const bids = map(raw.bids).sort((a,b)=>Number(b.price)-Number(a.price));
    const asks = map(raw.asks).sort((a,b)=>Number(a.price)-Number(b.price));
    if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("kraken_book_unusable");
    const newest = Math.max(...[...(raw.bids ?? []), ...(raw.asks ?? [])].slice(0, BOOK_LEVELS * 2)
      .map(row => Number(row?.[2]) * 1000).filter(value => Number.isFinite(value) && value > 0), 0);
    return { pair, bids, asks, timestamp: newest || Date.now(), source: "kraken" };
  } catch {
    const body = await publicJson(`${RENDER_API_BASE}/market/external/orderbook/${encodeURIComponent(slug)}?limit=${BOOK_LEVELS}`);
    if (body?.pair !== pair || !Array.isArray(body.bids) || !Array.isArray(body.asks)) throw new Error("render_spot_book_shape");
    return body;
  }
}

async function spotCandles(slug, searchParams) {
  const { pair, kraken } = spotIdentity(slug);
  const interval = searchParams.get("interval") || "";
  const krakenInterval = SPOT_INTERVAL_MINUTES[interval];
  const limit = Number(searchParams.get("limit") || "520");
  if (!krakenInterval || !Number.isSafeInteger(limit) || limit < 1 || limit > 720) throw new RangeError("invalid_spot_candle_query");
  try {
    const query = new URLSearchParams({ pair: kraken, interval: krakenInterval });
    const body = await publicJson(`https://api.kraken.com/0/public/OHLC?${query}`);
    const raw = krakenResultValue(body);
    if (!Array.isArray(raw)) throw new Error("kraken_candle_shape");
    const candles = raw.map(row => {
      if (!Array.isArray(row) || row.length < 7) throw new Error("kraken_candle_row");
      const values = [Number(row[0]),Number(row[1]),Number(row[2]),Number(row[3]),Number(row[4]),Number(row[6])];
      if (!values.every(Number.isFinite) || values[0] <= 0 || Math.min(...values.slice(1,5)) <= 0
        || values[2] < Math.max(values[1],values[4]) || values[3] > Math.min(values[1],values[4])) throw new Error("kraken_candle_values");
      return { time:values[0], open:values[1], high:values[2], low:values[3], close:values[4], volume:Math.max(0,values[5]) };
    }).sort((a,b)=>a.time-b.time).slice(-limit);
    if (!candles.length) throw new Error("kraken_candle_empty");
    return { source:"kraken", pair, interval, candles };
  } catch {
    const body = await publicJson(`${RENDER_API_BASE}/market/external/candles/${encodeURIComponent(slug)}?interval=${encodeURIComponent(interval)}&limit=${limit}`);
    if (body?.pair !== pair || body?.interval !== interval || !Array.isArray(body.candles)) throw new Error("render_spot_candle_shape");
    return body;
  }
}

async function cachedPublic(request, loader) {
  const cache = globalThis.caches?.default;
  const key = new Request(request.url, { method: "GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  const response = json(await loader());
  if (cache) {
    // Cloudflare Cache API is edge-local and does not consume KV writes.
    // This collapses repeated viewers at the same edge without touching Render.
    await cache.put(key, response.clone());
  }
  return response;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    try {
      let response;
      if (url.pathname === "/health") {
        response = json({ ok: true, service: "voltex-market-edge", version: "futures-edge-direct-v5" }, 200, { "cache-control": "no-store" });
      } else {
        const book = url.pathname.match(/^\/market\/display\/futures-book\/([A-Z0-9]{1,28}USDT)$/);
        const trades = url.pathname.match(/^\/market\/display\/futures-trades\/([A-Z0-9]{1,28}USDT)$/);
        const candles = url.pathname.match(/^\/market\/display\/futures-candles\/([A-Z0-9]{1,28}USDT)$/);
        const spotBookMatch = url.pathname.match(/^\/market\/display\/spot-book\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const spotCandlesMatch = url.pathname.match(/^\/market\/display\/spot-candles\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);

        if (book) {
          const symbol = book[1];
          if (!SYMBOL_RE.test(symbol)) return json({ error: "symbol_not_listed" }, 404);
          response = await cachedPublic(request, () => futuresBook(symbol));
        } else if (trades) {
          const symbol = trades[1];
          if (!SYMBOL_RE.test(symbol)) return json({ error: "symbol_not_listed" }, 404);
          response = await cachedPublic(request, () => futuresTrades(symbol));
        } else if (url.pathname === "/market/display/futures-tickers") {
          response = await cachedPublic(request, futuresTickers);
        } else if (candles) {
          const symbol = candles[1];
          if (!SYMBOL_RE.test(symbol)) return json({ error: "symbol_not_listed" }, 404);
          response = await cachedPublic(request, () => futuresCandles(symbol, url.searchParams));
        } else if (spotBookMatch) {
          response = await cachedPublic(request, () => spotBook(spotBookMatch[1]));
        } else if (spotCandlesMatch) {
          response = await cachedPublic(request, () => spotCandles(spotCandlesMatch[1], url.searchParams));
        } else {
          return json({ ok: false, error: "not_found" }, 404);
        }
      }

      if (request.method === "HEAD") {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    } catch {
      return json({ ok: false, error: "market_data_unavailable" }, 503);
    }
  },
};
