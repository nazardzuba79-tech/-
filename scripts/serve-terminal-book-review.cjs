/**
 * Isolated review stand for the terminal's order book, inputs and header.
 *
 * Nothing here talks to a live venue. The depth feed is a LOCAL WebSocket
 * speaking Bybit's v5 public frame shape, which is what lets this stand
 * exercise the things a live connection cannot be asked to do on demand:
 * drop the connection mid-session, stamp frames from a clock that
 * disagrees with the browser's, go silent, refuse to open at all.
 *
 * The substitution is a single line in the page shell — WebSocket URLs for
 * stream.bybit.com are pointed at this process — and it is stated plainly
 * in the report so a fixture run is never mistaken for a live-provider one.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const HTTP_PORT = Number(process.env.QA_PORT || 4310);
const WS_PORT = HTTP_PORT + 1;

/** Real-shape depth, generated deterministically around a mid. */
const MIDS = { BTCUSDT: 75000, ETHUSDT: 2400, SOLUSDT: 148.25, XRPUSDT: 1.29, DOGEUSDT: 0.003378 };
const TICK = { BTCUSDT: 0.1, ETHUSDT: 0.01, SOLUSDT: 0.01, XRPUSDT: 0.0001, DOGEUSDT: 0.000001 };
const round = (v, step) => (Math.round(v / step) * step).toFixed(Math.max(0, -Math.floor(Math.log10(step))));

function snapshot(symbol, drift = 0) {
  const mid = MIDS[symbol] * (1 + drift), step = TICK[symbol];
  const b = [], a = [];
  for (let i = 0; i < 200; i++) {
    b.push([round(mid - step * (i + 1) * 5, step), (0.5 + (i % 7) * 0.31).toFixed(3)]);
    a.push([round(mid + step * (i + 1) * 5, step), (0.4 + (i % 5) * 0.27).toFixed(3)]);
  }
  return { b, a };
}

// ---- control surface, so the browser script can drive the feed ----
const state = {
  refuseSockets: false,   // simulate a network that blocks WebSockets entirely
  silent: false,          // socket open, no frames
  clockSkewMs: 0,         // stamp frames from a clock the browser disagrees with
  sockets: 0,             // how many sockets this process has accepted
  restCalls: 0,           // how many fallback book requests arrived
  restBySymbol: {},
};

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
wss.on('connection', (socket) => {
  if (state.refuseSockets) { socket.close(); return; }
  state.sockets += 1;
  const topics = new Set();
  let u = 1;
  socket.on('message', (raw) => {
    let frame; try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame.op === 'ping') { socket.send(JSON.stringify({ op: 'pong', success: true })); return; }
    for (const topic of frame.args || []) {
      if (frame.op === 'subscribe') topics.add(topic); else topics.delete(topic);
    }
    if (frame.op !== 'subscribe') return;
    for (const topic of frame.args || []) {
      const m = /^orderbook\.200\.(.+)$/.exec(topic);
      if (!m || !MIDS[m[1]]) continue;
      const { b, a } = snapshot(m[1]);
      u += 1;
      socket.send(JSON.stringify({ topic, type: 'snapshot', ts: Date.now() + state.clockSkewMs, data: { s: m[1], b, a, u, seq: u } }));
    }
  });
  const timer = setInterval(() => {
    if (state.silent || socket.readyState !== 1) return;
    for (const topic of topics) {
      const m = /^orderbook\.200\.(.+)$/.exec(topic);
      if (!m || !MIDS[m[1]]) continue;
      const symbol = m[1], step = TICK[symbol];
      u += 1;
      // A handful of levels change, as a real delta does.
      const b = [], mid = MIDS[symbol];
      for (let i = 0; i < 6; i++) b.push([round(mid - step * (i + 1) * 5, step), (0.4 + Math.random()).toFixed(3)]);
      socket.send(JSON.stringify({ topic, type: 'delta', ts: Date.now() + state.clockSkewMs, data: { s: symbol, b, a: [], u, seq: u } }));
      const trade = `t${u}`;
      socket.send(JSON.stringify({ topic: `publicTrade.${symbol}`, data: [
        { s: symbol, i: trade, S: u % 2 ? 'Buy' : 'Sell', p: round(mid, step), v: '0.125', T: Date.now() + state.clockSkewMs }] }));
    }
  }, 250);
  socket.on('close', () => clearInterval(timer));
});

const app = express();
app.use(express.json());
let report = null;
const requests = {};
app.use((req, _res, next) => { requests[req.path.replace(/\/[A-Z0-9]+$/, '/:symbol')] = (requests[req.path.replace(/\/[A-Z0-9]+$/, '/:symbol')] || 0) + 1; next(); });

app.post('/__qa/report', (req, res) => { report = req.body; res.sendStatus(204); });
app.get('/__qa/report', (_req, res) => res.json({ browser: report, requests, ...state }));
app.post('/__qa/control', (req, res) => { Object.assign(state, req.body); res.json(state); });
app.post('/__qa/drop', (_req, res) => { for (const c of wss.clients) c.terminate(); res.json({ dropped: true }); });
app.post('/__qa/reset-counters', (_req, res) => { state.sockets = 0; state.restCalls = 0; state.restBySymbol = {}; for (const k of Object.keys(requests)) delete requests[k]; res.json(state); });

// The fallback book, in the shape the real route answers with.
app.get('/api/v1/market/futures/orderbook/:symbol', (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  state.restCalls += 1;
  state.restBySymbol[symbol] = (state.restBySymbol[symbol] || 0) + 1;
  if (!MIDS[symbol]) return res.json({ available: false, reason: 'symbol_not_listed' });
  const { b, a } = snapshot(symbol);
  res.json({ available: true, source: 'bybit', fetchedAt: Date.now(), stale: false, symbol,
    updateId: 1000 + state.restCalls, providerTime: Date.now(),
    bids: b.map(([price, quantity]) => ({ price, quantity })),
    asks: a.map(([price, quantity]) => ({ price, quantity })) });
});

