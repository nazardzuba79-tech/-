import assert from "node:assert/strict";
import worker from "./src/index.js";

const makeBook = () => Array.from({ length: 50 }, (_, i) => [String(100 - i / 100), String(i + 1)]);
const makeAsks = () => Array.from({ length: 50 }, (_, i) => [String(101 + i / 100), String(i + 1)]);
const renderBook = () => ({
  available: true,
  symbol: "BTCUSDT",
  source: "bybit",
  fetchedAt: 1790150000000,
  providerTime: 1790150000000,
  stale: false,
  updateId: 54321,
  bids: makeBook().map(([price, quantity]) => ({ price, quantity })),
  asks: makeAsks().map(([price, quantity]) => ({ price, quantity })),
});

async function run() {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  delete globalThis.caches;

  try {
    let providerCalls = 0;
    const providerUrls = [];
    globalThis.fetch = async (url, options = {}) => {
      providerCalls += 1;
      providerUrls.push(String(url));
      assert.equal(options.headers?.authorization, undefined);
      assert.equal(options.headers?.cookie, undefined);
      const u = new URL(url);
      assert.ok(["api.bybit.com", "api.bytick.com"].includes(u.hostname));
      if (u.pathname.includes("orderbook")) {
        return new Response(JSON.stringify({
          retCode: 0,
          time: 1790150000000,
          result: { s: "BTCUSDT", u: 12345, b: makeBook(), a: makeAsks() },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.pathname.includes("recent-trade")) {
        return new Response(JSON.stringify({
          retCode: 0,
          result: {
            category: "linear",
            list: [{ symbol: "BTCUSDT", execId: "t1", price: "100.5", size: "0.25", time: "1790150000123", side: "Buy" }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.pathname.includes("tickers")) {
        return new Response(JSON.stringify({
          retCode: 0,
          time: 1790150000200,
          result: { category: "linear", list: [{ symbol: "BTCUSDT", lastPrice: "100.5", price24hPcnt: "0.0123" }] },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.pathname.includes("kline")) {
        return new Response(JSON.stringify({
          retCode: 0,
          time: 1790150000300,
          result: { category: "linear", symbol: "BTCUSDT", list: [["1790146800000","100","102","99","101","1234"]] },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("unexpected provider request");
    };

    const health = await worker.fetch(new Request("https://market.voltextech.net/health"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "voltex-market-edge", version: "futures-edge-v4" });

    const book = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT", {
      headers: { authorization: "Bearer must-not-forward", cookie: "session=must-not-forward" },
    }));
    assert.equal(book.status, 200);
    const body = await book.json();
    assert.equal(body.available, true);
    assert.equal(body.symbol, "BTCUSDT");
    assert.equal(body.bids.length, 25);
    assert.equal(body.asks.length, 25);
    assert.equal(body.updateId, 12345);

    const trades = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT"));
    assert.equal(trades.status, 200);
    assert.deepEqual((await trades.json()).trades[0], {
      id: "t1", price: "100.5", quantity: "0.25", time: 1790150000123, side: "BUY",
    });

    const tickers = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-tickers"));
    assert.equal(tickers.status, 200);
    assert.equal((await tickers.json()).result.list[0].symbol, "BTCUSDT");

    const candles = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-candles/BTCUSDT?interval=60&limit=320"));
    assert.equal(candles.status, 200);
    assert.equal((await candles.json()).result.symbol, "BTCUSDT");

    assert.equal(providerCalls, 4);
    assert.ok(providerUrls.every((url) => !url.includes("onrender.com")));

    // A venue may reject a Cloudflare egress location. Book/trade fallback is
    // still public-only and never forwards browser auth/cookies to Render.
    const fallbackUrls = [];
    globalThis.fetch = async (url, options = {}) => {
      fallbackUrls.push(String(url));
      assert.equal(options.headers?.authorization, undefined);
      assert.equal(options.headers?.cookie, undefined);
      const u = new URL(url);
      if (u.hostname === "api.bybit.com" || u.hostname === "api.bytick.com") {
        return new Response("forbidden", { status: 403 });
      }
      if (u.hostname === "voltex-api.onrender.com" && u.pathname.endsWith("/market/display/futures-book/BTCUSDT")) {
        return new Response(JSON.stringify(renderBook()), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.hostname === "voltex-api.onrender.com" && u.pathname.endsWith("/market/display/futures-trades/BTCUSDT")) {
        return new Response(JSON.stringify({
          symbol: "BTCUSDT",
          trades: [{ id: "rt1", price: "100.4", quantity: "0.2", time: 1790150000456, side: "SELL" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fallback request ${url}`);
    };

    const fallbackBook = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT?fallback-test=1"));
    assert.equal(fallbackBook.status, 200);
    const fallbackBody = await fallbackBook.json();
    assert.equal(fallbackBody.symbol, "BTCUSDT");
    assert.equal(fallbackBody.bids.length, 25);
    assert.equal(fallbackBody.asks.length, 25);
    assert.equal(fallbackBody.updateId, 54321);

    const fallbackTrades = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT?fallback-test=1"));
    assert.equal(fallbackTrades.status, 200);
    assert.equal((await fallbackTrades.json()).trades[0].id, "rt1");
    assert.ok(fallbackUrls.some((url) => url.startsWith("https://voltex-api.onrender.com/")));
    assert.ok(fallbackUrls.every((url) => !url.includes("api.voltextech.net")));

    const badMethod = await worker.fetch(new Request("https://market.voltextech.net/health", { method: "POST" }));
    assert.equal(badMethod.status, 405);
    const badPath = await worker.fetch(new Request("https://market.voltextech.net/private/orders"));
    assert.equal(badPath.status, 404);

    console.log("market-edge worker tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches !== undefined) globalThis.caches = originalCaches;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
