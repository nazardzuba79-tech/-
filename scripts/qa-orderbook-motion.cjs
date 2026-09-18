/**
 * Order-book MOTION harness: measures how much the ladder churns, on a feed
 * that is byte-identical between runs.
 *
 * Why this exists. "The book jumps and flickers" is not something a
 * screenshot can prove or disprove, and a live venue never replays the same
 * sequence twice, so a before/after against Bybit would compare two
 * different markets. This process serves the REAL built frontend and points
 * venue socket URLs at a LOCAL WebSocket that replays a fully pre-generated,
 * seeded frame list. Same seed in, same frames out, every run — so a
 * before/after difference is the code's, not the market's.
 *
 * The one substitution is the socket URL, exactly as serve-terminal-book-review
 * does it. Every other byte of the page is the real build.
 *
 * What it measures, via a MutationObserver over the ladder:
 *   rowsAdded / rowsRemoved  price rows React unmounted and remounted. This
 *                            is the flicker: a remounted row loses its
 *                            transition and repaints from scratch.
 *   textChanges              number cells whose text was rewritten.
 *   depthStyleWrites         depth-bar transform writes — how many bars are
 *                            re-scaled per update.
 *   heightSamples            panel and row-count stability; a changing row
 *                            count is a layout jump.
 *
 * Usage:
 *   node scripts/qa-orderbook-motion.cjs --label before --out docs/qa/orderbook
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const HTTP_PORT = Number(process.env.QA_PORT || 4320);
const WS_PORT = HTTP_PORT + 1;
const SEED = Number(process.env.QA_SEED || 20260918);
const SYMBOL = 'BTCUSDT';
const TICK = 0.1;
const START_MID = 77260.4;
/** Frames are pushed at this cadence; a busy perpetual is around here. */
const FRAME_MS = 100;
const FRAME_COUNT = 400; // 40s of feed, more than the measurement window

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i === -1 ? fallback : args[i + 1]; };
const LABEL = arg('label', 'run');
const OUT = path.resolve(arg('out', path.join(__dirname, '../docs/qa/orderbook')));
const WINDOW_MS = Number(arg('window', 15000));
/** The store subscribes to NAMED events (snapshot|delta|state), not the default `message`. */
const EVENT_NAME = 'snapshot';

/** Seeded PRNG — the whole point of this harness is that this is the only
 *  source of randomness and it starts from a fixed seed. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (v) => (Math.round(v / TICK) * TICK).toFixed(1);
const qty = (r) => (0.001 + r * 6).toFixed(3);

/**
 * The ENTIRE sequence, generated once, before any client connects. Two runs
 * of this file replay the same array; nothing is computed at send time.
 */
function buildSequence() {
  const rnd = mulberry32(SEED);
  let mid = START_MID;
  const bidMap = new Map(), askMap = new Map();
  for (let i = 0; i < 200; i++) {
    bidMap.set(round(mid - TICK * (i + 1)), qty(rnd()));
    askMap.set(round(mid + TICK * (i + 1)), qty(rnd()));
  }
  const frames = [{ type: 'snapshot', b: [...bidMap], a: [...askMap] }];
  for (let f = 0; f < FRAME_COUNT; f++) {
    // A drifting mid is the case that actually shifts the ladder, and so the
    // case that makes React replace rows. A feed that only rewrites sizes at
    // a fixed mid would hide the very thing being measured.
    mid += (rnd() - 0.5) * TICK * 6;
    const b = [], a = [];
    // A REAL delta removes the levels the move consumed, by sending size 0.
    // Without this the book accumulates bids above its own best ask, the
    // client's own crossed-book guard throws DepthDesyncError, and the panel
    // goes stale — a fault of the fixture, not of the product.
    for (const price of [...bidMap.keys()]) if (Number(price) >= mid) { bidMap.delete(price); b.push([price, '0']); }
    for (const price of [...askMap.keys()]) if (Number(price) <= mid) { askMap.delete(price); a.push([price, '0']); }
    for (let i = 0; i < 8; i++) {
      const bp = round(mid - TICK * (i + 1));
      if (Number(bp) < mid) { const q = qty(rnd()); bidMap.set(bp, q); b.push([bp, q]); }
      const ap = round(mid + TICK * (i + 1));
      if (Number(ap) > mid) { const q = qty(rnd()); askMap.set(ap, q); a.push([ap, q]); }
    }
    frames.push({ type: 'delta', b, a, trade: { p: round(mid), v: qty(rnd()), side: rnd() > 0.5 ? 'Buy' : 'Sell' } });
  }
  return frames;
}
const SEQUENCE = buildSequence();

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
wss.on('connection', (socket) => {
  const topics = new Set();
  let cursor = 0, u = 1, timer = null;
  const send = (obj) => { if (socket.readyState === 1) socket.send(JSON.stringify(obj)); };
  socket.on('message', (raw) => {
    let frame; try { frame = JSON.parse(String(raw)); } catch { return; }
    if (frame.op === 'ping') { send({ op: 'pong', success: true }); return; }
    if (frame.op !== 'subscribe') { for (const t of frame.args || []) topics.delete(t); return; }
    for (const topic of frame.args || []) topics.add(topic);
    const depth = [...topics].find((t) => /^orderbook\.\d+\.(.+)$/.test(t));
    if (!depth || timer) return;
    const snap = SEQUENCE[0];
    u += 1;
    send({ topic: depth, type: 'snapshot', ts: Date.now(), data: { s: SYMBOL, b: snap.b, a: snap.a, u, seq: u } });
    cursor = 1;
    timer = setInterval(() => {
      const frameData = SEQUENCE[cursor];
      if (!frameData) return;
      cursor += 1;
      u += 1;
      send({ topic: depth, type: 'delta', ts: Date.now(), data: { s: SYMBOL, b: frameData.b, a: frameData.a, u, seq: u } });
      send({ topic: `publicTrade.${SYMBOL}`, data: [{ s: SYMBOL, i: `t${u}`, S: frameData.trade.side, p: frameData.trade.p, v: frameData.trade.v, T: Date.now() }] });
    }, FRAME_MS);
  });
  socket.on('close', () => { if (timer) clearInterval(timer); });
});

