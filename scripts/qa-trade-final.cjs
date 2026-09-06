// Read-only QA of the actual review build. No market fixtures or account writes.
// Usage: node scripts/qa-trade-final.cjs <review-origin> [--baseline|--layout-only|--fault-only]
// Default: nine responsive widths, full user interactions at 1440 and 390px.
// --fault-only aborts one real OHLC transport temporarily, then verifies genuine recovery.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const target = (process.argv[2] || 'http://127.0.0.1:4180').replace(/\/$/, '');
const baseline = process.argv.includes('--baseline');
const layoutOnly = process.argv.includes('--layout-only');
const faultOnly = process.argv.includes('--fault-only');
const widths = [1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375];
const output = path.resolve('node_modules/.cache/trade-final-qa');
fs.mkdirSync(output, { recursive: true });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result = { target, baseline, layoutOnly, capturedAt: new Date().toISOString(), widths: [], financial: {} };
function candleIdentity(url) {
  const value = new URL(url);
  if (value.hostname !== 'api.kraken.com' || value.pathname !== '/0/public/OHLC') return null;
  const instrument = value.searchParams.get('pair');
  return instrument ? `${instrument}:${value.searchParams.get('interval')}` : null;
}
async function waitForRealChart(session, pair = 'BTC/USDT', interval = '15m') {
  const providerPair = pair.replace('BTC', 'XBT').replace('/', '');
  const minutes = { '15m': '15', '1h': '60' }[interval];
  const key = `${providerPair}:${minutes}`;
  const started = Date.now();
  while (!session.candles.has(key)) {
    if (Date.now() - started > 60000) throw new Error(`Real ${pair} ${interval} OHLC did not load; cannot verify a chart using empty/stale data`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await session.page.locator('.chart-area').getByText(`Нет данных графика для ${pair}`, { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
  const candle = session.candles.get(key);
  assert.ok(candle.count > 0 && candle.lastClose > 0);
  return candle;
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal page overflow');
}
async function markets(page) {
  const input = page.locator('.pairs-search input');
  if (!await input.isVisible()) await page.locator('.pair-identity').click();
  await input.waitFor({ state: 'visible' });
  await page.locator('.pair-row[data-pair]').first().waitFor({ timeout: 60000 });
  return input;
}
async function closeMarkets(page) {
  const close = page.getByRole('button', { name: 'Закрыть рынки', exact: true });
  if (await close.isVisible()) await close.click();
}
async function assertSorted(page, direction) {
  const rows = await page.locator('.pair-row[data-pair]').evaluateAll(nodes => nodes.map(node => {
    const change = node.querySelector('.p-change');
    const text = change.textContent.trim();
    const raw = change.getAttribute('data-change-value');
    return { pair: node.dataset.pair, text, value: raw === null || raw === '' ? (text === '—' ? null : Number(text.replace(/[^\d.\-]/g, ''))) : Number(raw) };
  }));
  assert.ok(rows.length > 1, 'Multiple real market rows are available');
  let previous = direction === 'desc' ? Infinity : -Infinity;
  let seenMissing = false;
  for (const row of rows) {
    if (row.value === null) { seenMissing = true; assert.equal(row.text, '—'); continue; }
    assert.ok(Number.isFinite(row.value), `${row.pair}: finite percentage`);
    assert.equal(seenMissing, false, 'Missing references remain after supported percentages');
    // The UI rounds to two decimals while live quotes keep ticking. Raw data attributes,
    // when available, make this exact; displayed values tolerate only rounding precision.
    assert.ok(direction === 'desc' ? row.value <= previous + 0.011 : row.value >= previous - 0.011, `${direction} sort: ${previous} then ${row.pair} ${row.value}`);
    previous = row.value;
  }
  return rows;
}
async function marketChecks(page) {
  await page.locator('.market-spine').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('/');
  await page.locator('.pairs-search input').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.pairs-search input').evaluate(node => node === document.activeElement), true, 'Slash shortcut opens/focuses pair search');
  let input = await markets(page);
  const pair = page.locator('.pair-identity strong');
  await input.fill('BTC');
  assert.ok((await page.locator('.pair-row[data-pair]').count()) > 0);
  assert.ok((await page.locator('.pair-row[data-pair]').first().getAttribute('data-pair')).includes('BTC'));
  const btc = page.locator('.pair-row[data-pair="BTC/USDT"]');
  if (!await btc.locator('.p-star').evaluate(node => node.classList.contains('on'))) await btc.locator('.p-star').click();
  await btc.click();
  assert.equal(await pair.innerText(), 'BTC/USDT');
  input = await markets(page);
  await input.fill('ETH');
  const eth = page.locator('.pair-row[data-pair="ETH/USDT"]');
  if (!await eth.locator('.p-star').evaluate(node => node.classList.contains('on'))) await eth.locator('.p-star').click();
  await eth.click();
  assert.equal(await pair.innerText(), 'ETH/USDT');
  input = await markets(page);
  await input.fill('');
  const quoteFilters = await page.locator('.pairs-tab').allTextContents();
  for (const quote of ['USDT', 'USD', 'USDC', 'EUR']) {
    const chip = page.locator('.pairs-tab').filter({ hasText: new RegExp(`^${quote}$`) });
    if (!await chip.count()) continue;
    await chip.click();
    const pairs = await page.locator('.pair-row[data-pair]').evaluateAll(nodes => nodes.map(n => n.dataset.pair));
    assert.ok(pairs.length > 0 && pairs.every(p => p.endsWith('/' + quote)), `${quote}: actual available quote filter`);
  }
  await page.locator('.pairs-tab').filter({ hasText: /^USDT$/ }).click();
  const sorting = {};
  for (const period of ['24H', '7D']) {
    const periodButton = page.locator('.pairs-periods button').filter({ hasText: new RegExp(`^${period}$`) });
    await periodButton.click();
    assert.equal(await periodButton.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => [...document.querySelectorAll('.pair-row .p-change')].some(n => n.textContent.includes('%')), null, { timeout: 90000 });
    const changeSort = page.locator('.pairs-sort [data-sort-field="change"]');
    assert.match(await changeSort.innerText(), period === '24H' ? /24ч\s*%/ : /7д\s*%/);
    // Switching period preserves the current sort. Explicitly request gainers then losers
    // from the user-visible control, inspecting its direction instead of assuming state.
    await changeSort.click();
    let dir = await changeSort.getAttribute('data-sort-dir');
    if (!dir) dir = await changeSort.evaluate(n => n.querySelector('.lucide-chevron-up') ? 'asc' : 'desc');
    const firstDirection = dir === '1' || dir === 'asc' ? 'asc' : 'desc';
    sorting[period] = { [firstDirection]: await assertSorted(page, firstDirection) };
    await changeSort.click();
    const secondDirection = firstDirection === 'desc' ? 'asc' : 'desc';
    sorting[period][secondDirection] = await assertSorted(page, secondDirection);
    await input.fill('BTC');
    assert.equal(await periodButton.getAttribute('aria-pressed'), 'true');
    await input.fill('');
    await page.locator('.pairs-tab').filter({ hasText: /Избранное/ }).click();
    const favorites = await page.locator('.pair-row[data-pair]').evaluateAll(nodes => nodes.map(n => n.dataset.pair));
    assert.deepEqual([...favorites].sort(), ['BTC/USDT', 'ETH/USDT']);
    assert.equal(await pair.innerText(), 'ETH/USDT', 'Filters and sorting retain selected instrument');
    assert.equal(await periodButton.getAttribute('aria-pressed'), 'true', 'Favorites retain performance period');
    await page.locator('.pairs-tab').filter({ hasText: /Избранное/ }).click();
    await assertSorted(page, secondDirection);
    sorting[period].formulaEvidence = await page.locator('.pair-row[data-pair]').evaluateAll(nodes => nodes.map(node => {
      const change = node.querySelector('.p-change');
      return {
        pair: node.dataset.pair,
        lastPrice: node.getAttribute('data-last-price'),
        referencePrice: change.getAttribute('data-reference-price'),
        returnPct: change.getAttribute('data-change-value'),
      };
    }).filter(row => row.lastPrice && row.referencePrice && row.returnPct));
    for (const row of sorting[period].formulaEvidence) {
      assert.ok(Math.abs((Number(row.lastPrice) / Number(row.referencePrice) - 1) * 100 - Number(row.returnPct)) < 1e-8, `${period} ${row.pair}: canonical return matches its reference price`);
    }
  }
  await noOverflow(page);
  // Restore BTC for consistent screenshots and execution/chart checks.
  await input.fill('BTC');
  await page.locator('.pair-row[data-pair="BTC/USDT"]').click();
  await closeMarkets(page);
  if (await input.isVisible()) await input.fill('');
  return { quoteFilters, sorting, search: 'BTC/ETH and / shortcut', favorites: 'persists in real client preference state', selectedPairPreserved: true };
}
async function orderChecks(page) {
  const orderTab = page.locator('.flow-tabs').getByRole('tab', { name: 'Ордер', exact: true });
  const bookTab = page.locator('.flow-tabs').getByRole('tab', { name: 'Стакан', exact: true });
  await orderTab.click();
  const form = page.locator('.order-form-content');
  const families = page.locator('.flow-pane:not([hidden]) .order-type-tabs').first();
  const tested = [];
  for (const label of ['Лимит', 'Рынок', 'Стоп', 'Тейк-профит', 'OCO']) {
    const button = families.getByRole('button', { name: label, exact: true });
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    if (label === 'OCO') assert.equal(await form.locator('input[required]').count(), 4);
    if (label === 'Рынок') assert.equal(await form.locator('input[readonly]').count(), 1);
    if (label === 'Стоп' || label === 'Тейк-профит') {
      for (const execution of ['Рынок', 'Лимит']) {
        await form.getByRole('button', { name: execution, exact: true }).click();
        assert.equal(await form.locator('input[readonly]').count(), execution === 'Рынок' ? 1 : 0);
      }
    }
    assert.equal(await form.locator('button[type="submit"]').isDisabled(), true, 'Review never enables account execution');
    tested.push(label);
  }
  await families.getByRole('button', { name: 'Лимит', exact: true }).click();
  await page.locator('.order-form-tab.sell').click();
  assert.equal(await page.locator('.order-form-tab.sell').getAttribute('aria-pressed'), 'true');
  assert.match(await form.locator('button[type="submit"]').innerText(), /Продать BTC/);
  await page.locator('.order-form-tab.buy').click();
  assert.equal(await page.locator('.order-form-tab.buy').getAttribute('aria-pressed'), 'true');
  await form.locator('input[aria-label="Цена (USDT)"]').fill('80000');
  await form.locator('input[aria-label="Количество (BTC)"]').fill('0.01');
  assert.equal(Number(await form.locator('input[aria-label="Итого (USDT)"]').inputValue()), 800);
  await bookTab.click();
  await page.locator('.orderbook-bids .ob-row').first().waitFor({ timeout: 60000 });
  assert.match(await page.locator('.ob-spread-detail').innerText(), /\d.*%/);
  const group = page.locator('.ob-group-select');
  const options = await group.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
  assert.ok(options.length >= 2);
  const originalGroup = await group.inputValue();
  const nextGroup = options.find(value => value !== originalGroup);
  await group.selectOption(nextGroup);
  assert.equal(await group.inputValue(), nextGroup);
  const levels = await page.locator('.orderbook-bids .ob-row .bid-price, .orderbook-asks .ob-row .ask-price').allTextContents();
  for (const value of levels) {
    const bucket = Number(value.replace(/,/g, '')) / Number(nextGroup);
    assert.ok(Math.abs(bucket - Math.round(bucket)) < 0.000001, `Real book grouping uses selected grid: ${value}/${nextGroup}`);
  }
  await group.selectOption(originalGroup);
  const row = page.locator('.orderbook-bids .ob-row').first();
  // Capture at pointerdown, the same actual DOM level the click handler receives.
  const price = await row.locator('.bid-price').innerText();
  await row.click();
  assert.equal(await orderTab.getAttribute('aria-selected'), 'true');
  const selected = Number(await form.locator('input[aria-label="Цена (USDT)"]').inputValue());
  assert.ok(Number.isFinite(selected) && selected > 0);
  assert.ok(Math.abs(selected - Number(price.replace(/,/g, ''))) / selected < 0.001, 'Book row fills its live price, allowing a concurrent tick');
  assert.equal(await families.getByRole('button', { name: 'Лимит', exact: true }).getAttribute('aria-pressed'), 'true');
  await noOverflow(page);
  return { families: tested, buySell: true, draftTotal: 800, selectedBookPrice: selected, grouping: [originalGroup, nextGroup], accountSubmission: 'disabled in review; no live orders sent' };
}
async function chartChecks(page, width, session) {
  const timeframes = page.locator('.chart-tabs');
  for (const frame of ['1h', '15m']) {
    const button = timeframes.getByRole('button', { name: frame, exact: true });
    await button.click();
    assert.ok((await button.getAttribute('class')).includes('active'));
    await waitForRealChart(session, 'BTC/USDT', frame);
  }
  const tools = page.locator('.chart-tools');
  for (const label of ['Линия', 'Свечи', 'MA200', 'Bollinger', 'RSI', 'MACD']) {
    const button = tools.getByRole('button', { name: label, exact: true });
    const initial = (await button.getAttribute('class')).includes('active');
    await button.click();
    if (!['Линия', 'Свечи'].includes(label)) {
      assert.notEqual((await button.getAttribute('class')).includes('active'), initial);
      await button.click();
    }
  }
  const drawing = { toolbarReachable: true, created: false };
  for (const label of ['Курсор', 'Линия тренда', 'Прямоугольник', 'Показать всё']) {
    assert.equal(await page.locator('.draw-toolbar').getByRole('button', { name: label, exact: true }).isVisible(), true);
  }
  if (width === 1440 || width === 390) {
    await page.locator('.draw-toolbar').getByRole('button', { name: 'Показать всё', exact: true }).click();
    await page.locator('.draw-toolbar').getByRole('button', { name: 'Прямоугольник', exact: true }).click();
    const overlay = page.locator('.drawing-overlay');
    await overlay.scrollIntoViewIfNeeded();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.60, box.y + box.height * 0.55, { steps: 12 });
    await page.mouse.up();
    await overlay.locator('rect[stroke="#5b8def"]').waitFor({ timeout: 10000 });
    drawing.created = true;
    await page.locator('.draw-toolbar').getByRole('button', { name: 'Скрыть рисунки', exact: true }).click();
    assert.equal(await overlay.isVisible(), false);
    await page.locator('.draw-toolbar').getByRole('button', { name: 'Показать рисунки', exact: true }).click();
    assert.equal(await overlay.locator('rect[stroke="#5b8def"]').count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.draw-toolbar').getByRole('button', { name: 'Удалить все рисунки', exact: true }).click();
    assert.equal(await overlay.locator('rect[stroke="#5b8def"]').count(), 0);
  }
  await noOverflow(page);
  return { timeframes: ['1h', '15m'], indicators: ['MA200', 'Bollinger', 'RSI', 'MACD'], styles: ['Линия', 'Свечи'], drawing };
}
async function dockChecks(page) {
  const tabs = page.locator('.dock-tabs [role="tab"]');
  const labels = await tabs.allTextContents();
  assert.equal(labels.length, 3);
  for (let i = 0; i < labels.length; i++) {
    await tabs.nth(i).click();
    assert.equal(await tabs.nth(i).getAttribute('aria-selected'), 'true');
    assert.ok((await page.locator('#terminal-dock-content').innerText()).length > 0);
  }
  await tabs.first().click();
  assert.equal(await page.locator('.dock-tabs .badge').innerText(), '0');
  await page.locator('.open-orders-empty').waitFor();
  await noOverflow(page);
  return { tabs: labels, emptyState: true, populatedAccountTables: 'Not exercised: isolated review has no real account positions or orders' };
}
async function chartFailureCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('exchange_lang', 'ru'));
  const page = await context.newPage();
  const errors = [], writes = [];
  let blocked = 0;
  const isBtcChart = url => candleIdentity(url) === 'XBTUSDT:15';
  const block = async route => { blocked++; await route.abort('failed'); };
  page.on('pageerror', error => errors.push({ type: 'pageerror', text: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', text: message.text(), url: message.location().url }); });
  page.on('request', request => { if (request.url().startsWith(target) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url()); });
  async function readCandle(response) {
    const envelope = await response.json();
    assert.deepEqual(envelope.error, []);
    const rows = Object.values(envelope.result || {}).find(Array.isArray);
    assert.ok(rows?.length > 0);
    return { count: rows.length, lastClose: Number(rows.at(-1)[4]), source: response.url() };
  }
  try {
    // Inject only a transport outage, never synthetic prices or a replacement payload.
    // ETH is first loaded from the real provider, then the distinct BTC history is blocked.
    await page.route(isBtcChart, block);
    const ethResponse = page.waitForResponse(response => candleIdentity(response.url()) === 'ETHUSDT:15' && response.ok(), { timeout: 90000 });
    await page.goto(target + '/trade?pair=ETH/USDT', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const eth = await readCandle(await ethResponse);
    await page.locator('.chart-area').getByText('Нет данных графика для ETH/USDT', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
    await page.locator('.pair-identity strong').getByText('ETH/USDT', { exact: true }).waitFor();
    const search = await markets(page);
    await search.fill('BTC');
    const blockedRequest = page.waitForRequest(request => isBtcChart(request.url()), { timeout: 60000 });
    await page.locator('.pair-row[data-pair="BTC/USDT"]').click();
    await blockedRequest;
    assert.equal(await page.locator('.pair-identity strong').innerText(), 'BTC/USDT');
    await page.locator('.chart-area').getByText('Нет данных графика для BTC/USDT', { exact: true }).waitFor({ timeout: 60000 });
    assert.ok(blocked > 0);
    const emptyAppearance = await page.locator('.spot-chart-empty').evaluate(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const contains = point => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      const canvasCenters = [...node.parentElement.querySelectorAll('canvas')].map(canvas => canvas.getBoundingClientRect())
        .filter(box => box.width > 0 && box.height > 0)
        .map(box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
      const label = node.querySelector('span').getBoundingClientRect();
      return {
        zIndex: style.zIndex, background: style.backgroundColor, opacity: style.opacity,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        canvasCount: canvasCenters.length, coversCanvasCenters: canvasCenters.every(contains),
        labelInside: contains({ x: label.x + label.width / 2, y: label.y + label.height / 2 }),
      };
    });
    assert.ok(Number(emptyAppearance.zIndex) > 2, 'Actual no-data explanation paints above chart canvases');
    assert.ok(emptyAppearance.background.startsWith('rgb(') || /rgba\(.*,[\s]*1\)$/.test(emptyAppearance.background), 'Opaque chart background covers stale instrument axes');
    assert.equal(emptyAppearance.opacity, '1');
    assert.ok(emptyAppearance.canvasCount > 0);
    assert.equal(emptyAppearance.coversCanvasCenters, true);
    assert.equal(emptyAppearance.labelInside, true);
    await page.screenshot({ path: path.join(output, 'fault-empty-btc.png'), fullPage: true });
    const btcResponse = page.waitForResponse(response => isBtcChart(response.url()) && response.ok(), { timeout: 90000 });
    await page.unroute(isBtcChart, block);
    const btc = await readCandle(await btcResponse);
    await page.locator('.chart-area').getByText('Нет данных графика для BTC/USDT', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 });
    const headerPrice = Number((await page.locator('.spine-price > strong').innerText()).replace(/,/g, ''));
    assert.ok(Number.isFinite(headerPrice) && headerPrice > 0);
    assert.ok(Math.abs(btc.lastClose / headerPrice - 1) < 0.05, 'Recovered real BTC history matches the current BTC instrument price');
    assert.ok(Math.abs(eth.lastClose / btc.lastClose - 1) > 0.5, 'ETH and BTC histories are genuinely distinct, not a reused price curve');
    await noOverflow(page);
    await page.screenshot({ path: path.join(output, 'fault-recovered-btc.png'), fullPage: true });
    const expectedErrors = errors.filter(error => (error.url && isBtcChart(error.url) && /ERR_FAILED/.test(error.text))
      // Chromium can emit both ERR_FAILED and its CORS diagnostic for the
      // same intentionally aborted read. Only this exact injected URL is expected.
      || (blocked > 0 && /Access to fetch at 'https:\/\/api\.kraken\.com\/0\/public\/OHLC\?pair=XBTUSDT&interval=15'.*blocked by CORS/.test(error.text))
      || (error.url === target + '/favicon.ico' && /404/.test(error.text)));
    assert.deepEqual(errors.filter(error => !expectedErrors.includes(error)), [], 'No application errors during the isolated transport-failure exercise');
    assert.deepEqual(writes, []);
    console.log('Transport fault QA: real ETH → blocked BTC shows empty state → actual BTC recovers; no stale ETH chart or account writes');
    return { eth, btc, blockedRequests: blocked, emptyAppearance, showedCorrectBtcEmptyState: true, actualBtcRecovered: true, errors, writes };
  } finally { await context.close(); }
}
async function geometry(page) {
  return page.evaluate(() => {
    const bounds = selector => {
      const node = document.querySelector(selector);
      if (!node || !node.getClientRects().length) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      markets: bounds('.markets-panel') || bounds('.pairs-section'), chart: bounds('.chart-area'),
      rail: bounds('.flow-rail'), dock: bounds('.trading-dock'),
      canvasCount: document.querySelectorAll('.chart-area canvas').length,
      railTabs: [...document.querySelectorAll('.flow-tabs [role="tab"]')].map(n => n.textContent.trim()),
      dockTabs: [...document.querySelectorAll('.dock-tabs [role="tab"]')].map(n => n.textContent.trim()),
      marketSpine: document.querySelector('.market-spine')?.innerText,
      connection: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(n => n.textContent.trim()),
    };
  });
}
async function capture(browser, width, session) {
  const first = !session.page;
  if (first) {
    session.context = await browser.newContext({ viewport: { width, height: 1080 }, reducedMotion: 'reduce' });
    await session.context.addInitScript(() => localStorage.setItem('exchange_lang', 'ru'));
    session.page = await session.context.newPage();
    session.websocket = [];
    session.candles = new Map();
    session.page.on('response', async response => {
      const key = candleIdentity(response.url());
      if (!key || !response.ok()) return;
      try {
        const envelope = await response.json();
        if (envelope.error?.length) return;
        const candles = Object.values(envelope.result || {}).find(Array.isArray);
        if (candles?.length) session.candles.set(key, { count: candles.length, lastClose: Number(candles.at(-1)[4]), receivedAt: new Date().toISOString(), url: response.url() });
      } catch { /* Unreadable provider payload remains unavailable, never fabricated. */ }
    });
  }
  const page = session.page;
  const errors = [], failedRequests = [], accountWrites = [];
  const onPageError = error => errors.push({ type: 'pageerror', text: error.message });
  const onConsole = message => { if (message.type() === 'error') errors.push({ type: 'console', text: message.text(), url: message.location().url }); };
  const onFailure = request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
  const onRequest = request => { if (request.url().startsWith(target) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) accountWrites.push({ method: request.method(), url: request.url() }); };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onFailure);
  page.on('request', onRequest);
  if (first) page.on('websocket', socket => {
    const item = { url: socket.url(), receivedFrames: 0, error: null, closed: false };
    session.websocket.push(item);
    socket.on('framereceived', () => item.receivedFrames++);
    socket.on('socketerror', error => item.error = String(error));
    socket.on('close', () => item.closed = true);
  });
  if (first) await page.goto(`${target}/trade`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  else {
    await page.setViewportSize({ width, height: 1080 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await page.locator('.trade-terminal').waitFor({ timeout: 120000 });
  await page.locator('.chart-area canvas').first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.spine-price > strong')?.textContent !== '—', null, { timeout: 60000 });
  if (!baseline) await waitForRealChart(session);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-${width}.png`), fullPage: true });
  const snapshot = await geometry(page);
  snapshot.errors = errors;
  snapshot.failedRequests = failedRequests;
  snapshot.accountWrites = accountWrites;
  result.widths.push(snapshot);
  if (!baseline) {
    assert.equal(snapshot.scrollWidth, width, `${width}: no page overflow`);
    assert.deepEqual(snapshot.railTabs, ['Ордер', 'Стакан']);
    assert.equal(await page.locator('.workspace-controls, .market-commands').count(), 0);
    assert.doesNotMatch(await page.locator('.trade-terminal').innerText(), /Kraken|Best\s*bid|Best\s*ask|Public Kraken depth/i);
    assert.doesNotMatch(await page.locator('.review-notice').innerText(), /Kraken/i);
    assert.match(await page.locator('.review-notice').innerText(), /VOLTEX\s*·\s*REVIEW/);
    assert.match(await page.locator('.review-notice').innerText(), /Операции с аккаунтом отключены/);
    if (width > 1024) {
      assert.ok(snapshot.markets && snapshot.markets.width >= 220 && snapshot.markets.width <= 260, 'Persistent desktop markets column is 220–260px');
      assert.ok(snapshot.markets.x < snapshot.chart.x && snapshot.chart.x < snapshot.rail.x, 'Desktop order is Markets → Chart → Execution');
      assert.ok(snapshot.dock.height >= 150 && snapshot.dock.height <= 210, 'Empty desktop dock remains compact');
      assert.ok(snapshot.dock.width >= width - 2, 'Desktop bottom dock spans the workspace');
      assert.equal(await page.getByRole('button', { name: 'Свернуть рынки', exact: true }).isVisible(), false);
    }
    if (!layoutOnly && [1440, 390].includes(width)) {
      snapshot.marketsQA = await marketChecks(page);
      snapshot.realChart = await waitForRealChart(session);
      snapshot.ordersQA = await orderChecks(page);
      snapshot.chartQA = await chartChecks(page, width, session);
      snapshot.dockQA = await dockChecks(page);
    }
    await page.locator('.pair-identity').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `after-tested-${width}.png`), fullPage: true });
    snapshot.knownFaviconErrors = errors.filter(error => error.url === target + '/favicon.ico' && /404/.test(error.text));
    snapshot.marketConnectivityErrors = errors.filter(error => /WebSocket connection.*ws\.kraken\.com.*failed/i.test(error.text)
      || /Access to fetch at 'https:\/\/api\.kraken\.com\/.*blocked by CORS/.test(error.text)
      || (error.url?.startsWith('https://api.kraken.com/') && /Failed to load resource/.test(error.text)));
    const applicationErrors = errors.filter(error => !snapshot.knownFaviconErrors.includes(error) && !snapshot.marketConnectivityErrors.includes(error));
    assert.deepEqual(applicationErrors, [], `${width}: no application console or page errors`);
    assert.deepEqual(accountWrites, [], 'No account/order write request sent');
    await noOverflow(page);
  }
  snapshot.errors = errors;
  snapshot.failedRequests = failedRequests;
  snapshot.websocket = structuredClone(session.websocket);
  snapshot.accountWrites = accountWrites;
  snapshot.visibleText = await page.locator('.trade-terminal').innerText();
  console.log(`${baseline ? 'BASELINE' : 'QA'} ${width}: overflow=${snapshot.scrollWidth > width}, chart canvases=${snapshot.canvasCount}, WS frames=${session.websocket.reduce((n,s)=>n+s.receivedFrames,0)}, market errors=${snapshot.marketConnectivityErrors?.length || 0}`);
  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  page.off('requestfailed', onFailure);
  page.off('request', onRequest);
}
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const session = {};
  try {
    if (faultOnly) {
      result.faultInjection = await chartFailureCheck(browser);
      return;
    }
    // One genuine browser session resized across breakpoints preserves existing
    // market/cache state and avoids repeatedly hammering the external data provider.
    for (const width of widths) await capture(browser, width, session);
    const request = await browser.newContext();
    for (const route of ['/review-synthetic.json', '/review-api/copy-trading/ksenia']) {
      const response = await request.request.get(target + route, { timeout: 120000 });
      assert.equal(response.status(), 200, route);
      result.financial[route] = hash(await response.json());
    }
    if (!baseline) {
      const before = JSON.parse(fs.readFileSync(path.join(output, 'baseline.json'), 'utf8'));
      assert.deepEqual(result.financial, before.financial, 'Nazar and Ksenia canonical outputs are exactly preserved');
      result.providerWarningCount = result.widths.reduce((count, row) => count + (row.marketConnectivityErrors?.length || 0), 0);
      result.status = result.providerWarningCount
        ? 'Assertions passed; provider connectivity warnings require separate visual verification of the current instrument chart'
        : layoutOnly ? 'Responsive layout assertions passed' : 'Responsive and functional assertions passed';
      console.log(result.status);
    }
    await request.close();
  } finally {
    fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : faultOnly ? 'fault-result.json' : layoutOnly ? 'layout-interim.json' : 'result.json'), JSON.stringify(result, null, 2));
    await session.context?.close();
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
