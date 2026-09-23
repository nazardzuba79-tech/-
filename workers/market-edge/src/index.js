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
  const body = await firstPublicJson([
    bybitUrl("https://api.bybit.com", "/v5/market/orderbook", { category: "linear", symbol, limit: "50" }),
    bybitUrl("https://api.bytick.com", "/v5/market/orderbook", { category: "linear", symbol, limit: "50" }),
  ]);
  if (body?.retCode !== 0 || body?.result?.s !== symbol) throw new Error("provider_identity");
  const bids = normalizeBookRows(body.result.b), asks = normalizeBookRows(body.result.a);
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("provider_book");
  const providerTime = Number(body.time), updateId = Number(body.result.u);
  if (!Number.isSafeInteger(updateId) || updateId < 1) throw new Error("provider_update");
  return { available:true, symbol, source:"bybit", fetchedAt:Date.now(),
    providerTime:Number.isFinite(providerTime)&&providerTime>0?providerTime:Date.now(),
    stale:false, updateId, bids, asks };
}

async function futuresTrades(symbol) {
  const body = await firstPublicJson([
    bybitUrl("https://api.bybit.com", "/v5/market/recent-trade", { category:"linear", symbol, limit:"30" }),
    bybitUrl("https://api.bytick.com", "/v5/market/recent-trade", { category:"linear", symbol, limit:"30" }),
  ]);
  if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) throw new Error("provider_trade_shape");
  const seen=new Set();
  const rows=body.result.list.map(row=>{
    if(row?.symbol!==symbol||!["Buy","Sell"].includes(row.side)||typeof row.execId!=="string"||!row.execId||seen.has(row.execId)
      ||!validPositiveDecimal(row.price)||!validPositiveDecimal(row.size)||!Number.isSafeInteger(Number(row.time))||Number(row.time)<=0) throw new Error("provider_trade_identity");
    seen.add(row.execId); return {id:row.execId,price:row.price,quantity:row.size,time:Number(row.time),side:row.side==="Buy"?"BUY":"SELL"};
  }).slice(0,30).sort((a,b)=>b.time-a.time);
  return {symbol,trades:rows};
}

const KLINE_INTERVALS = new Set(["1","3","5","15","30","60","120","240","360","720","D","W","M"]);

async function futuresTickers() {
  const body=await firstPublicJson([
    bybitUrl("https://api.bybit.com","/v5/market/tickers",{category:"linear"}),
    bybitUrl("https://api.bytick.com","/v5/market/tickers",{category:"linear"}),
  ]);
  if(body?.retCode!==0||body?.result?.category!=="linear"||!Array.isArray(body?.result?.list)) throw new Error("provider_ticker_shape");
  return body;
}

async function futuresCandles(symbol, searchParams) {
  const interval=searchParams.get("interval")||"", limitRaw=Number(searchParams.get("limit")||"320"), endRaw=searchParams.get("end");
  if(!KLINE_INTERVALS.has(interval)||!Number.isSafeInteger(limitRaw)||limitRaw<1||limitRaw>1000) throw new RangeError("invalid_candle_query");
  if(endRaw!==null&&(!/^\d+$/.test(endRaw)||!Number.isSafeInteger(Number(endRaw))||Number(endRaw)<=0)) throw new RangeError("invalid_candle_end");
  const params={category:"linear",symbol,interval,limit:String(limitRaw)}; if(endRaw!==null) params.end=endRaw;
  const body=await firstPublicJson([
    bybitUrl("https://api.bybit.com","/v5/market/kline",params),
    bybitUrl("https://api.bytick.com","/v5/market/kline",params),
  ]);
  if(body?.retCode!==0||body?.result?.category!=="linear"||body?.result?.symbol!==symbol||!Array.isArray(body?.result?.list)) throw new Error("provider_candle_shape");
  return body;
}

const SPOT_PAIR_RE=/^[A-Z0-9]{1,32}-[A-Z0-9]{2,12}$/;
const SPOT_INTERVALS={ "1m":"1","3m":"3","5m":"5","15m":"15","30m":"30","1h":"60","2h":"120","4h":"240","6h":"360","12h":"720","1d":"D","1w":"W" };
const CFD_SYMBOLS={XAUUSD:"XAUUSD",XAGUSD:"XAGUSD",XPTUSD:"XPTUSD",XPDUSD:"XPDUSD",WTIUSD:"USOIL",XBRUSD:"UKOIL",EURUSD:"EURUSD",GBPUSD:"GBPUSD",USDJPY:"USDJPY",AUDUSD:"AUDUSD",USDCAD:"USDCAD",USDCHF:"USDCHF",NZDUSD:"NZDUSD"};
const CFD_INTERVALS=new Set(["1m","5m","15m","30m","1h","4h","1d"]);
const decimalOrNull=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};

