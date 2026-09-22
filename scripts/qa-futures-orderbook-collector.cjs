/**
 * Browser QA for the Futures fallback order book in the API region.
 *
 * The API region (Oregon) may not call Bybit directly, so
 * `CollectorUniverseProvider` disables its inherited transport. Depth must
 * therefore come from the collector (Frankfurt). This drives the REAL
 * `marketDepthRouter` with a REAL `CollectorUniverseProvider` in a real
 * browser, and keeps production's own disabled direct transport in place —
 * wrapped in a counter, so "no direct Bybit request" is MEASURED rather
 * than assumed.
 *
 * What it refuses to accept:
 *   - an empty book presented as depth when the collector is down,
 *   - our own region policy surfacing to the customer as a venue outage,
 *   - a book that never recovers once the collector is back.
 *
 * The collector here is a stand-in, not the real Frankfurt process: the
 * point is which REGION fetches the book and what the customer sees, not
 * Bybit's own payload.
 */
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { marketDepthRouter } = require('../dist/api/routes/marketDepth');
const { MarketUniverse } = require('../dist/services/marketData/bybit/MarketUniverse');
const { MarketDataCollectorClient, CollectorUniverseProvider } = require('../dist/services/marketData/live/MarketDataCollectorClient');

const TOKEN = 'qa-collector-token';
const SYMBOLS = (process.env.QA_SYMBOLS || 'BTCUSDT,ETHUSDT').split(',');
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '../docs/qa/futures-orderbook-collector'));

