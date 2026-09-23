// VOLTEX public market-data edge.
// Public reference data only: no auth, no cookies, no trading, no balances,
// no positions, no Neon and no Render fallback.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const EDGE_TTL_SECONDS = 15;
const BOOK_LEVELS = 25;
const SYMBOL_RE = /^[A-Z0-9]{1,28}USDT$/;
const OKX_BAR = {
  "1":"1m","3":"3m","5":"5m","15":"15m","30":"30m",
  "60":"1H","120":"2H","240":"4H","360":"6H","720":"12H",
  "D":"1D","W":"1W","M":"1M"
};

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
  return typeof value === "string" && value.length <= 64 &&
    /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
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

function urlWith(host, path, params) {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}
function bybitUrl(path, params) {
  return [
    urlWith("https://api.bybit.com", path, params),
    urlWith("https://api.bytick.com", path, params),
  ];
}
function okxInstId(symbol) {
  if (!SYMBOL_RE.test(symbol)) throw new Error("symbol_invalid");
  return `${symbol.slice(0, -4)}-USDT-SWAP`;
}
function symbolFromOkx(instId) {
  const match = /^([A-Z0-9]{1,28})-USDT-SWAP$/.exec(instId || "");
  return match ? `${match[1]}USDT` : null;
}

async function bybitBook(symbol) {
  const body = await firstPublicJson(bybitUrl("/v5/market/orderbook", { category: "linear", symbol, limit: "50" }));
  if (body?.retCode !== 0 || body?.result?.s !== symbol) throw new Error("bybit_book_identity");
  const bids = normalizeBookRows(body.result.b), asks = normalizeBookRows(body.result.a);
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("bybit_book");
  const updateId = Number(body.result.u), providerTime = Number(body.time);
  if (!Number.isSafeInteger(updateId) || updateId < 1) throw new Error("bybit_book_update");
  return { available:true, symbol, source:"bybit", fetchedAt:Date.now(),
    providerTime:Number.isFinite(providerTime)&&providerTime>0?providerTime:Date.now(),
    stale:false, updateId, bids, asks };
}

async function okxBook(symbol) {
  const body = await publicJson(urlWith("https://www.okx.com", "/api/v5/market/books", { instId: okxInstId(symbol), sz: "25" }));
  const row = body?.code === "0" && Array.isArray(body.data) ? body.data[0] : null;
  if (!row) throw new Error("okx_book_shape");
  const bids = normalizeBookRows(row.bids), asks = normalizeBookRows(row.asks);
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("okx_book");
  const providerTime = Number(row.ts);
  if (!Number.isSafeInteger(providerTime) || providerTime <= 0) throw new Error("okx_book_time");
  return { available:true, symbol, source:"okx", fetchedAt:Date.now(), providerTime,
    stale:false, updateId:providerTime, bids, asks };
}

async function futuresBook(symbol) {
  try { return await bybitBook(symbol); }
  catch { return okxBook(symbol); }
}

async function bybitTrades(symbol) {
  const body = await firstPublicJson(bybitUrl("/v5/market/recent-trade", { category:"linear", symbol, limit:"30" }));
  if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) throw new Error("bybit_trade_shape");
  const seen = new Set();
  const trades = body.result.list.map(row => {
    if (row?.symbol !== symbol || !["Buy","Sell"].includes(row.side) || typeof row.execId !== "string" || !row.execId ||
        seen.has(row.execId) || !validPositiveDecimal(row.price) || !validPositiveDecimal(row.size) ||
        !Number.isSafeInteger(Number(row.time)) || Number(row.time) <= 0) throw new Error("bybit_trade_identity");
    seen.add(row.execId);
    return { id:row.execId, price:row.price, quantity:row.size, time:Number(row.time), side:row.side==="Buy"?"BUY":"SELL" };
  }).slice(0,30).sort((a,b)=>b.time-a.time);
  return { symbol, source:"bybit", trades };
}

async function okxTrades(symbol) {
  const body = await publicJson(urlWith("https://www.okx.com", "/api/v5/market/trades", { instId:okxInstId(symbol), limit:"30" }));
  if (body?.code !== "0" || !Array.isArray(body.data)) throw new Error("okx_trade_shape");
  const seen = new Set();
  const trades = body.data.map(row => {
    if (!row || row.instId !== okxInstId(symbol) || typeof row.tradeId !== "string" || !row.tradeId || seen.has(row.tradeId) ||
        !validPositiveDecimal(row.px) || !validPositiveDecimal(row.sz) || !["buy","sell"].includes(row.side) ||
        !Number.isSafeInteger(Number(row.ts)) || Number(row.ts) <= 0) throw new Error("okx_trade_identity");
    seen.add(row.tradeId);
    return { id:`okx:${row.tradeId}`, price:row.px, quantity:row.sz, time:Number(row.ts), side:row.side==="buy"?"BUY":"SELL" };
  }).slice(0,30).sort((a,b)=>b.time-a.time);
  return { symbol, source:"okx", trades };
}

async function futuresTrades(symbol) {
  try { return await bybitTrades(symbol); }
  catch { return okxTrades(symbol); }
}

async function bybitTickers() {
  const body = await firstPublicJson(bybitUrl("/v5/market/tickers", { category:"linear" }));
  if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) throw new Error("bybit_ticker_shape");
  return { ...body, source:"bybit" };
}