function bybitTickerRows(category,body,now=Date.now()){
  if(body?.retCode!==0||body?.result?.category!==category||!Array.isArray(body?.result?.list)) throw new Error("ticker_shape");
  const rows=[];
  for(const raw of body.result.list){
    if(!raw||typeof raw.symbol!=="string"||!raw.symbol.endsWith("USDT"))continue;
    const base=raw.symbol.slice(0,-4),last=decimalOrNull(raw.lastPrice);if(!(last>0))continue;
    const change=decimalOrNull(raw.price24hPcnt),linear=category==="linear";
    rows.push({id:`${linear?"linear_perpetual":"spot"}:${raw.symbol}`,pair:`${base}/USDT`,symbol:`${base}/USDT`,providerSymbol:raw.symbol,provider:"bybit",
      marketType:linear?"linear_perpetual":"spot",volumeAsset:base,turnoverAsset:"USDT",baseAsset:base,quoteAsset:"USDT",settleAsset:linear?"USDT":null,
      lastPrice:last,bidPrice:decimalOrNull(raw.bid1Price),askPrice:decimalOrNull(raw.ask1Price),high24h:decimalOrNull(raw.highPrice24h),low24h:decimalOrNull(raw.lowPrice24h),
      volume24h:decimalOrNull(raw.volume24h),quoteVolume24h:decimalOrNull(raw.turnover24h),changePercent24h:change===null?null:change*100,
      indexPrice:linear?decimalOrNull(raw.indexPrice):null,markPrice:linear?decimalOrNull(raw.markPrice):null,fundingRate:linear?decimalOrNull(raw.fundingRate):null,
      fundingIntervalMinutes:null,openInterest:linear?decimalOrNull(raw.openInterest):null,openInterestValue:linear?decimalOrNull(raw.openInterestValue):null,
      providerEventAt:decimalOrNull(body.time),sequence:null,receivedAt:now,fetchedAt:now,stale:false});
  }
  return rows;
}

async function publicMarketSnapshot(){
  const [spot,linear]=await Promise.all([
    firstPublicJson([bybitUrl("https://api.bybit.com","/v5/market/tickers",{category:"spot"}),bybitUrl("https://api.bytick.com","/v5/market/tickers",{category:"spot"})]),
    futuresTickers()
  ]);
  const now=Date.now(),rows=[...bybitTickerRows("spot",spot,now),...bybitTickerRows("linear",linear,now)];
  if(!rows.length)throw new Error("empty_market_snapshot");
  return{version:1,type:"snapshot",epoch:"market-edge-v2",revision:Math.floor(now/1000),sentAt:now,status:"live",rows,_display:{mode:"snapshot"}};
}

async function spotBook(pairSlug){
  if(!SPOT_PAIR_RE.test(pairSlug))throw new RangeError("invalid_spot_pair");
  const [base,quote]=pairSlug.split("-"),pair=`${base}/${quote}`,symbol=`${base}${quote}`;
  const body=await firstPublicJson([bybitUrl("https://api.bybit.com","/v5/market/orderbook",{category:"spot",symbol,limit:"50"}),bybitUrl("https://api.bytick.com","/v5/market/orderbook",{category:"spot",symbol,limit:"50"})]);
  if(body?.retCode!==0||body?.result?.s!==symbol)throw new Error("spot_book_identity");
  const bids=normalizeBookRows(body.result.b),asks=normalizeBookRows(body.result.a);if(!bids.length||!asks.length||Number(bids[0].price)>=Number(asks[0].price))throw new Error("spot_book");
  return{available:true,pair,bids,asks,timestamp:Number(body.time)||Date.now(),fetchedAt:Date.now(),stale:false,source:"bybit"};
}

async function spotTrades(pairSlug){
  if(!SPOT_PAIR_RE.test(pairSlug))throw new RangeError("invalid_spot_pair");
  const [base,quote]=pairSlug.split("-"),pair=`${base}/${quote}`,symbol=`${base}${quote}`;
  const body=await firstPublicJson([bybitUrl("https://api.bybit.com","/v5/market/recent-trade",{category:"spot",symbol,limit:"30"}),bybitUrl("https://api.bytick.com","/v5/market/recent-trade",{category:"spot",symbol,limit:"30"})]);
  if(body?.retCode!==0||body?.result?.category!=="spot"||!Array.isArray(body?.result?.list))throw new Error("spot_trade_shape");
  return{pair,trades:body.result.list.slice(0,30).map(row=>({id:row.execId,price:row.price,quantity:row.size,side:row.side==="Buy"?"BUY":"SELL",time:Number(row.time)})).filter(r=>r.id&&validPositiveDecimal(r.price)&&validPositiveDecimal(r.quantity)&&Number.isSafeInteger(r.time)&&r.time>0)};
}

async function spotCandles(pairSlug,searchParams){
  if(!SPOT_PAIR_RE.test(pairSlug))throw new RangeError("invalid_spot_pair");
  const interval=searchParams.get("interval")||"",provider=SPOT_INTERVALS[interval],limit=Math.max(1,Math.min(1000,Number(searchParams.get("limit")||"300")));
  if(!provider||!Number.isSafeInteger(limit))throw new RangeError("invalid_spot_candle_query");
  const [base,quote]=pairSlug.split("-"),pair=`${base}/${quote}`,symbol=`${base}${quote}`;
  const body=await firstPublicJson([bybitUrl("https://api.bybit.com","/v5/market/kline",{category:"spot",symbol,interval:provider,limit:String(limit)}),bybitUrl("https://api.bytick.com","/v5/market/kline",{category:"spot",symbol,interval:provider,limit:String(limit)})]);
  if(body?.retCode!==0||body?.result?.category!=="spot"||body?.result?.symbol!==symbol||!Array.isArray(body?.result?.list))throw new Error("spot_candle_shape");
  const candles=body.result.list.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])}))
    .filter(r=>[r.time,r.open,r.high,r.low,r.close,r.volume].every(Number.isFinite)&&r.time>0&&Math.min(r.open,r.high,r.low,r.close)>0).sort((a,b)=>a.time-b.time);
  return{pair,interval,candles};
}