let directBybit = 0;
let collectorDown = false;
let collectorHops = 0;
const findings = [];
const fail = (m) => { findings.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

/** Exactly the shape the collector client's schema demands. An invalid
 *  instrument is dropped silently and the symbol then reads as unlisted,
 *  which looks like a routing failure and is not one. */
const instrument = (providerSymbol) => ({
  provider: 'bybit', providerSymbol, symbol: `${providerSymbol.replace('USDT', '')}/USDT`,
  marketType: 'linear_perpetual', baseAsset: providerSymbol.replace('USDT', ''), quoteAsset: 'USDT',
  settleAsset: 'USDT', status: 'Trading', launchTime: null, deliveryTime: null,
  filters: { tickSize: 0.1, qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100,
    minNotional: 5, maxNotional: 1e7, pricePrecision: 1, qtyPrecision: 3 },
  providerMaxLeverage: 100, fundingIntervalMinutes: 480,
});
const book = (symbol) => ({
  symbol,
  bids: [{ price: '60000.5', quantity: '1.25' }, { price: '60000.0', quantity: '3.10' }, { price: '59999.5', quantity: '0.80' }],
  asks: [{ price: '60001.0', quantity: '2.05' }, { price: '60001.5', quantity: '1.40' }, { price: '60002.0', quantity: '4.00' }],
  updateId: 12345, providerTime: Date.now(),
});

const listen = (app) => new Promise((resolve) => {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, ms = 5000) {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) return false; await sleep(10); }
  return true;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>fallback book</title><body>
<div id="s">idle</div><div id="levels"></div><script>
window.load = async (sym) => {
  document.getElementById('s').textContent = 'loading';
  document.getElementById('levels').textContent = '';
  const r = await fetch('/api/v1/market/futures/orderbook/' + sym);
  const j = await r.json();
  if (j.available === false) {
    document.getElementById('s').textContent = 'unavailable:' + j.reason;
    return j;
  }
  const bids = j.bids || [], asks = j.asks || [];
  document.getElementById('levels').textContent = JSON.stringify({ bids: bids.length, asks: asks.length });
  document.getElementById('s').textContent = 'ok';
  return { bids: bids.length, asks: asks.length, firstBidQty: bids[0] && Number(bids[0].quantity), symbol: j.symbol };
};
</script></body>`;

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || process.env.CFD_QA_PLAYWRIGHT || 'playwright');

  // The collector, standing in for Frankfurt.
  const collectorApp = express();
  collectorApp.get('/internal/v1/universe', (req, res) => {
    if (req.header('authorization') !== `Bearer ${TOKEN}`) return res.status(401).end();
    res.json({ loaded: true, refreshedAt: Date.now(), stale: false, instruments: SYMBOLS.map(instrument) });
  });
  collectorApp.get('/internal/v1/futures/orderbook/:symbol', (req, res) => {
    if (req.header('authorization') !== `Bearer ${TOKEN}`) return res.status(401).end();
    collectorHops++;
    if (collectorDown) return res.status(503).json({ error: 'orderbook_unavailable' });
    res.json({ value: book(String(req.params.symbol).toUpperCase()), fetchedAt: Date.now(), stale: false });
  });
  const collector = await listen(collectorApp);

  // The API region. Anything that is NOT the collector counts as a direct
  // venue request, which is the thing this must never do.
  const countingFetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : (input && input.url) || input);
    if (!url.startsWith(`http://127.0.0.1:${collector.port}`)) directBybit++;
    return fetch(input, init);
  };
  const client = new MarketDataCollectorClient(`http://127.0.0.1:${collector.port}`, TOKEN, countingFetch);
  const universe = new MarketUniverse(new CollectorUniverseProvider(client), { includeInverse: false });
  await universe.refresh();

  const api = express();
  api.use('/api/v1', marketDepthRouter(universe));
  api.get('/', (_q, r) => r.type('html').send(PAGE));
  const apiSrv = await listen(api);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const report = { viewports: {} };
  try {
    for (const vp of VIEWPORTS) {
      for (const sym of SYMBOLS) {
        console.log(`\n=== ${vp.name} ${sym} ===`);
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
        await page.goto(`http://127.0.0.1:${apiSrv.port}/`, { waitUntil: 'domcontentloaded' });

        collectorDown = false;
        const healthy = await page.evaluate((s) => window.load(s), sym);
        if (healthy && healthy.bids > 0 && healthy.asks > 0 && healthy.firstBidQty > 0 && healthy.symbol === sym) {
          ok(`book populated: ${healthy.bids} bids / ${healthy.asks} asks, top qty ${healthy.firstBidQty}`);
        } else fail(`${vp.name} ${sym}: book not populated — ${JSON.stringify(healthy)}`);

        // Our own region policy must never reach the customer as a venue fault.
        const text = await page.textContent('body');
        if (/Direct Bybit access disabled|circuit open|bybit/i.test(text || '')) {
          fail(`${vp.name} ${sym}: region or venue wording reached the page`);
        } else ok('no region or venue wording on the page');

        await page.screenshot({ path: path.join(OUT, `${vp.name}-${sym}-healthy.png`) });

        // Collector down: honest, and NOT an empty book dressed as depth.
        collectorDown = true;
        await sleep(1100); // outlast the client's one-second depth cache
        const down = await page.evaluate((s) => window.load(s), sym);
        const status = await page.textContent('#s');
        if (down && down.available === false && /unavailable/.test(status || '')) {
          ok(`collector down answered honestly (${down.reason})`);
        } else fail(`${vp.name} ${sym}: collector-down not honest — status=${status} body=${JSON.stringify(down)}`);
        const levels = await page.textContent('#levels');
        if ((levels || '') === '') ok('no fake empty book rendered while unavailable');
        else fail(`${vp.name} ${sym}: levels rendered while unavailable — ${levels}`);

        await page.screenshot({ path: path.join(OUT, `${vp.name}-${sym}-collector-down.png`) });

        collectorDown = false;
        await sleep(1100);
        const back = await page.evaluate((s) => window.load(s), sym);
        if (back && back.bids > 0) ok('recovers when the collector returns');
        else fail(`${vp.name} ${sym}: did not recover — ${JSON.stringify(back)}`);

        if (errs.length === 0) ok('no console or page errors');
        else fail(`${vp.name} ${sym}: page/console errors — ${[...new Set(errs)].slice(0, 3).join(' | ')}`);

        report.viewports[`${vp.name} ${sym}`] = { healthy, recovered: back, errors: [...new Set(errs)] };
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    apiSrv.server.close();
    collector.server.close();
  }

  console.log(`\ncollector hops: ${collectorHops}`);
  if (directBybit === 0) ok('DIRECT BYBIT REQUESTS FROM THE API REGION: 0');
  else fail(`direct Bybit requests from the API region: ${directBybit}`);

  report.collectorHops = collectorHops;
  report.directBybitRequests = directBybit;
  report.status = findings.length ? 'FAIL' : 'PASS';
  report.findings = findings;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSTATUS: ${report.status}`);
  if (findings.length) console.log(JSON.stringify(findings, null, 2));
  console.log(`evidence: ${OUT}`);
  process.exit(findings.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
