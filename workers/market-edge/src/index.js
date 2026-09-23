// VOLTEX market edge — public market data only.
// NO trading commands, NO cookies, NO Authorization, NO balances/orders/positions, NO Neon.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET, OPTIONS" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers });
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "voltex-market-edge" }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers });
  },
};
