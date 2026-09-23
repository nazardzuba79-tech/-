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
const SPOT_INTERVAL_MINUTES = { "1m":"1", "5m":"5", "15m":"15", "1h":"60", "4h":"240", "1d":"1440", "1w":"10080" };
const KRAKEN_ASSET = { BTC:"XBT", DOGE:"XDG" };
const SPOT_SLUG_RE = /^[A-Z0-9]{1,32}-[A-Z0-9]{2,12}$/;
const CFD_SYMBOLS = { XAUUSD:"XAUUSD", XAGUSD:"XAGUSD", XPTUSD:"XPTUSD", XPDUSD:"XPDUSD", WTIUSD:"USOIL", XBRUSD:"UKOIL", EURUSD:"EURUSD", GBPUSD:"GBPUSD", USDJPY:"USDJPY", AUDUSD:"AUDUSD", USDCAD:"USDCAD", USDCHF:"USDCHF", NZDUSD:"NZDUSD" };
const CFD_INTERVALS = new Set(["1m","5m","15m","30m","1h","4h","1d"]);

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


function decimalOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bybitTickerRows(category, body, now = Date.now()) {
  if (body?.retCode !== 0 || body?.result?.category !== category || !Array.isArray(body?.result?.list)) throw new Error("ticker_shape");
  const rows = [];
  const provider = body?.source === "okx" ? "okx" : "bybit";
  for (const raw of body.result.list) {
    if (!raw || typeof raw.symbol !== "string" || !raw.symbol.endsWith("USDT")) continue;
    const base = raw.symbol.slice(0, -4), last = decimalOrNull(raw.lastPrice);
    if (!(last > 0)) continue;
    const change = decimalOrNull(raw.price24hPcnt), linear = category === "linear";
    rows.push({
      id:`${linear ? "linear_perpetual" : "spot"}:${raw.symbol}`,
      pair:`${base}/USDT`, symbol:`${base}/USDT`, providerSymbol:raw.symbol, provider,
      marketType:linear ? "linear_perpetual" : "spot", volumeAsset:base, turnoverAsset:"USDT",
      baseAsset:base, quoteAsset:"USDT", settleAsset:linear ? "USDT" : null,
      lastPrice:last, bidPrice:decimalOrNull(raw.bid1Price), askPrice:decimalOrNull(raw.ask1Price),
      high24h:decimalOrNull(raw.highPrice24h), low24h:decimalOrNull(raw.lowPrice24h),
      volume24h:decimalOrNull(raw.volume24h), quoteVolume24h:decimalOrNull(raw.turnover24h),
      changePercent24h:change===null ? null : change*100,
      indexPrice:linear ? decimalOrNull(raw.indexPrice) : null,
      markPrice:linear ? decimalOrNull(raw.markPrice) : null,
      fundingRate:linear ? decimalOrNull(raw.fundingRate) : null,
      fundingIntervalMinutes:null, openInterest:linear ? decimalOrNull(raw.openInterest) : null,
      openInterestValue:linear ? decimalOrNull(raw.openInterestValue) : null,
      providerEventAt:decimalOrNull(body.time), sequence:null, receivedAt:now, fetchedAt:now, stale:false,
    });
  }
  return rows;
}

async function okxSpotTickers() {
  const body = await publicJson(urlWith("https://www.okx.com", "/api/v5/market/tickers", { instType:"SPOT" }));
  if (body?.code !== "0" || !Array.isArray(body.data)) throw new Error("okx_spot_ticker_shape");
  const list = [];
  let newest = 0;
  for (const row of body.data) {
    const match = /^([A-Z0-9]{1,28})-USDT$/.exec(row?.instId || "");
    if (!match || !validPositiveDecimal(row.last)) continue;
    const last=Number(row.last), open=Number(row.open24h), ts=Number(row.ts);
    if (Number.isFinite(ts)) newest=Math.max(newest,ts);
    list.push({
      symbol:`${match[1]}USDT`, lastPrice:row.last,
      bid1Price:validPositiveDecimal(row.bidPx)?row.bidPx:null, ask1Price:validPositiveDecimal(row.askPx)?row.askPx:null,
      highPrice24h:validPositiveDecimal(row.high24h)?row.high24h:null, lowPrice24h:validPositiveDecimal(row.low24h)?row.low24h:null,
      price24hPcnt:Number.isFinite(open)&&open>0?String(last/open-1):null,
      volume24h:validPositiveDecimal(row.vol24h)?row.vol24h:null,
      turnover24h:validPositiveDecimal(row.volCcy24h)?row.volCcy24h:null,
    });
  }
  if (!list.length) throw new Error("okx_spot_ticker_empty");
  return { retCode:0, time:newest||Date.now(), source:"okx", result:{ category:"spot", list } };
}

