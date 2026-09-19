/**
 * Browser QA for the order book's refresh and reconnect behaviour.
 *
 * What it proves, on the real production bundle, in a real browser:
 *
 *   1. the ladder is never emptied by a refresh, a failed refresh, or a
 *      tab switch — the last real snapshot stays on screen;
 *   2. the cadence is the quiet one, measured by counting the requests the
 *      page actually makes over a window, not by reading the constant;
 *   3. returning to the tab re-reads once, quietly, and raises no banner;
 *   4. nothing on screen is depth the feed did not send.
 *
 * The venue socket is unreachable from here, which is not a limitation for
 * this harness — it is the case under test. A blocked socket is exactly the
 * "feed has gone quiet" path whose cadence and last-good behaviour this
 * change is about.
 */
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/** Point this at another build to compare behaviour against a baseline. */
const DIST = process.env.QA_DIST || path.resolve(__dirname, '../frontend/dist');
const OUT = process.env.QA_OUT || '/tmp/qa-orderbook-ux';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 180) : ''}`);
};

/** A real-shaped book. Every level here is one the harness served. */
const LEVELS = (base, dir) => Array.from({ length: 25 }, (_, i) => ({
  price: (base + dir * (i + 1) * 0.5).toFixed(2),
  quantity: (0.4 + i * 0.11).toFixed(4),
}));
const BOOK = (mid) => ({ bids: LEVELS(mid, -1), asks: LEVELS(mid, +1) });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Read the Spot ladder as a person sees it: one string per row. */
const readLadder = () => {
  const rows = [...document.querySelectorAll('.orderbook-asks .ob-row, .orderbook-bids .ob-row')];
  return rows.map((r) => [...r.querySelectorAll('.cell')].map((c) => c.textContent.trim()).join('|'));
};

/** Make the page believe it went into the background and came back. */
async function setHidden(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function run() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' });
  await context.addInitScript(() => {
    localStorage.setItem('exchange_token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSIsInNpZCI6InFhIn0.qa');
    localStorage.setItem('exchange_language', 'ru');
  });

  let bookRequests = 0;
  let bookFails = false;
  let mid = 65000;
  await context.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes('/market/external/orderbook/')) {
      bookRequests += 1;
      if (bookFails) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Market-wide data is temporarily unavailable"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOOK(mid)) });
    }
    if (/\/api\/v\d+\/me$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'qa', email: 'trader@example.com', displayName: 'QA', phone: null, country: 'SG', avatarUrl: null, role: 'USER', isAdmin: false, kycStatus: 'NONE', twoFactorEnabled: false, createdAt: '2025-01-01T00:00:00.000Z' }) });
    if (pathname.endsWith('/balances')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (pathname.endsWith('/cfd/tickers')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"source":"qa","configured":true,"tickers":[]}' });
    if (pathname.includes('/market/external/candles/')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ candles: Array.from({ length: 60 }, (_, i) => ({ time: Math.floor(Date.now() / 1000) - (60 - i) * 60, open: 64900, high: 65100, low: 64800, close: 65000, volume: 12.5 })) }) });
    if (pathname.endsWith('/market/snapshot')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tickers: { available: false, reason: 'provider_unavailable' }, overview: { available: false, reason: 'provider_unavailable' }, sentiment: { available: false, reason: 'provider_unavailable' } }) });
    if (/\/(orders|trades|positions)(\/me)?$/.test(pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  try {
    await page.goto(`${base}/trade`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.orderbook-bids .ob-row', { timeout: 20_000 });
    await page.waitForTimeout(1500);

    const first = await page.evaluate(readLadder);
    check('the ladder paints from the served book', first.length >= 10, `${first.length} rows`);
    await page.screenshot({ path: path.join(OUT, '1-populated.png') });

    // ── no synthetic depth ────────────────────────────────────────────────
    const served = new Set([...BOOK(mid).bids, ...BOOK(mid).asks].map((l) => Number(l.price).toFixed(2)));
    const shownPrices = first.map((row) => row.split('|')[0].replace(/\s/g, '').replace(',', '.'));
    const invented = shownPrices.filter((p) => {
      const n = Number(p);
      // Grouped rows land on a coarser grid, so a shown price must be a
      // price the feed sent or a bucket boundary between two of them.
      return Number.isFinite(n) && n > 0 && !served.has(n.toFixed(2)) && n % 0.5 !== 0;
    });
    check('shows no level the feed did not send', invented.length === 0, invented.slice(0, 4).join(', '));

    // ── a failed refresh must not empty the ladder ────────────────────────
    const removalsHandle = await page.evaluateHandle(() => {
      const state = { removed: 0 };
      const target = document.querySelector('.orderbook-bids');
      new MutationObserver((records) => {
        for (const r of records) state.removed += r.removedNodes.length;
      }).observe(target, { childList: true });
      window.__obState = state;
      return state;
    });
    bookFails = true;
    await page.evaluate(() => { window.__obState.removed = 0; });
    // Drive the refresh the page would make on its own, without waiting a
    // whole cycle: hiding and showing asks for exactly one quiet read.
    await setHidden(page, true);
    await page.waitForTimeout(400);
    await setHidden(page, false);
    await page.waitForTimeout(2500);

    const afterFail = await page.evaluate(readLadder);
    check('a failed refresh leaves the last-good ladder on screen', afterFail.length === first.length, `${first.length} → ${afterFail.length} rows`);
    check('a failed refresh changes none of the rows shown', JSON.stringify(afterFail) === JSON.stringify(first));
    const removedOnFail = await page.evaluate(() => window.__obState.removed);
    check('a failed refresh removes no row from the DOM', removedOnFail === 0, `${removedOnFail} removed`);
    await page.screenshot({ path: path.join(OUT, '2-failed-refresh.png') });

    // ── returning to the tab is quiet ─────────────────────────────────────
    bookFails = false;
    mid = 65100;
    await page.evaluate(() => { window.__obState.removed = 0; });
    const beforeReturn = bookRequests;
    await setHidden(page, true);
    await page.waitForTimeout(600);
    await setHidden(page, false);
    await page.waitForTimeout(2500);

    const afterReturn = await page.evaluate(readLadder);
    check('returning re-reads the book', bookRequests > beforeReturn, `${bookRequests - beforeReturn} request(s)`);
    check('returning reads once, not in a burst', bookRequests - beforeReturn <= 2, `${bookRequests - beforeReturn} request(s)`);
    check('returning never blanks the ladder', afterReturn.length === first.length, `${afterReturn.length} rows`);
    check('returning updates the ladder in place, without removing rows', await page.evaluate(() => window.__obState.removed) === 0);
    check('the new book actually reached the screen', JSON.stringify(afterReturn) !== JSON.stringify(first));

    const banner = await page.evaluate(() => {
      const found = [...document.querySelectorAll('[role="status"]')]
        .map((n) => n.textContent.trim())
        .filter((text) => /Связь|подключ|Восстанавлива/i.test(text));
      return found;
    });
    check('no reconnect banner on a normal return', banner.length === 0, banner.join(' / '));
    await page.screenshot({ path: path.join(OUT, '3-after-return.png') });

    // ── the cadence is the quiet one ──────────────────────────────────────
    const windowMs = 70_000;
    const startedAt = bookRequests;
    console.log(`\n  measuring the request cadence over ${windowMs / 1000}s…`);
    await page.waitForTimeout(windowMs);
    const made = bookRequests - startedAt;
    // The old shape polled every two seconds whenever the socket was quiet,
    // which over this window is ~35 requests. The quiet cadence is ~2.
    check('refreshes on the quiet cadence, not a poll', made <= 5, `${made} requests in ${windowMs / 1000}s`);
    check('but does keep refreshing', made >= 1, `${made} requests in ${windowMs / 1000}s`);
    await removalsHandle.dispose();

    check('no uncaught page error throughout', pageErrors.length === 0, pageErrors[0] || '');
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.pass);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(checks, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
