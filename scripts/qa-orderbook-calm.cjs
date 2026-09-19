/**
 * Order-book CALM harness: measures the book the way the eye sees it —
 * in pixels per frame — on a feed that is byte-identical between runs.
 *
 * WHY A SECOND MOTION HARNESS. `qa-orderbook-motion.cjs` counts DOM work:
 * rows remounted, text rewritten, depth bars re-scaled. Those are the right
 * numbers for "is React tearing the ladder down", and it pinned that. They
 * are the WRONG numbers for "does this look calm", because a CSS transition
 * makes no DOM writes at all and yet keeps twenty bars sliding continuously
 * between updates. The ladder can be perfectly stable in the DOM and still
 * never hold still on screen.
 *
 * So this one records the panel and measures the frames.
 *
 * THE TARGET IS MEASURED, NOT GUESSED. The owner supplied a screen
 * recording of Binance Futures. Cropping its order book and diffing
 * consecutive frames gives, over a 2.0s window at 30fps:
 *
 *     repaints            5          (2.5 per second)
 *     mean gap            12.8 frames = 425 ms
 *     frames that moved   5 of 59
 *     every other frame   0.00% of pixels changed
 *     largest repaint     2.82% of pixels
 *
 * That is the whole character of a calm book: it changes two or three times
 * a second, and in between it is COMPLETELY still. Not "mostly still" —
 * bit-identical. Anything that animates between updates fails this whether
 * or not it is smooth, and a book that repaints thirty times a second fails
 * it even if each repaint is tiny.
 *
 * WHAT IS MEASURED HERE. The same crop, the same diff, the same threshold,
 * against a local replay of a pre-generated seeded feed — so a before/after
 * is the code's doing and not the market's.
 *
 *     node scripts/qa-orderbook-calm.cjs --label before
 *     node scripts/qa-orderbook-calm.cjs --label after
 *
 * The one substitution is the venue socket URL. Every other byte of the
 * page is the real production build.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { WebSocketServer } = require('ws');

const HTTP_PORT = Number(process.env.QA_PORT || 4360);
const WS_PORT = HTTP_PORT + 1;
const SEED = Number(process.env.QA_SEED || 20260919);
const SYMBOL = 'BTCUSDT';
const TICK = 0.1;
const START_MID = 81660.4;
/** A busy perpetual pushes deltas about this often. */
const FRAME_MS = 100;
const FRAME_COUNT = 400;

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i === -1 ? fallback : args[i + 1]; };
const LABEL = arg('label', 'run');
const OUT = path.resolve(arg('out', path.join(__dirname, '../docs/qa/orderbook-calm')));
const RECORD_MS = Number(arg('record', 6000));
/** Same threshold the Binance reference was measured with. */
const PIXEL_DELTA = 28;
/** Below this share of changed pixels a frame counts as "did not move". */
const MOVED_PCT = 0.05;

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
    mid += (rnd() - 0.5) * TICK * 6;
    const b = [], a = [];
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
      cursor += 1; u += 1;
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
  console.log(`[calm] stand on ${HTTP_PORT}, seed ${SEED}`);
  try { await measure(); } catch (error) { console.error(error); process.exitCode = 1; }
  server.close(); wss.close(); process.exit(process.exitCode || 0);
});

/**
 * Diff a directory of captured PNG frames over one region.
 *
 * WHY NOT A RECORDED VIDEO. The first version of this harness recorded with
 * Playwright's `recordVideo` and diffed the webm. A control run over a
 * deliberately STATIC part of the same page reported 8 changed frames with
 * a 99.8% peak — the encoder's own keyframes, not the application. A
 * measurement that reports motion on a still region cannot be used to claim
 * a region is still, so the capture was replaced rather than the threshold
 * tuned.
 *
 * CDP's screencast emits a frame when the page actually paints, with the
 * compositor's own timestamp. Cropping those frames and diffing them counts
 * real repaints against real wall-clock time.
 */
