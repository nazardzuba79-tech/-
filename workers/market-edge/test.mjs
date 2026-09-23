import assert from "node:assert/strict";
import worker from "./src/index.js";

const makeBook = () => Array.from({ length: 50 }, (_, i) => [String(100 - i / 100), String(i + 1)]);
const makeAsks = () => Array.from({ length: 50 }, (_, i) => [String(101 + i / 100), String(i + 1)]);

async function run() {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  delete globalThis.caches;

  try {
    let providerCalls = 0;
    globalThis.fetch = async (url, options = {}) => {
      providerCalls += 1;
      assert.equal(options.headers?.authorization, undefined);
      assert.equal(options.headers?.cookie, undefined);
      const u = new URL(url);
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
      throw new Error("unexpected provider request");
    };

    const health = await worker.fetch(new Request("https://market.voltextech.net/health"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "voltex-market-edge" });

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
    assert.equal(body.bids[0].price, "100");
    assert.equal(body.asks[0].price, "101");

    const trades = await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT"));
    assert.equal(trades.status, 200);
    assert.deepEqual((await trades.json()).trades[0], {
      id: "t1", price: "100.5", quantity: "0.25", time: 1790150000123, side: "BUY",
    });

    const badMethod = await worker.fetch(new Request("https://market.voltextech.net/health", { method: "POST" }));
    assert.equal(badMethod.status, 405);

    const badPath = await worker.fetch(new Request("https://market.voltextech.net/private/orders"));
    assert.equal(badPath.status, 404);

    assert.equal(providerCalls, 2);
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