const app = express();
app.use(express.json());
const PAIRS = ['BTC/USDT'];
const restBook = () => {
  const snap = SEQUENCE[0];
  return { bids: snap.b.map(([price, quantity]) => ({ price, quantity })), asks: snap.a.map(([price, quantity]) => ({ price, quantity })) };
};
app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/futures/config', (_q, r) => r.json({ symbols: PAIRS, minLeverage: 1, maxLeverage: 100, leverageStep: 1, fundingIntervalHours: 8, highLeverageWarningThreshold: 25, leverageTiers: [{ notionalCap: null, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 0 }] }));
app.get('/api/v1/market/universe', (_q, r) => r.json({ available: true, value: { instruments: PAIRS.map((pair) => ({ symbol: pair, providerSymbol: pair.replace('/', ''), marketType: 'linear_perpetual', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT', status: 'Trading', fundingIntervalMinutes: 480 })) } }));
app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ tickers: PAIRS.map((pair) => ({ pair, lastPrice: START_MID, high24h: START_MID * 1.02, low24h: START_MID * 0.98, changePercent: 1.18, quoteVolume24h: 1.2e9, volume24h: 15000 })) }));
app.get('/api/v1/market/futures/orderbook/:symbol', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, symbol: SYMBOL, updateId: 1, providerTime: Date.now(), ...restBook() }));
app.get('/api/v1/futures/mark-price/:symbol', (_q, r) => r.json({ symbol: SYMBOL, markPrice: String(START_MID * 1.00004), indexPrice: String(START_MID) }));
app.get('/api/v1/futures/funding-rate/:symbol', (_q, r) => r.json({ history: [{ rate: '0.0001', markPrice: '1', indexPrice: '1', appliedAt: new Date().toISOString() }] }));
app.get('/api/v1/market/derivatives/:asset', (_q, r) => r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: { turnover24hUsd: 1.2e9, openInterestBase: 12345.5, openInterestUsd: 9.2e8 } }));
app.get('/api/v1/market/external/symbols', (_q, r) => r.json({ symbols: PAIRS }));
/** The book as of `elapsed` ms into the sequence — same frames the socket replays. */
let spotStartedAt = null;
function bookAt(elapsedMs) {
  const bids = new Map(SEQUENCE[0].b), asks = new Map(SEQUENCE[0].a);
  const upto = Math.min(SEQUENCE.length - 1, Math.floor(elapsedMs / FRAME_MS));
  for (let i = 1; i <= upto; i++) {
    for (const [p, q] of SEQUENCE[i].b) { if (q === '0') bids.delete(p); else bids.set(p, q); }
    for (const [p, q] of SEQUENCE[i].a) { if (q === '0') asks.delete(p); else asks.set(p, q); }
  }
  const sortNum = (dir) => (a, b) => (Number(a[0]) - Number(b[0])) * dir;
  return { bids: [...bids].sort(sortNum(-1)).slice(0, 50).map(([price, quantity]) => ({ price, quantity })),
           asks: [...asks].sort(sortNum(1)).slice(0, 50).map(([price, quantity]) => ({ price, quantity })) };
}
app.get('/api/v1/market/external/orderbook/:pair', (_q, r) => {
  if (spotStartedAt === null) spotStartedAt = Date.now();
  r.json({ source: 'qa', pair: 'BTC/USDT', ...bookAt(Date.now() - spotStartedAt) });
});
app.get('/api/v1/market/external/trades/:pair', (_q, r) => r.json({ source: 'qa', pair: 'BTC/USDT', trades: Array.from({ length: 30 }, (_, i) => ({ id: `qa-${i}`, price: round(START_MID), quantity: '0.125', side: i % 2 ? 'BUY' : 'SELL', time: Date.now() - i * 900 })) }));
app.get('/api/v1/market/external/tickers/:pair', (_q, r) => r.json({ source: 'qa', ticker: { pair: 'BTC/USDT', lastPrice: START_MID, high24h: START_MID * 1.02, low24h: START_MID * 0.98, changePercent: 1.18, quoteVolume24h: 1.2e9, volume24h: 15000 } }));
/** The shared reference stream (SSE). One live BTC/USDT row that passes
 *  futuresReferenceRows' identity filter, carrying the MARK PRICE, so the
 *  centre's mark slot is exercised by the same fixture. */