async function spotTickerBody() {
  try {
    const body = await firstPublicJson(bybitUrl("/v5/market/tickers", { category:"spot" }));
    if (body?.retCode !== 0 || body?.result?.category !== "spot" || !Array.isArray(body?.result?.list)) throw new Error("bybit_spot_ticker_shape");
    return { ...body, source:"bybit" };
  } catch {
    return okxSpotTickers();
  }
}

async function publicMarketSnapshot() {
  const [spot, linear] = await Promise.all([spotTickerBody(), futuresTickers()]);
  const now=Date.now(), rows=[...bybitTickerRows("spot",spot,now),...bybitTickerRows("linear",linear,now)];
  if (!rows.length) throw new Error("empty_market_snapshot");
  return { version:1, type:"snapshot", epoch:"market-edge-v7", revision:Math.floor(now/1000), sentAt:now, status:"live", rows, _display:{mode:"snapshot"} };
}

function spotIdentity(slug) {
  if (!SPOT_SLUG_RE.test(slug)) throw new RangeError("invalid_spot_pair");
  const [base,quote]=slug.split("-");
  return { base, quote, pair:`${base}/${quote}`, kraken:`${KRAKEN_ASSET[base]??base}${KRAKEN_ASSET[quote]??quote}` };
}
function krakenResultValue(body) {
  if (!body || !Array.isArray(body.error) || body.error.length || !body.result || typeof body.result !== "object") throw new Error("kraken_shape");
  const key=Object.keys(body.result).find(name=>name!=="last");
  if(!key) throw new Error("kraken_empty");
  return body.result[key];
}

async function spotBook(slug) {
  const {pair,kraken}=spotIdentity(slug);
  const query=new URLSearchParams({pair:kraken,count:String(BOOK_LEVELS)});
  const body=await publicJson(`https://api.kraken.com/0/public/Depth?${query}`);
  const raw=krakenResultValue(body);
  const map=(rows)=>{
    if(!Array.isArray(rows))throw new Error("kraken_book_shape");
    return rows.slice(0,BOOK_LEVELS).map(row=>{
      if(!Array.isArray(row)||!validPositiveDecimal(row[0])||!validPositiveDecimal(row[1]))throw new Error("kraken_book_level");
      return {price:row[0],quantity:row[1]};
    });
  };
  const bids=map(raw.bids).sort((a,b)=>Number(b.price)-Number(a.price));
  const asks=map(raw.asks).sort((a,b)=>Number(a.price)-Number(b.price));
  if(!bids.length||!asks.length||Number(bids[0].price)>=Number(asks[0].price))throw new Error("kraken_book_unusable");
  const newest=Math.max(...[...(raw.bids??[]),...(raw.asks??[])].slice(0,BOOK_LEVELS*2)
    .map(row=>Number(row?.[2])*1000).filter(value=>Number.isFinite(value)&&value>0),0);
  return {available:true,pair,bids,asks,timestamp:newest||Date.now(),fetchedAt:Date.now(),stale:false,source:"kraken"};
}