const SYMBOLS = Object.keys(MIDS).map((s) => s.replace('USDT', '/USDT'));
app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa', displayName: 'Local QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/futures/config', (_req, res) => res.json({
  symbols: SYMBOLS, minLeverage: 1, maxLeverage: 100, leverageStep: 1,
  fundingIntervalHours: 8, highLeverageWarningThreshold: 25,
  leverageTiers: [
    { notionalCap: 50_000, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 },
    { notionalCap: 250_000, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 250 },
    { notionalCap: null, maxLeverage: 20, maintenanceMarginRate: 0.025, maintenanceAmount: 4000 },
  ],
}));
app.get('/api/v1/market/universe', (_req, res) => res.json({ available: true, value: { instruments: SYMBOLS.map((pair) => ({
  symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'linear_perpetual',
  baseAsset: pair.split('/')[0], quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ tickers: SYMBOLS.map((pair) => {
  const mid = MIDS[pair.replace('/', '')];
  return { pair, lastPrice: mid, high24h: mid * 1.04, low24h: mid * 0.96, changePercent: 1.24, quoteVolume24h: 1.2e9, volume24h: 15000 };
}) }));
app.get('/api/v1/futures/mark-price/:symbol', (req, res) => {
  const mid = MIDS[String(req.params.symbol).replace('-', '').replace('/', '').toUpperCase()] ?? 1;
  res.json({ symbol: req.params.symbol, markPrice: String(mid * 1.0004), indexPrice: String(mid) });
});
app.get('/api/v1/futures/open-interest/:symbol', (_req, res) => res.json({ openInterest: '12345.5' }));
app.get('/api/v1/futures/funding-rate/:symbol', (_req, res) => res.json({ history: [{ rate: '0.0001', markPrice: '1', indexPrice: '1', appliedAt: new Date().toISOString() }] }));
app.get('/api/v1/market/derivatives/:asset', (_req, res) => res.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: { turnover24hUsd: 1.2e9, openInterestBase: 12345.5, openInterestUsd: 9.2e8 } }));
// Spot reads its book and tape over REST before its own socket connects.
app.get('/api/v1/market/external/orderbook/:pair', (req, res) => {
  const symbol = String(req.params.pair).toUpperCase().replace('-', '').replace('/', '');
  if (!MIDS[symbol]) return res.json({ source: 'qa', bids: [], asks: [] });
  const { b, a } = snapshot(symbol);
  res.json({ source: 'qa', pair: req.params.pair,
    bids: b.slice(0, 50).map(([price, quantity]) => ({ price, quantity })),
    asks: a.slice(0, 50).map(([price, quantity]) => ({ price, quantity })) });
});
app.get('/api/v1/market/external/trades/:pair', (req, res) => {
  const symbol = String(req.params.pair).toUpperCase().replace('-', '').replace('/', '');
  const mid = MIDS[symbol] ?? 1, step = TICK[symbol] ?? 0.01;
  res.json({ source: 'qa', pair: req.params.pair, trades: Array.from({ length: 30 }, (_, i) => ({
    id: `qa-${i}`, price: round(mid, step), quantity: '0.125', side: i % 2 ? 'BUY' : 'SELL', time: Date.now() - i * 900 })) });
});
app.get('/api/v1/market/external/tickers/:pair', (req, res) => {
  const symbol = String(req.params.pair).toUpperCase().replace('-', '').replace('/', '');
  const mid = MIDS[symbol] ?? 1;
  res.json({ source: 'qa', ticker: { pair: req.params.pair, lastPrice: mid, high24h: mid * 1.04, low24h: mid * 0.96, changePercent: 1.24, quoteVolume24h: 1.2e9, volume24h: 15000 } });
});
app.get('/api/v1/market/external/symbols', (_req, res) => res.json({ symbols: SYMBOLS }));
app.get('/api/v1/futures/positions', (_req, res) => res.json([]));
app.get('/api/v1/futures/orders/me', (_req, res) => res.json([]));
app.get('/api/v1/futures/balances', (_req, res) => res.json([]));
app.get('/api/v1/*', (_req, res) => res.json([]));

const dist = path.join(__dirname, '../frontend/dist');
app.use(express.static(dist, { index: false }));
app.get('*', (_req, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('<head>', `<head><script>
localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','ru');
// THE fixture substitution, and the only one: venue socket URLs are
// pointed at this process. Everything else on the page is the real build.
(function(){
  const Native = window.WebSocket;
  window.__qaSockets = 0;
  window.WebSocket = function(url, protocols){
    const target = String(url).includes('stream.bybit.com') ? 'ws://127.0.0.1:${WS_PORT}' : url;
    window.__qaSockets++;
    return protocols === undefined ? new Native(target) : new Native(target, protocols);
  };
  window.WebSocket.prototype = Native.prototype;
  for (const k of ['CONNECTING','OPEN','CLOSING','CLOSED']) window.WebSocket[k] = Native[k];
})();
window.__qaErrors = [];
window.addEventListener('error', e => window.__qaErrors.push(String(e.message)));
window.__qaFetches = [];
(function(){ const f = window.fetch; window.fetch = function(input, init){ window.__qaFetches.push(String(typeof input==='string'?input:input.url)); return f.call(this, input, init); }; })();
</script>`)));

const server = app.listen(HTTP_PORT, '127.0.0.1', () => console.log(`terminal book review http://127.0.0.1:${HTTP_PORT}/futures  (ws ${WS_PORT})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { wss.close(); server.closeAllConnections(); server.close(); process.exit(0); });
