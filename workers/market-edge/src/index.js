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

  const bids = normalizeBookRows(body.result.b);
  const asks = normalizeBookRows(body.result.a);
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error("provider_book");

  const providerTime = Number(body.time);
  const updateId = Number(body.result.u);
  if (!Number.isSafeInteger(updateId) || updateId < 1) throw new Error("provider_update");

  return {
    available: true,
    symbol,
    source: "bybit",
    fetchedAt: Date.now(),
    providerTime: Number.isFinite(providerTime) && providerTime > 0 ? providerTime : Date.now(),
    stale: false,
    updateId,
    bids,
    asks,
  };
}

async function futuresTrades(symbol) {
  const body = await firstPublicJson([
    bybitUrl("https://api.bybit.com", "/v5/market/recent-trade", { category: "linear", symbol, limit: "30" }),
    bybitUrl("https://api.bytick.com", "/v5/market/recent-trade", { category: "linear", symbol, limit: "30" }),
  ]);

  if (body?.retCode !== 0 || body?.result?.category !== "linear" || !Array.isArray(body?.result?.list)) {
    throw new Error("provider_trade_shape");
  }

  const seen = new Set();
  const trades = body.result.list.map((row) => {
    if (row?.symbol !== symbol || !["Buy", "Sell"].includes(row.side)
      || typeof row.execId !== "string" || !row.execId || seen.has(row.execId)
      || !validPositiveDecimal(row.price) || !validPositiveDecimal(row.size)
      || !Number.isSafeInteger(Number(row.time)) || Number(row.time) <= 0) {
      throw new Error("provider_trade_identity");
    }
    seen.add(row.execId);
    return {
      id: row.execId,
      price: row.price,
      quantity: row.size,
      time: Number(row.time),
      side: row.side === "Buy" ? "BUY" : "SELL",
    };
  }).slice(0, 30).sort((a, b) => b.time - a.time);

  return { symbol, trades };
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
        response = json({ ok: true, service: "voltex-market-edge", version: "futures-edge-direct-v3" }, 200, { "cache-control": "no-store" });
      } else {
        const book = url.pathname.match(/^\/market\/display\/futures-book\/([A-Z0-9]{1,28}USDT)$/);
        const trades = url.pathname.match(/^\/market\/display\/futures-trades\/([A-Z0-9]{1,28}USDT)$/);

        if (book) {
          const symbol = book[1];
          if (!SYMBOL_RE.test(symbol)) return json({ error: "symbol_not_listed" }, 404);
          response = await cachedPublic(request, () => futuresBook(symbol));
        } else if (trades) {
          const symbol = trades[1];
          if (!SYMBOL_RE.test(symbol)) return json({ error: "symbol_not_listed" }, 404);
          response = await cachedPublic(request, () => futuresTrades(symbol));
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