async function spotTrades(slug) {
  const {base,quote,pair}=spotIdentity(slug),symbol=`${base}${quote}`;
  try {
    const body=await firstPublicJson(bybitUrl("/v5/market/recent-trade",{category:"spot",symbol,limit:"30"}));
    if(body?.retCode!==0||body?.result?.category!=="spot"||!Array.isArray(body?.result?.list))throw new Error("spot_trade_shape");
    return {pair,source:"bybit",trades:body.result.list.slice(0,30).map(row=>({
      id:row.execId,price:row.price,quantity:row.size,side:row.side==="Buy"?"BUY":"SELL",time:Number(row.time)
    })).filter(row=>row.id&&validPositiveDecimal(row.price)&&validPositiveDecimal(row.quantity)&&Number.isSafeInteger(row.time)&&row.time>0)};
  } catch {
    const body=await publicJson(urlWith("https://www.okx.com","/api/v5/market/trades",{instId:`${base}-${quote}`,limit:"30"}));
    if(body?.code!=="0"||!Array.isArray(body.data))throw new Error("okx_spot_trade_shape");
    return {pair,source:"okx",trades:body.data.map(row=>({
      id:`okx:${row.tradeId}`,price:row.px,quantity:row.sz,side:row.side==="buy"?"BUY":"SELL",time:Number(row.ts)
    })).filter(row=>row.id!=="okx:undefined"&&validPositiveDecimal(row.price)&&validPositiveDecimal(row.quantity)&&Number.isSafeInteger(row.time)&&row.time>0).slice(0,30)};
  }
}

async function spotCandles(slug, searchParams) {
  const {base,quote,pair,kraken}=spotIdentity(slug);
  const interval=searchParams.get("interval")||"", krakenInterval=SPOT_INTERVAL_MINUTES[interval];
  const limit=Number(searchParams.get("limit")||"520");
  if(!krakenInterval||!Number.isSafeInteger(limit)||limit<1||limit>720)throw new RangeError("invalid_spot_candle_query");
  try {
    const query=new URLSearchParams({pair:kraken,interval:krakenInterval});
    const raw=krakenResultValue(await publicJson(`https://api.kraken.com/0/public/OHLC?${query}`));
    if(!Array.isArray(raw))throw new Error("kraken_candle_shape");
    const candles=raw.map(row=>{
      if(!Array.isArray(row)||row.length<7)throw new Error("kraken_candle_row");
      const v=[Number(row[0]),Number(row[1]),Number(row[2]),Number(row[3]),Number(row[4]),Number(row[6])];
      if(!v.every(Number.isFinite)||v[0]<=0||Math.min(...v.slice(1,5))<=0||v[2]<Math.max(v[1],v[4])||v[3]>Math.min(v[1],v[4]))throw new Error("kraken_candle_values");
      return {time:v[0],open:v[1],high:v[2],low:v[3],close:v[4],volume:Math.max(0,v[5])};
    }).sort((a,b)=>a.time-b.time).slice(-limit);
    if(!candles.length)throw new Error("kraken_candle_empty");
    return {source:"kraken",pair,interval,candles};
  } catch {
    const provider=({ "1m":"1","5m":"5","15m":"15","1h":"60","4h":"240","1d":"D","1w":"W" })[interval];
    const symbol=`${base}${quote}`;
    const body=await firstPublicJson(bybitUrl("/v5/market/kline",{category:"spot",symbol,interval:provider,limit:String(Math.min(1000,limit))}));
    if(body?.retCode!==0||body?.result?.category!=="spot"||body?.result?.symbol!==symbol||!Array.isArray(body?.result?.list))throw new Error("spot_candle_fallback_shape");
    const candles=body.result.list.map(row=>({time:Number(row[0])/1000,open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])}))
      .filter(row=>[row.time,row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite)&&row.time>0&&Math.min(row.open,row.high,row.low,row.close)>0)
      .sort((a,b)=>a.time-b.time).slice(-limit);
    if(!candles.length)throw new Error("spot_candle_fallback_empty");
    return {source:"bybit",pair,interval,candles};
  }
}

async function spotTickers() {
  const body=await spotTickerBody();
  return {source:`${body.source||"bybit"}-edge`,tickers:bybitTickerRows("spot",body).map(row=>({
    pair:row.pair,lastPrice:String(row.lastPrice),bidPrice:row.bidPrice==null?"":String(row.bidPrice),askPrice:row.askPrice==null?"":String(row.askPrice),
    high24h:row.high24h==null?"":String(row.high24h),low24h:row.low24h==null?"":String(row.low24h),volume24h:row.volume24h==null?"":String(row.volume24h),
    quoteVolume24h:row.quoteVolume24h==null?"":String(row.quoteVolume24h),changePercent24h:row.changePercent24h==null?"":String(row.changePercent24h)
  }))};
}

