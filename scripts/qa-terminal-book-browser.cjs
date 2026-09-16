/**
 * Browser QA for the order book, the order inputs and the market header.
 *
 * Runs the real production bundle against scripts/serve-terminal-book-review.cjs.
 * The depth feed is a local socket speaking the venue's frame shape — see
 * that file. NOT a live-provider verification, and the report says so.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4310';
const VIEWPORTS = [
  { name: 'desktop 1440x1000', width: 1440, height: 1000 },
  { name: 'mobile 390x844', width: 390, height: 844 },
];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const control = (page, body) => page.evaluate(async (b) => {
  await fetch('/__qa/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
}, body);
const post = (page, path) => page.evaluate((p) => fetch(p, { method: 'POST' }).then(() => null), path);
const stand = (page) => page.evaluate(() => fetch('/__qa/report').then((r) => r.json()));

const rows = (page) => page.locator('.reference-book .rb-row').count();
const bookText = (page) => page.locator('.reference-book').innerText();

async function waitForBook(page, min = 6, timeout = 25000) {
  await page.waitForFunction((m) => document.querySelectorAll('.reference-book .rb-row').length >= m, min, { timeout });
}

/** Geometry of every row, so "jumping" is measured rather than eyeballed. */
const geometry = (page) => page.evaluate(() => {
  const book = document.querySelector('.reference-book');
  if (!book) return null;
  const rowEls = [...book.querySelectorAll('.rb-row')];
  const cells = rowEls.length ? [...rowEls[0].querySelectorAll('span')].map((s) => Math.round(s.getBoundingClientRect().width)) : [];
  return {
    rows: rowEls.length,
    heights: [...new Set(rowEls.map((r) => Math.round(r.getBoundingClientRect().height)))],
    columnWidths: cells,
    left: rowEls.length ? Math.round(rowEls[0].getBoundingClientRect().left) : null,
    width: Math.round(book.getBoundingClientRect().width),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});

async function run(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const label = (s) => `[${viewport.name}] ${s}`;

  await page.goto(`${BASE}/futures`, { waitUntil: 'domcontentloaded' });
  await post(page, '/__qa/reset-counters');
  await control(page, { refuseSockets: false, silent: false, clockSkewMs: 0 });

  // ---------- 1. initial load ----------
  await waitForBook(page);
  const first = await geometry(page);
  check(label('order book fills on initial load'), first.rows >= 6, `${first.rows} rows`);
  check(label('no horizontal page overflow'), !first.overflow);
  check(label('every row is the same height'), first.heights.length === 1, `heights=${first.heights.join(',')}`);

  // ---------- 2. a visitor clock the venue disagrees with ----------
  // The exact condition that used to empty this panel permanently.
  await control(page, { clockSkewMs: -45_000 });
  await page.waitForTimeout(2500);
  const skewed = await rows(page);
  check(label('a 45s clock disagreement does not empty the book'), skewed >= 6, `${skewed} rows`);
  await control(page, { clockSkewMs: 0 });

  // ---------- 3. live updates, and no reset over a full minute ----------
  const before = await bookText(page);
  await page.waitForTimeout(2000);
  const moved = (await bookText(page)) !== before;
  check(label('depth updates live'), moved);

  let emptied = false, maxRows = 0, minRows = Infinity;
  const started = Date.now();
  while (Date.now() - started < 62_000) {
    const n = await rows(page);
    maxRows = Math.max(maxRows, n); minRows = Math.min(minRows, n);
    if (n === 0) { emptied = true; break; }
    await page.waitForTimeout(1500);
  }
  check(label('60s of live updates without the book ever emptying'), !emptied, `rows stayed ${minRows}-${maxRows}`);

  const steady = await geometry(page);
  check(label('columns do not resize as values change'),
    JSON.stringify(steady.columnWidths) === JSON.stringify(first.columnWidths),
    `${first.columnWidths.join('/')} -> ${steady.columnWidths.join('/')}`);
  check(label('rows do not shift horizontally'), steady.left === first.left, `left ${first.left} -> ${steady.left}`);

  // ---------- 4. contract rotation BTC -> ETH -> SOL -> BTC ----------
  await post(page, '/__qa/reset-counters');
  const socketsBefore = (await stand(page)).sockets;
  for (const pair of ['ETH/USDT', 'SOL/USDT', 'BTC/USDT']) {
    await page.evaluate((p) => { window.history.pushState({}, '', `/futures?pair=${encodeURIComponent(p)}`); window.dispatchEvent(new PopStateEvent('popstate')); }, pair);
    await page.waitForTimeout(2200);
    const n = await rows(page);
    check(label(`book refills on ${pair}`), n >= 6, `${n} rows`);
  }
  const afterRotation = await stand(page);
  check(label('rotating contracts opens no new sockets'), afterRotation.sockets === socketsBefore,
    `${socketsBefore} -> ${afterRotation.sockets}`);

  // ---------- 5. ten rapid switches: no request storm ----------
  await post(page, '/__qa/reset-counters');
  for (let i = 0; i < 10; i++) {
    const pair = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'][i % 4];
    await page.evaluate((p) => { window.history.pushState({}, '', `/futures?pair=${encodeURIComponent(p)}`); window.dispatchEvent(new PopStateEvent('popstate')); }, pair);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3000);
  const storm = await stand(page);
  check(label('10 rapid switches open no extra sockets'), storm.sockets === 0, `${storm.sockets} new sockets`);
  check(label('10 rapid switches trigger no fallback polling'), storm.restCalls === 0, `${storm.restCalls} book requests`);

  // ---------- 6. step, modes and the trades tab ----------
  await page.evaluate(() => { window.history.pushState({}, '', '/futures?pair=BTC%2FUSDT'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitForBook(page);
  const stepSelect = page.locator('.reference-book select');
  const options = await stepSelect.locator('option').count();
  check(label('grouping steps are offered'), options >= 2, `${options} steps`);
  if (options >= 2) {
    const before = await bookText(page);
    await stepSelect.selectOption({ index: 1 });
    await page.waitForTimeout(1200);
    const after = await rows(page);
    check(label('changing the step keeps a populated book'), after >= 4, `${after} rows`);
    check(label('changing the step changes the grid'), (await bookText(page)) !== before);
  }
  for (const [i, mode] of [['bids', 1], ['asks', 2], ['both', 0]].map(([m, i]) => [i, m])) {
    await page.locator('.reference-book .rb-modes button').nth(i).click();
    await page.waitForTimeout(700);
    const n = await rows(page);
    check(label(`${mode}-only view keeps rows`), n >= 4, `${n} rows`);
    const g = await geometry(page);
    check(label(`${mode}-only view does not overflow`), !g.overflow);
  }
  await page.locator('.reference-book .rb-tabs button').nth(1).click();
  await page.waitForTimeout(1500);
  const tape = await page.locator('.reference-book .rb-tape .rb-row').count();
  check(label('trades tab shows executions'), tape > 0, `${tape} trades`);
  await page.locator('.reference-book .rb-tabs button').nth(0).click();
  await waitForBook(page);

  // ---------- 7. network interruption and recovery ----------
  const beforeDrop = await rows(page);
  await post(page, '/__qa/drop');
  await page.waitForTimeout(400);
  const duringDrop = await rows(page);
  check(label('a dropped connection does not empty the book'), duringDrop >= beforeDrop - 2 && duringDrop > 0,
    `${beforeDrop} -> ${duringDrop} rows`);
  await page.waitForTimeout(6000);
  const recovered = await rows(page);
  check(label('the book recovers after the connection returns'), recovered >= 6, `${recovered} rows`);

  // ---------- 8. hidden tab, then foreground ----------
  const beforeHide = await rows(page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2500);
  const hidden = await rows(page);
  check(label('a backgrounded tab keeps its book'), hidden > 0, `${beforeHide} -> ${hidden} rows`);
  const staleLabel = await page.locator('.reference-book .rb-feed').count();
  check(label('a backgrounded tab says it is not updating'), staleLabel > 0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(5000);
  const returned = await rows(page);
  check(label('returning to the tab resumes live depth'), returned >= 6, `${returned} rows`);

  // ---------- 9. the fallback, and only when the socket cannot work ----------
  await post(page, '/__qa/reset-counters');
  await page.waitForTimeout(6000);
  const healthy = await stand(page);
  check(label('a healthy socket costs the backend nothing'), healthy.restCalls === 0, `${healthy.restCalls} book requests`);

  await control(page, { refuseSockets: true });
  await post(page, '/__qa/drop');
  await post(page, '/__qa/reset-counters');
  await page.waitForTimeout(16000);
  const blocked = await stand(page);
  const blockedRows = await rows(page);
  check(label('a browser that cannot hold a socket still gets a book'), blockedRows >= 6, `${blockedRows} rows`);
  check(label('the fallback is bounded to about one request a second'),
    blocked.restCalls > 0 && blocked.restCalls <= 20, `${blocked.restCalls} requests in ~16s`);
  const symbolsPolled = Object.keys(blocked.restBySymbol).length;
  check(label('one poller per contract, not per component'), symbolsPolled === 1, `polled ${symbolsPolled} symbols`);

  await control(page, { refuseSockets: false });
  await page.waitForTimeout(8000);
  await post(page, '/__qa/reset-counters');
  await page.waitForTimeout(6000);
  const restored = await stand(page);
  check(label('the fallback stops once the socket works again'), restored.restCalls === 0, `${restored.restCalls} requests`);

  // ---------- 10. idle cost ----------
  await post(page, '/__qa/reset-counters');
  await page.waitForTimeout(60_000);
  const idle = await stand(page);
  const idleCalls = Object.entries(idle.requests).filter(([p]) => p.startsWith('/api/')).reduce((n, [, c]) => n + c, 0);
  // The budget is the measured shape of the page's EXISTING polls (mark
  // price, funding, positions, orders, balances, candles, access). What
  // this work added is the line below it: zero. A regression in either
  // number is a regression in Render cost.
  check(label('60s idle stays within the measured API budget'), idleCalls <= 130, `${idleCalls} API calls in 60s`);
  check(label('60s idle costs the depth fallback nothing'), idle.restCalls === 0, `${idle.restCalls} book requests`);
  check(label('60s idle opens no extra sockets'), idle.sockets === 0, `${idle.sockets} sockets`);
  console.log(`      [load] 60s idle API calls by path: ${JSON.stringify(idle.requests)}`);

  // ---------- 11. header ----------
  const header = await page.evaluate(() => {
    const bar = document.querySelector('.futures-ticker-bar');
    if (!bar) return null;
    const price = bar.querySelector('.value.price');
    const arrow = bar.querySelector('.pair-arrow');
    const cs = arrow && getComputedStyle(arrow);
    return {
      priceSize: price ? parseFloat(getComputedStyle(price).fontSize) : null,
      priceTabular: price ? getComputedStyle(price).fontVariantNumeric : null,
      pairSize: parseFloat(getComputedStyle(bar.querySelector('.pair-name')).fontSize),
      arrowDisplay: cs && cs.display,
      // The rendered box, not the declared width: a 6px square rotated 45
      // degrees measures ~8.49px, and a chevron squashed by flex-shrink
      // measures ~5. This is what distinguishes a chevron from a stroke.
      arrowWidth: arrow ? Math.round(arrow.getBoundingClientRect().width * 100) / 100 : null,
      arrowHeight: arrow ? Math.round(arrow.getBoundingClientRect().height * 100) / 100 : null,
      arrowDeclared: cs && cs.width,
      arrowColor: cs && cs.color,
      barHeight: Math.round(bar.getBoundingClientRect().height),
      text: bar.innerText.replace(/\n/g, ' | '),
    };
  });
  check(label('last price is a header size, not a hero heading'), header.priceSize !== null && header.priceSize <= 21, `${header.priceSize}px`);
  check(label('last price uses tabular figures'), (header.priceTabular || '').includes('tabular-nums'), header.priceTabular);
  check(label('the pair chevron is a square box, not a squashed stroke'),
    header.arrowDeclared === '6px' && header.arrowWidth > 8 && Math.abs(header.arrowWidth - header.arrowHeight) < 0.01,
    `declared=${header.arrowDeclared} rendered=${header.arrowWidth}x${header.arrowHeight}`);
  check(label('the chevron is a secondary control, not a bright artifact'),
    !/rgb\(2[4-5]\d, *2[4-5]\d, *2[4-5]\d\)/.test(header.arrowColor || ''), header.arrowColor);
  console.log(`      [header] ${header.barHeight}px · ${header.text.slice(0, 150)}`);

  // header across price magnitudes
  for (const pair of ['XRP/USDT', 'DOGE/USDT', 'BTC/USDT']) {
    await page.evaluate((p) => { window.history.pushState({}, '', `/futures?pair=${encodeURIComponent(p)}`); window.dispatchEvent(new PopStateEvent('popstate')); }, pair);
    await page.waitForTimeout(1800);
    const g = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      price: document.querySelector('.futures-ticker-bar .value.price')?.textContent ?? '',
    }));
    check(label(`${pair} header renders without overflow`), !g.overflow, `price "${g.price}"`);
  }

  // ---------- 12. order inputs ----------
  await page.evaluate(() => { window.history.pushState({}, '', '/futures?pair=BTC%2FUSDT'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(2500);
  const fields = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.fo-field .fo-fieldRow')].map((r) => Math.round(r.getBoundingClientRect().height));
    const input = document.querySelector('.fo-field .fo-input');
    const trailing = document.querySelector('.fo-fieldTrailing');
    return {
      boxes,
      tabular: input ? getComputedStyle(input).fontVariantNumeric : null,
      trailingMin: trailing ? parseFloat(getComputedStyle(trailing).minWidth) : null,
    };
  });
  check(label('price and quantity are the same box height'), fields.boxes.length >= 1 && new Set(fields.boxes).size === 1, `heights=${fields.boxes.join(',')}`);
  check(label('the field box is compact'), fields.boxes.every((h) => h <= 44), `heights=${fields.boxes.join(',')}`);
  check(label('order inputs use tabular figures'), (fields.tabular || '').includes('tabular-nums'), fields.tabular);
  check(label('the trailing unit slot has a fixed width'), fields.trailingMin >= 40, `${fields.trailingMin}px`);

  // typing must not resize the box or move the unit
  const priceInput = page.locator('.fo-priceField .fo-input').first();
  if (await priceInput.count()) {
    const geoBefore = await page.evaluate(() => {
      const r = document.querySelector('.fo-priceField .fo-fieldRow').getBoundingClientRect();
      const t = document.querySelector('.fo-priceField .fo-fieldTrailing')?.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), tl: t ? Math.round(t.left) : null };
    });
    await priceInput.click();
    await priceInput.fill('74999.5');
    await page.waitForTimeout(300);
    await priceInput.fill('1234567.89');
    await page.waitForTimeout(300);
    const geoAfter = await page.evaluate(() => {
      const r = document.querySelector('.fo-priceField .fo-fieldRow').getBoundingClientRect();
      const t = document.querySelector('.fo-priceField .fo-fieldTrailing')?.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), tl: t ? Math.round(t.left) : null };
    });
    check(label('typing does not resize the price field'), JSON.stringify(geoBefore) === JSON.stringify(geoAfter),
      `${JSON.stringify(geoBefore)} -> ${JSON.stringify(geoAfter)}`);
    check(label('the price field has focus styling'), await page.evaluate(() => {
      const row = document.querySelector('.fo-priceField .fo-fieldRow');
      return getComputedStyle(row).borderTopColor !== 'rgba(0, 0, 0, 0)';
    }));
  }

  // "Последняя" fills the LAST TRADED price, not the mark price
  const lastBtn = page.locator('.fo-lastPriceBtn').first();
  if (await lastBtn.count()) {
    await priceInput.fill('1');
    await lastBtn.click();
    await page.waitForTimeout(400);
    const filled = await page.evaluate(() => ({
      value: Number(document.querySelector('.fo-priceField .fo-input')?.value),
      mark: Number(document.querySelector('.futures-secondary-price .value')?.textContent?.replace(/[^\d.]/g, '')),
    }));
    check(label('"Последняя" fills a real price'), Number.isFinite(filled.value) && filled.value > 1, `filled ${filled.value}`);
    check(label('"Последняя" fills the last traded price, not the mark price'),
      !Number.isFinite(filled.mark) || filled.mark === 0 || Math.abs(filled.value - filled.mark) > 1e-9,
      `last ${filled.value} vs mark ${filled.mark}`);
  } else {
    check(label('"Последняя" button present on a LIMIT order'), false, 'button not found');
  }

  // clicking a book level fills the price field
  const levelBefore = await page.evaluate(() => document.querySelector('.fo-priceField .fo-input')?.value);
  await page.locator('.reference-book .rb-row.bid').first().click();
  await page.waitForTimeout(500);
  const levelAfter = await page.evaluate(() => document.querySelector('.fo-priceField .fo-input')?.value);
  check(label('clicking a book level fills the price field'), levelAfter !== levelBefore && Number(levelAfter) > 0, `-> ${levelAfter}`);

  // ---------- 13. spot and CFD ----------
  for (const [surface, url, selector] of [
    ['spot', '/trade?pair=BTC%2FUSDT', '.ticker-bar'],
    ['cfd', '/trade?market=cfd', '.cfd-terminal'],
  ]) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(selector, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const g = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const price = document.querySelector('.ticker-bar .value.price');
      const arrow = document.querySelector('.pair-arrow');
      return {
        present: Boolean(root),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        priceSize: price ? parseFloat(getComputedStyle(price).fontSize) : null,
        arrowDeclared: arrow ? getComputedStyle(arrow).width : null,
      };
    }, selector);
    check(label(`${surface} terminal renders`), g.present);
    check(label(`${surface} has no horizontal overflow`), !g.overflow);
    if (g.priceSize !== null) check(label(`${surface} last price uses the shared scale`), g.priceSize <= 21, `${g.priceSize}px`);
    if (g.arrowDeclared) check(label(`${surface} chevron is a square box`), g.arrowDeclared === '6px', g.arrowDeclared);
  }

  const errors = await page.evaluate(() => window.__qaErrors || []);
  check(label('no uncaught page errors'), errors.length === 0, errors.slice(0, 3).join(' | '));

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n=== ${viewport.name} ===`);
      await run(browser, viewport);
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks PASS`);
  console.log('NOTE: depth served by a local socket speaking the venue frame shape. This is NOT a live-provider verification.');
  if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ''}`); process.exit(1); }
})();