function analyse(dir, box, times) {
  const script = `
import glob, json, os
import numpy as np
from PIL import Image
files = sorted(glob.glob(os.path.join(${JSON.stringify(dir)}, 'f_*.png')))
times = json.load(open(${JSON.stringify(path.join(dir, 'times.json'))}))
box = ${JSON.stringify(box)}
# RESAMPLED TO 30fps, because the reference was.
# The screencast emits a frame per compositor paint, and a large repaint can
# be composited in two tiles across two frames — counting those as two
# repaints would flatter nothing and mislead everything. The Binance
# reference is a 30fps screen recording, which SAMPLES: whatever the screen
# held at each tick. Sampling the captured frames the same way makes the two
# numbers the same measurement.
FPS = 30.0
t0, t1 = times[0], times[-1]
ticks = [t0 + k / FPS for k in range(int((t1 - t0) * FPS) + 1)]
cursor = 0
sampled = []
for tk in ticks:
    while cursor + 1 < len(times) and times[cursor + 1] <= tk:
        cursor += 1
    sampled.append(cursor)
prev = None; moved_at = []; changes = []
cache = {}
for k, idx in enumerate(sampled):
    if idx not in cache:
        im = Image.open(files[idx]).convert('RGB')
        cache[idx] = np.asarray(im.crop((box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height'])), dtype=np.int16)
    a = cache[idx]
    if prev is not None:
        pct = float((np.abs(a - prev).max(axis=2) > ${PIXEL_DELTA}).mean() * 100)
        changes.append(pct)
        if pct > ${MOVED_PCT}: moved_at.append(ticks[k])
    prev = a
span = (t1 - t0) if len(times) > 1 else 0
gaps = [round((moved_at[j+1] - moved_at[j]) * 1000) for j in range(len(moved_at) - 1)]
print(json.dumps({
  'framesCaptured': len(files),
  'framesSampled30fps': len(sampled),
  'windowSeconds': round(span, 2),
  'bookChanges': len(moved_at),
  'repaintsPerSecond': round(len(moved_at) / span, 2) if span else 0,
  'meanGapMs': round(sum(gaps) / len(gaps)) if gaps else None,
  'framesUnchanged': sum(1 for c in changes if c <= ${MOVED_PCT}),
  'stillShare': round(sum(1 for c in changes if c <= ${MOVED_PCT}) / max(1, len(changes)) * 100, 1),
  'maxFrameChangePct': round(max(changes), 2) if changes else 0,
  'medianMovedChangePct': round(float(np.median([c for c in changes if c > ${MOVED_PCT}])), 2) if any(c > ${MOVED_PCT} for c in changes) else 0,
}))
`;
  fs.writeFileSync(path.join(dir, 'times.json'), JSON.stringify(times));
  return JSON.parse(execFileSync('python3', ['-c', script]).toString());
}