app.get('/api/v1/market/live', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const now = Date.now();
  const row = { id: 'linear_perpetual:BTCUSDT', pair: 'BTC/USDT', symbol: 'BTC/USDT', providerSymbol: 'BTCUSDT', provider: 'bybit',
    marketType: 'linear_perpetual', baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT',
    lastPrice: START_MID, bidPrice: START_MID - TICK, askPrice: START_MID + TICK, high24h: START_MID * 1.02, low24h: START_MID * 0.98,
    volume24h: 15000, quoteVolume24h: 1.2e9, changePercent24h: 1.18, indexPrice: START_MID, markPrice: START_MID * 1.00004,
    fundingRate: 0.0001, fundingIntervalMinutes: 480, openInterest: 12345.5, openInterestValue: 9.2e8,
    providerEventAt: now, sequence: 1, receivedAt: now, fetchedAt: now, stale: false };
  const frame = { version: 1, type: 'snapshot', status: 'live', rows: [row], revision: 1, epoch: 'qa' };
  const write = () => res.write((EVENT_NAME === 'message' ? '' : `event: ${EVENT_NAME}\n`) + `data: ${JSON.stringify(frame)}\n\n`);
  write();
  const keep = setInterval(() => res.write(': keep-alive\n\n'), 5000);
  req.on('close', () => clearInterval(keep));
});
/** The shared spot snapshot the market-data store polls. Without it the Spot
 *  centre has no last traded price and correctly falls back to the mid — so
 *  the fixture must serve it for the last+arrow path to be exercised at all. */
app.get('/api/v1/market/snapshot', (_q, r) => {
  const section = (value) => ({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value });
  // A last price that MOVES, so the direction arrow has something to report.
  const drift = Math.floor((Date.now() / 1000) % 4) - 2;
  r.json({
    tickers: section([{ pair: 'BTC/USDT', lastPrice: START_MID + drift, high24h: START_MID * 1.02, low24h: START_MID * 0.98,
      changePercent: 1.18, quoteVolume24h: 1.2e9, volume24h: 15000 }]),
    overview: { available: false, source: 'qa', fetchedAt: Date.now(), stale: false, value: null },
    sentiment: { available: false, source: 'qa', fetchedAt: Date.now(), stale: false, value: null },
  });
});
app.get('/api/v1/*', (_q, r) => r.json([]));

const dist = path.join(__dirname, '../frontend/dist');
app.use(express.static(dist, { index: false }));
app.get('*', (_q, res) => res.type('html').send(fs.readFileSync(path.join(dist, 'index.html'), 'utf8').replace('<head>', `<head><script>
localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','ru');
(function(){
  const Native = window.WebSocket;
  window.WebSocket = function(url, protocols){
    const target = String(url).includes('stream.bybit.com') ? 'ws://127.0.0.1:${WS_PORT}' : url;
    return protocols === undefined ? new Native(target) : new Native(target, protocols);
  };
  window.WebSocket.prototype = Native.prototype;
  for (const k of ['CONNECTING','OPEN','CLOSING','CLOSED']) window.WebSocket[k] = Native[k];
})();
</script>`)));

const server = app.listen(HTTP_PORT, '127.0.0.1', async () => {
  console.log(`[motion] stand on ${HTTP_PORT}, seed ${SEED}, ${SEQUENCE.length} pre-generated frames`);
  try { await measure(); } catch (error) { console.error(error); process.exitCode = 1; }
  server.close(); wss.close(); process.exit(process.exitCode || 0);
});