async function spotTickers(){
  const body=await firstPublicJson([bybitUrl("https://api.bybit.com","/v5/market/tickers",{category:"spot"}),bybitUrl("https://api.bytick.com","/v5/market/tickers",{category:"spot"})]);
  return{source:"bybit-edge",tickers:bybitTickerRows("spot",body).map(r=>({pair:r.pair,lastPrice:String(r.lastPrice),bidPrice:r.bidPrice==null?"":String(r.bidPrice),askPrice:r.askPrice==null?"":String(r.askPrice),
    high24h:r.high24h==null?"":String(r.high24h),low24h:r.low24h==null?"":String(r.low24h),volume24h:r.volume24h==null?"":String(r.volume24h),quoteVolume24h:r.quoteVolume24h==null?"":String(r.quoteVolume24h),
    changePercent24h:r.changePercent24h==null?"":String(r.changePercent24h)}))};
}

async function cfdTickers(){
  const url=new URL("https://biquote.io/api/latest");for(const p of Object.values(CFD_SYMBOLS))url.searchParams.append("symbols",p);
  const raw=await publicJson(url.toString()),now=Date.now(),tickers=[];
  for(const [symbol,providerSymbol] of Object.entries(CFD_SYMBOLS)){const row=raw?.[providerSymbol],price=Number(row?.mid),at=typeof row?.timestamp==="string"?Date.parse(row.timestamp):NaN;
    tickers.push({symbol,name:symbol,price:Number.isFinite(price)&&price>0?String(price):null,changePercent24h:Number.isFinite(Number(row?.dayDiffPercent))?String(row.dayDiffPercent):undefined,
      status:Number.isFinite(price)&&price>0?(row?.marketState==="closed"?"market_closed":row?.stale===true?"stale":"sampled"):"unavailable",stale:row?.stale===true,marketClosed:row?.marketState==="closed",
      displayOnly:true,executionAllowed:false,provider:"biquote",providerSymbol,providerTimestamp:Number.isFinite(at)?at:null,fetchedAt:now,asOf:Number.isFinite(at)?at:now,maxQuoteAgeMs:120000});}
  return{source:"biquote-edge",configured:true,tickers};
}
async function cfdCandles(symbol,searchParams){
  const provider=CFD_SYMBOLS[symbol],interval=searchParams.get("interval")||"15m",limit=Math.max(20,Math.min(500,Number(searchParams.get("limit")||"240")));
  if(!provider||!CFD_INTERVALS.has(interval)||!Number.isSafeInteger(limit))throw new RangeError("invalid_cfd_candle_request");
  const url=new URL(`https://biquote.io/api/${encodeURIComponent(provider)}/ohlc`);url.searchParams.set("interval",interval);url.searchParams.set("limit",String(limit));
  const raw=await publicJson(url.toString());if(!raw||raw.symbol!==provider||raw.interval!==interval||!Array.isArray(raw.bars))throw new Error("cfd_candle_shape");
  return{...raw,symbol,fetchedAt:Date.now()};
}

async function cachedPublic(request, loader) {async function cachedPublic(request, loader) {
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
        const spotBookMatch=url.pathname.match(/^\/market\/display\/spot-book\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const spotTradesMatch=url.pathname.match(/^\/market\/display\/spot-trades\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const spotCandlesMatch=url.pathname.match(/^\/market\/display\/spot-candles\/([A-Z0-9]{1,32}-[A-Z0-9]{2,12})$/);
        const cfdCandlesMatch=url.pathname.match(/^\/cfd\/display\/candles\/([A-Z0-9]{3,12})$/);

        if(url.pathname==="/market/display"){response=await cachedPublic(request,publicMarketSnapshot);}
        else if(url.pathname==="/market/display/spot-tickers"){response=await cachedPublic(request,spotTickers);}
        else if(spotBookMatch){response=await cachedPublic(request,()=>spotBook(spotBookMatch[1]));}
        else if(spotTradesMatch){response=await cachedPublic(request,()=>spotTrades(spotTradesMatch[1]));}
        else if(spotCandlesMatch){response=await cachedPublic(request,()=>spotCandles(spotCandlesMatch[1],url.searchParams));}
        else if(url.pathname==="/cfd/display/tickers"){response=await cachedPublic(request,cfdTickers);}
        else if(cfdCandlesMatch){response=await cachedPublic(request,()=>cfdCandles(cfdCandlesMatch[1],url.searchParams));}
        else if (book) {
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