async function cfdTickers() {
  const url=new URL("https://biquote.io/api/latest");
  for(const provider of Object.values(CFD_SYMBOLS))url.searchParams.append("symbols",provider);
  const raw=await publicJson(url.toString()),now=Date.now(),tickers=[];
  for(const [symbol,providerSymbol] of Object.entries(CFD_SYMBOLS)){
    const row=raw?.[providerSymbol],price=Number(row?.mid);
    const at=typeof row?.timestamp==="number"&&Number.isFinite(row.timestamp)?(row.timestamp<1e12?row.timestamp*1000:row.timestamp)
      :typeof row?.timestamp==="string"?(/^\d+(?:\.\d+)?$/.test(row.timestamp)?(Number(row.timestamp)<1e12?Number(row.timestamp)*1000:Number(row.timestamp)):Date.parse(row.timestamp)):NaN;
    tickers.push({
      symbol,name:symbol,price:Number.isFinite(price)&&price>0?String(price):null,
      changePercent24h:Number.isFinite(Number(row?.dayDiffPercent))?String(row.dayDiffPercent):undefined,
      status:Number.isFinite(price)&&price>0?(row?.marketState==="closed"?"market_closed":row?.stale===true?"stale":"sampled"):"unavailable",
      stale:row?.stale===true,marketClosed:row?.marketState==="closed",displayOnly:true,executionAllowed:false,
      provider:"biquote",providerSymbol,providerTimestamp:Number.isFinite(at)?at:null,fetchedAt:now,asOf:Number.isFinite(at)?at:now,maxQuoteAgeMs:120000
    });
  }
  return {source:"biquote-edge",configured:true,tickers};
}

async function cfdCandles(symbol, searchParams) {
  const provider=CFD_SYMBOLS[symbol],interval=searchParams.get("interval")||"15m";
  const limit=Math.max(20,Math.min(500,Number(searchParams.get("limit")||"240")));
  if(!provider||!CFD_INTERVALS.has(interval)||!Number.isSafeInteger(limit))throw new RangeError("invalid_cfd_candle_request");
  const url=new URL(`https://biquote.io/api/${encodeURIComponent(provider)}/ohlc`);
  url.searchParams.set("interval",interval);url.searchParams.set("limit",String(limit));
  const raw=await publicJson(url.toString());
  if(!raw||raw.symbol!==provider||raw.interval!==interval||!Array.isArray(raw.bars))throw new Error("cfd_candle_shape");
  return {...raw,symbol,fetchedAt:Date.now()};
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
        response = json({ ok:true, service:"voltex-market-edge", version:"public-display-edge-v7" },200,{"cache-control":"no-store"});
      } else {
        const book=url.pathname.match(/^\/market\/display\/futures-book\/([A-Z0-9]{1,28}USDT)$/);
        const trades=url.pathname.match(/^\/market\/display\/futures-trades\/([A-Z0-9]{1,28}USDT)$/);
        const candles=url.pathname.match(/^\/market\/display\/futures-candles\/([A-Z0-9]{1,28}USDT)$/);
        const spotBookMatch=url.pathname.match(/^\/market\/display\/spot-book\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const spotTradesMatch=url.pathname.match(/^\/market\/display\/spot-trades\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const spotCandlesMatch=url.pathname.match(/^\/market\/display\/spot-candles\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const cfdCandlesMatch=url.pathname.match(/^\/cfd\/display\/candles\/([A-Z0-9]{3,12})$/);
        if(url.pathname==="/market/display") response=await cachedPublic(request,publicMarketSnapshot);
        else if(url.pathname==="/market/display/spot-tickers") response=await cachedPublic(request,spotTickers);
        else if(spotBookMatch) response=await cachedPublic(request,()=>spotBook(spotBookMatch[1]));
        else if(spotTradesMatch) response=await cachedPublic(request,()=>spotTrades(spotTradesMatch[1]));
        else if(spotCandlesMatch) response=await cachedPublic(request,()=>spotCandles(spotCandlesMatch[1],url.searchParams));
        else if(url.pathname==="/cfd/display/tickers") response=await cachedPublic(request,cfdTickers);
        else if(cfdCandlesMatch) response=await cachedPublic(request,()=>cfdCandles(cfdCandlesMatch[1],url.searchParams));
        else if(book) response=await cachedPublic(request,()=>futuresBook(book[1]));
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