async function measure() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  const targets = [
    ['futures-desktop', '/futures', { width: 1920, height: 1080 }, '.rb-body', '.rb-row', '.rb-depth'],
    ['futures-mobile',  '/futures', { width: 390, height: 844 },   '.rb-body', '.rb-row', '.rb-depth'],
    ['spot-desktop',    '/trade',   { width: 1920, height: 1080 }, '.orderbook-area', '.ob-row', '.ob-depth-bar'],
  ];
  for (const [device, route, viewport, bodySel, rowSel, barSel] of targets) {
    const page = await browser.newPage({ viewport });
    await page.goto(`http://127.0.0.1:${HTTP_PORT}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(rowSel, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000); // let the snapshot settle before counting

    await page.evaluate(([bodySel, rowClass, barClass]) => {
      const target = document.querySelector(bodySel);
      const stats = { rowsAdded: 0, rowsRemoved: 0, textChanges: 0, depthStyleWrites: 0, otherAttr: 0, flashClassWrites: 0 };
      window.__motion = stats;
      if (!target) return;
      const isRow = (n) => n.nodeType === 1 && n.classList && n.classList.contains(rowClass);
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'childList') {
            r.addedNodes.forEach((n) => { if (isRow(n)) stats.rowsAdded++; });
            r.removedNodes.forEach((n) => { if (isRow(n)) stats.rowsRemoved++; });
          } else if (r.type === 'characterData') stats.textChanges++;
          else if (r.type === 'attributes') {
            if (r.target.classList && r.target.classList.contains(barClass)) stats.depthStyleWrites++;
            else if (r.attributeName === 'class' && isRow(r.target)) stats.flashClassWrites++; // a row pulsing on/off
            else stats.otherAttr++;
          }
        }
      });
      observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
      window.__motionStop = () => observer.disconnect();
      // Layout stability: sample the rendered row count and panel height.
      window.__layout = [];
      window.__layoutTimer = setInterval(() => {
        const body = document.querySelector(bodySel);
        window.__layout.push({ rows: document.querySelectorAll('.' + rowClass).length, h: Math.round(body ? body.getBoundingClientRect().height : 0) });
      }, 250);
    }, [bodySel, rowSel.slice(1), barSel.slice(1)]);

    const shots = [];
    const started = Date.now();
    let shotIndex = 0;
    while (Date.now() - started < WINDOW_MS) {
      await page.waitForTimeout(WINDOW_MS / 5);
      if (device.endsWith('desktop') && shotIndex < 3) {
        const book = await page.$(route === '/trade' ? '.orderbook-area' : '.reference-book');
        const file = path.join(OUT, `${LABEL}-${device}-${shotIndex}.png`);
        if (book) await book.screenshot({ path: file });
        shots.push(file);
        shotIndex++;
      }
    }

    const data = await page.evaluate(() => {
      window.__motionStop?.(); clearInterval(window.__layoutTimer);
      const rows = window.__layout.map((s) => s.rows), hs = window.__layout.map((s) => s.h);
      return { ...window.__motion, samples: window.__layout.length,
        rowCounts: [...new Set(rows)].sort((a, b) => a - b), heights: [...new Set(hs)].sort((a, b) => a - b) };
    });
    results[device] = { ...data, shots };
    await page.close();
  }
  await browser.close();

  const seconds = WINDOW_MS / 1000;
  const report = { label: LABEL, seed: SEED, frameMs: FRAME_MS, windowMs: WINDOW_MS, results };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`\n===== ${LABEL} (seed ${SEED}, ${seconds}s window, one frame every ${FRAME_MS}ms) =====`);
  for (const [device, r] of Object.entries(results)) {
    console.log(`\n  ${device}`);
    console.log(`    rows remounted      ${String(r.rowsAdded).padStart(6)} added / ${String(r.rowsRemoved).padStart(6)} removed   (${(r.rowsAdded / seconds).toFixed(1)}/s)`);
    console.log(`    text rewrites       ${String(r.textChanges).padStart(6)}   (${(r.textChanges / seconds).toFixed(1)}/s)`);
    console.log(`    depth bar writes    ${String(r.depthStyleWrites).padStart(6)}   (${(r.depthStyleWrites / seconds).toFixed(1)}/s)`);
    console.log(`    row flash toggles   ${String(r.flashClassWrites).padStart(6)}   (class writes on a row: a pulse on/off)`);
    console.log(`    other attr writes   ${String(r.otherAttr).padStart(6)}`);
    console.log(`    row counts seen     ${JSON.stringify(r.rowCounts)}   (one value = no layout jump)`);
    console.log(`    body heights seen   ${JSON.stringify(r.heights)}`);
  }
  console.log(`\n  report: ${path.join(OUT, LABEL + '.json')}`);
}