async function okxTickers() {
  const body = await publicJson(urlWith("https://www.okx.com", "/api/v5/market/tickers", { instType:"SWAP" }));
  if (body?.code !== "0" || !Array.isArray(body.data)) throw new Error("okx_ticker_shape");
  const list = [];
  let newest = 0;
  for (const row of body.data) {
    const symbol = symbolFromOkx(row?.instId);
    if (!symbol || !validPositiveDecimal(row.last)) continue;
    const last = Number(row.last), open = Number(row.open24h);
    const change = Number.isFinite(open) && open > 0 ? last / open - 1 : null;
    const ts = Number(row.ts); if (Number.isFinite(ts)) newest = Math.max(newest, ts);
    list.push({
      symbol,
      lastPrice:row.last,
      bid1Price:validPositiveDecimal(row.bidPx)?row.bidPx:null,
      ask1Price:validPositiveDecimal(row.askPx)?row.askPx:null,
      highPrice24h:validPositiveDecimal(row.high24h)?row.high24h:null,
      lowPrice24h:validPositiveDecimal(row.low24h)?row.low24h:null,
      price24hPcnt:change===null?null:String(change),
      volume24h:null,
      turnover24h:null,
      indexPrice:null,
      markPrice:null,
      fundingRate:null,
      openInterest:null,
      openInterestValue:null,
    });
  }
  if (!list.length) throw new Error("okx_ticker_empty");
  return { retCode:0, time:newest||Date.now(), source:"okx", result:{ category:"linear", list } };
}

async function futuresTickers() {
  try { return await bybitTickers(); }
  catch { return okxTickers(); }
}

const KLINE_INTERVALS = new Set(["1","3","5","15","30","60","120","240","360","720","D","W","M"]);

async function bybitCandles(symbol, interval, limitRaw, endRaw) {
  const params = { category:"linear", symbol, interval, limit:String(limitRaw) };
  if (endRaw !== null) params.end = endRaw;
  const body = await firstPublicJson(bybitUrl("/v5/market/kline", params));
  if (body?.retCode !== 0 || body?.result?.category !== "linear" || body?.result?.symbol !== symbol || !Array.isArray(body?.result?.list)) {
    throw new Error("bybit_candle_shape");
  }
  return { ...body, source:"bybit" };
}

async function okxCandles(symbol, interval, limitRaw, endRaw) {
  const bar = OKX_BAR[interval];
  if (!bar) throw new Error("okx_candle_interval");
  const params = { instId:okxInstId(symbol), bar, limit:String(Math.min(300,limitRaw)) };
  if (endRaw !== null) params.after = endRaw;
  const body = await publicJson(urlWith("https://www.okx.com", "/api/v5/market/candles", params));
  if (body?.code !== "0" || !Array.isArray(body.data)) throw new Error("okx_candle_shape");
  const list = body.data.map(row => {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0,6).some(v => typeof v!=="string" || !/^\d+(?:\.\d+)?$/.test(v))) {
      throw new Error("okx_candle_row");
    }
    return row.slice(0,6);
  });
  if (!list.length) throw new Error("okx_candle_empty");
  return { retCode:0, time:Date.now(), source:"okx", result:{ category:"linear", symbol, list } };
}

async function futuresCandles(symbol, searchParams) {
  const interval = searchParams.get("interval") || "";
  const limitRaw = Number(searchParams.get("limit") || "320");
  const endRaw = searchParams.get("end");
  if (!KLINE_INTERVALS.has(interval) || !Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 1000) throw new RangeError("invalid_candle_query");
  if (endRaw !== null && (!/^\d+$/.test(endRaw) || !Number.isSafeInteger(Number(endRaw)) || Number(endRaw) <= 0)) throw new RangeError("invalid_candle_end");
  try { return await bybitCandles(symbol, interval, limitRaw, endRaw); }
  catch { return okxCandles(symbol, interval, limitRaw, endRaw); }
}

async function cachedPublic(request, loader) {
  const cache = globalThis.caches?.default;
  const key = new Request(request.url, { method:"GET" });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const response = json(await loader());
  if (cache) await cache.put(key, response.clone());
  return response;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status:204, headers:JSON_HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ ok:false, error:"method_not_allowed" },405);

    try {
      let response;
      if (url.pathname === "/health") {
        response = json({ ok:true, service:"voltex-market-edge", version:"futures-edge-direct-v6" },200,{"cache-control":"no-store"});
      } else {
        const book=url.pathname.match(/^\/market\/display\/futures-book\/([A-Z0-9]{1,28}USDT)$/);
        const trades=url.pathname.match(/^\/market\/display\/futures-trades\/([A-Z0-9]{1,28}USDT)$/);
        const candles=url.pathname.match(/^\/market\/display\/futures-candles\/([A-Z0-9]{1,28}USDT)$/);
        if(book) response=await cachedPublic(request,()=>futuresBook(book[1]));
        else if(trades) response=await cachedPublic(request,()=>futuresTrades(trades[1]));
        else if(url.pathname==="/market/display/futures-tickers") response=await cachedPublic(request,futuresTickers);
        else if(candles) response=await cachedPublic(request,()=>futuresCandles(candles[1],url.searchParams));
        else return json({ok:false,error:"not_found"},404);
      }
      return request.method==="HEAD" ? new Response(null,{status:response.status,headers:response.headers}) : response;
    } catch {
      return json({ ok:false, error:"market_data_unavailable" },503);
    }
  },
};