/** Capture every paint of the page as a PNG, with the compositor's clock. */
async function screencast(page, context, dir, ms) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const times = [];
  let index = 0;
  cdp.on('Page.screencastFrame', async (frame) => {
    const n = index++;
    fs.writeFileSync(path.join(dir, `f_${String(n).padStart(4, '0')}.png`), Buffer.from(frame.data, 'base64'));
    times.push(frame.metadata.timestamp);
    try { await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch { /* stopped */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.waitForTimeout(ms);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return times;
}

async function measure() {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const viewport = { width: 1920, height: 1080 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${HTTP_PORT}/futures`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rb-row', { timeout: 30000 });
  // Let the first snapshot settle: this measures steady state, not arrival.
  await page.waitForTimeout(3000);

  const region = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, selector);

  const box = await region('.rb-body');
  if (!box) throw new Error('no .rb-body to measure');
  /** The three parts of the panel move for different reasons — the ladders
   *  on depth, the middle block on the trade tape — so they are reported
   *  apart. A single number over the whole panel hides which one is loud. */
  const parts = {
    asks: await region('.rb-asks'),
    centre: await region('.rb-center'),
    bids: await region('.rb-bids'),
  };
  /** A region of the page nothing is supposed to repaint. If this reports
   *  motion, the capture is lying and the book's number means nothing. */
  const control = await region('.reference-book .rb-columns');

  const feed = await page.evaluate(() => {
    const el = document.querySelector('.rb-feed');
    return el ? { text: el.textContent.trim(), state: el.getAttribute('data-state') } : null;
  });
  const placeholderRows = await page.evaluate(() => document.querySelectorAll('.rb-row.is-placeholder').length);

  /**
   * A per-frame snapshot of the ladder's actual CONTENT, taken in rAF.
   * The pixel measurement says how often the panel repaints; this says how
   * often it has something NEW to show. Where the two disagree, the panel
   * is repainting without new information, which is the definition of
   * visual noise.
   */
  await page.evaluate(() => {
    const w = window;
    w.__ladder = { frames: 0, distinct: 0, distinctBars: 0 };
    let lastText = '', lastBars = '';
    const tick = () => {
      const rows = document.querySelectorAll('.rb-asks .rb-row, .rb-bids .rb-row');
      let text = '', bars = '';
      for (const row of rows) {
        text += row.textContent + '|';
        bars += (row.querySelector('.rb-depth')?.getAttribute('style') || '') + '|';
      }
      w.__ladder.frames++;
      if (text !== lastText) { w.__ladder.distinct++; lastText = text; }
      if (bars !== lastBars) { w.__ladder.distinctBars++; lastBars = bars; }
      w.__ladderRaf = requestAnimationFrame(tick);
    };
    w.__ladderRaf = requestAnimationFrame(tick);
  });

  const dir = path.join(OUT, `${LABEL}-frames`);
  const started = Date.now();
  const times = await screencast(page, context, dir, RECORD_MS);
  const ladder = await page.evaluate((ms) => {
    cancelAnimationFrame(window.__ladderRaf);
    const l = window.__ladder;
    return { rafFrames: l.frames, textUpdates: l.distinct, barUpdates: l.distinctBars,
      textUpdatesPerSecond: Number((l.distinct / (ms / 1000)).toFixed(2)),
      barUpdatesPerSecond: Number((l.distinctBars / (ms / 1000)).toFixed(2)) };
  }, Date.now() - started);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-book.png`), clip: box });
  await page.close();
  await context.close();
  await browser.close();

  const stats = analyse(dir, box, times);
  const controlStats = control ? analyse(dir, control, times) : null;
  const partStats = Object.fromEntries(Object.entries(parts)
    .filter(([, r]) => r).map(([name, r]) => [name, analyse(dir, r, times)]));

  const REFERENCE = { source: 'owner video, Binance Futures BTCUSDT, 2.0s @30fps',
    repaintsPerSecond: 2.5, meanGapMs: 425, maxFrameChangePct: 2.82 };
  const report = { label: LABEL, seed: SEED, feedFrameMs: FRAME_MS, recordMs: RECORD_MS, box,
    feedChip: feed, placeholderRows, binanceReference: REFERENCE, measured: stats,
    byRegion: partStats, ladderContent: ladder, control: controlStats };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
  // The frames are large and the numbers are the deliverable.
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n===== order book calm: ${LABEL} =====`);
  console.log(`  crop                ${box.width}x${box.height} at ${box.x},${box.y}`);
  console.log(`  paints captured     ${stats.framesCaptured} over ${stats.windowSeconds}s`);
  console.log(`  book repaints/sec   ${stats.repaintsPerSecond}   (Binance ${REFERENCE.repaintsPerSecond})`);
  console.log(`  mean gap            ${stats.meanGapMs} ms   (Binance ${REFERENCE.meanGapMs} ms)`);
  console.log(`  book changed on     ${stats.bookChanges} of ${stats.framesCaptured - 1} paints`);
  console.log(`  largest repaint     ${stats.maxFrameChangePct}%   (Binance ${REFERENCE.maxFrameChangePct}%)`);
  for (const [name, r] of Object.entries(partStats)) {
    console.log(`    ${name.padEnd(16)}  ${String(r.repaintsPerSecond).padStart(5)}/s   gap ${String(r.meanGapMs ?? '-').padStart(4)} ms`);
  }
  console.log(`  ladder CONTENT      ${ladder.textUpdatesPerSecond}/s new numbers, ${ladder.barUpdatesPerSecond}/s new bars`);
  if (controlStats) {
    console.log(`  CONTROL (static)    ${controlStats.bookChanges} changes, max ${controlStats.maxFrameChangePct}%  <- must be 0`);
  }
  console.log(`  feed chip on screen ${feed ? `${feed.state}: ${feed.text}` : 'none'}`);
  console.log(`\n  report: ${path.join(OUT, LABEL + '.json')}`);
}
