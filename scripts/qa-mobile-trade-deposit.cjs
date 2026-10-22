#!/usr/bin/env node
'use strict';
/**
 * MOBILE SPOT / FUTURES / DEPOSIT — the owner's 2026-10-04 reference, measured
 * in a real browser on the real production bundle.
 *
 * LOCAL PRESENTATION QA ONLY. Synthetic read-only fixture
 * (qa-mobile-trade-fixture.cjs): invented prices, balances and deposit
 * addresses; every non-GET is refused; the browser can reach nothing but the
 * fixture. No order, transfer or copy event leaves the machine.
 *
 * What is checked, as numbers rather than impressions:
 *   · phones 320×568, 360×800, 390×844, 430×932 — «Спот / Фьючерсы», Wallet
 *     and a labelled «Депозит» in the header, the book and the ticket side by
 *     side without overlap, every CTA reachable and not covered, positions /
 *     orders right after the CTAs, the chart one tap away, no sideways scroll;
 *   · picking a pair (and the SAME pair) closes the picker and lands on Trade;
 *     back / forward / reload and fast switching never show the previous
 *     pair's figures;
 *   · a Spot-only pair is not turned into a perpetual: Futures opens its
 *     picker with a note instead; a listing still counting down keeps its
 *     countdown in view and its ticket refuses;
 *   · deposit from the header and from the Futures account block opens the
 *     same dialog; it starts WITHOUT a QR; asset search, network choice, a
 *     required memo, exact-bytes copy, a failed clipboard (no success, no
 *     copy event), a destination switched mid-copy, a session switched
 *     mid-copy (no event for the other user), the optional QR, Escape;
 *     closing keeps the terminal as it was;
 *   · desktop 1366 / 1440 / 1920 — no phone controls, the three-column
 *     terminal and the header deposit still work;
 *   · guest, six languages and a sub-cent price do not break the header or
 *     the page width;
 *   · with --before <dist>, the requests a phone terminal makes while idle
 *     are compared with main's: the new UI may not add an endpoint.
 *
 *   node scripts/qa-mobile-trade-deposit.cjs [--dist frontend/dist] [--before dist]
 *        [--out dir] [--browsers chromium,webkit]
 *
 * Build the bundle with VITE_MANUAL_DEPOSIT_CATALOGUE=true (production's
 * deposit dialog). WebKit runs only where it is installed; when it is not,
 * the report says so — Chromium is never presented as Safari.
 */
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const playwright = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { createFixture, fixtureContext, qaToken, DEPOSIT } = require('./qa-mobile-trade-fixture.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const DIST = path.resolve(arg('dist', path.join(__dirname, '../frontend/dist')));
const BEFORE = arg('before', null);
const OUT = path.resolve(arg('out', process.env.QA_OUT || path.join(__dirname, '../output/mobile-trade-deposit')));
const BROWSERS = arg('browsers', 'chromium,webkit').split(',');
const PHONES = [[320, 568], [360, 800], [390, 844], [430, 932]];
const DESKTOPS = [[1366, 768], [1440, 900], [1920, 1080]];
const SPOT = '/trade?pair=BTC%2FUSDT';
const FUTURES = '/futures?pair=BTC%2FUSDT';
const address = (asset, networkId) => DEPOSIT.find(e => e.asset === asset && e.networkId === networkId).address;

const results = [];
let scope = '';
function check(ok, label, detail) {
  results.push({ ok: Boolean(ok), label: `${scope}: ${label}`, detail: ok ? undefined : detail });
  if (!ok) console.log(`  ✗ ${scope}: ${label}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`);
}

async function serve(dist, options = {}) {
  const fixture = createFixture({ dist, ...options });
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { ...fixture, server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function open(browser, fx, url, { width, height, guest = false, lang = 'ru' }) {
  const context = await fixtureContext(browser, fx.origin, { width, height, guest, lang, touch: width <= 900 });
  const page = await context.newPage();
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  page.on('request', request => { if (request.method() !== 'GET' && request.method() !== 'HEAD') posts.push(new URL(request.url()).pathname); });
  await page.goto(fx.origin + url, { waitUntil: 'domcontentloaded' });
  return { context, page, errors, posts };
}

const futuresPage = url => url.startsWith('/futures');
async function settle(page, url) {
  const rows = futuresPage(url) ? '.rb-row:not(.is-placeholder)' : '.orderbook-area .ob-row';
  // Futures' REST book arrives on its fallback poll a few seconds in.
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)]
    .filter(row => /\d/.test(row.textContent || '')).length >= 4, rows, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/** Everything the phone header and workspace checks need, in page coordinates. */
function measure(page) {
  return page.evaluate(() => {
    const visible = el => {
      if (!el) return false;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const box = el => {
      if (!visible(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height, right: r.right, bottom: r.bottom + scrollY };
    };
    const q = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const book = q('.orderbook-area');
    const rows = all('.orderbook-area .ob-row, .orderbook-area .rb-row:not(.is-placeholder)').filter(row => {
      if (!visible(row) || !book) return false;
      const r = row.getBoundingClientRect(), b = book.getBoundingClientRect();
      return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    });
    return {
      vw: document.documentElement.clientWidth,
      vh: innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tab: q('.terminal')?.getAttribute('data-mobile-tab') ?? null,
      switchBox: box(q('.global-header .terminal-market-switch')),
      options: all('.global-header .terminal-market-option').map(o => ({ text: o.textContent.trim(), active: o.classList.contains('is-active'),
        href: o.getAttribute('href'), box: box(o), clipped: o.scrollWidth > o.clientWidth + 1 })),
      wallet: box(q('.global-header .nav-wallet-link')),
      walletName: q('.global-header .nav-wallet-link')?.textContent.trim() || q('.global-header .nav-wallet-link')?.getAttribute('aria-label') || '',
      deposit: box(q('.global-header .deposit-button')),
      depositText: q('.global-header .deposit-button')?.textContent.trim() ?? null,
      book: box(book),
      bookRows: rows.length,
      form: box(q('.order-form-area')),
      chart: box(q('.chart-area')),
      ctas: all('.order-form-area .submit-btn').filter(visible).map(b => ({ text: b.textContent.trim(), box: box(b) })),
      orderTypeControls: all('.order-form-area :is(.order-family-select select, .order-family-tabs, .order-type-select select, .order-type-tabs)').filter(visible).length,
      positions: box(q('.bottom-panel')),
      pairName: q('.ticker-bar .pair-name')?.textContent.trim() ?? null,
      price: q('.ticker-bar .value.price, .ticker-bar .price')?.textContent.trim() ?? null,
    };
  });
}

const overlaps = (a, b) => a && b && a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;

/** The control is on screen after scrolling to it, and a tap at its centre hits it. */
async function reachable(page, locator) {
  if (!(await locator.count())) return { ok: false, why: 'missing' };
  await locator.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  return locator.first().evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const ok = r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit));
    return { ok, why: ok ? null : { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 50)}` : null } };
  });
}

/** The same, starting with the control just peeking above the fold: the
 *  minimal scroll must stop above the fixed bottom bar, not under it. */
async function reachableFromBelow(page, locator) {
  await locator.first().evaluate(el => { const r = el.getBoundingClientRect(); scrollBy(0, r.top - (innerHeight - 20)); });
  return reachable(page, locator);
}

async function phoneWorkspace(browser, fx, [width, height], name, url) {
  scope = `${name} ${width}×${height}`;
  const { context, page, errors } = await open(browser, fx, url, { width, height });
  await settle(page, url);
  const m = await measure(page);
  check(m.tab === 'trade', 'opens on the Trade workspace', m.tab);
  check(m.switchBox && m.options.length === 2, '«Спот / Фьючерсы» is visible', m.options);
  check(m.options.every(o => o.box && o.box.h >= 44 && o.box.x >= 0 && o.box.right <= m.vw + 0.5 && !o.clipped), 'both switch options are whole 44px targets on screen', m.options);
  check(m.options.every(o => o.box && m.switchBox && o.box.x >= m.switchBox.x - 0.5 && o.box.right <= m.switchBox.right + 0.5), 'both options sit inside the switch', { s: m.switchBox, o: m.options.map(o => o.box) });
  check(m.options.find(o => o.active)?.text === (name === 'Spot' ? 'Спот' : 'Фьючерсы'), 'the current market is the selected half', m.options);
  check(m.wallet && m.wallet.h >= 44 && m.wallet.w >= 44 && m.wallet.right <= m.vw + 0.5, 'Wallet is a visible 44px target', m.wallet);
  check(m.deposit && m.deposit.h >= 44 && m.deposit.right <= m.vw + 0.5 && m.depositText === 'Депозит', 'a labelled «Депозит» of at least 44px', { box: m.deposit, text: m.depositText });
  check(![m.switchBox, ...m.options.map(o => o.box)].some(b => overlaps(b, m.wallet) || overlaps(b, m.deposit)) && !overlaps(m.wallet, m.deposit), 'header controls do not overlap', { s: m.switchBox, o: m.options.map(o => o.box), w: m.wallet, d: m.deposit });
  check(m.book && m.form, 'book and ticket are both visible', { book: m.book, form: m.form });
  if (m.book && m.form) {
    check(m.book.right <= m.form.x + 1 && Math.abs(m.book.y - m.form.y) <= 2, 'book on the left, ticket on the right, same top', { book: m.book, form: m.form });
    check(m.book.w >= m.vw * 0.33 && m.book.w <= m.vw * 0.45, 'book takes about 40% of the width', Math.round(m.book.w / m.vw * 100));
  }
  check(m.bookRows >= 6, 'at least six price levels are readable in the book', m.bookRows);
  check(m.orderTypeControls === 1, 'one compact order-type control', m.orderTypeControls);
  check(m.ctas.length === (name === 'Spot' ? 1 : 2), name === 'Spot' ? 'the Buy/Sell CTA renders' : 'Long and Short render', m.ctas.map(c => c.text));
  for (const [index, cta] of m.ctas.entries()) {
    const hit = await reachable(page, page.locator('.order-form-area .submit-btn').nth(index));
    check(hit.ok, `«${cta.text}» is reachable and not covered`, hit.why);
    const fromBelow = await reachableFromBelow(page, page.locator('.order-form-area .submit-btn').nth(index));
    check(fromBelow.ok, `«${cta.text}» scrolled up from below the fold stops above the bottom bar`, fromBelow.why);
  }
  const last = m.ctas.at(-1)?.box;
  check(m.positions && last && m.positions.y >= last.bottom - 1, 'positions / orders follow the CTAs', { positions: m.positions, cta: last });
  check(m.overflowX <= 0, 'no sideways page scroll', m.overflowX);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, `after-${name.toLowerCase()}-${width}.png`) });
  if (width === 390 || width === 320) await page.screenshot({ path: path.join(OUT, `after-${name.toLowerCase()}-${width}-full.png`), fullPage: true });
  // The chart is one tap away, and back.
  const prefix = name === 'Spot' ? 'mobile-trade' : 'mobile-futures';
  await page.locator(`#${prefix}-chart`).click();
  await page.waitForTimeout(500);
  const chart = await measure(page);
  check(chart.tab === 'chart' && chart.chart && chart.chart.h >= 150, 'the chart is one tap away', { tab: chart.tab, chart: chart.chart });
  await page.locator(`#${prefix}-trade`).click();
  await page.waitForTimeout(300);
  const back = await measure(page);
  check(back.tab === 'trade' && back.form, 'and one tap back to the ticket', back.tab);
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function pairPicking(browser, fx, [width, height]) {
  scope = `Spot pairs ${width}`;
  let { context, page, errors } = await open(browser, fx, SPOT, { width, height });
  await settle(page, SPOT);
  const pick = async (base) => {
    await page.locator('.ticker-bar .pair-selector').click();
    await page.locator('.left-panel .pair-select').filter({ hasText: base }).first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.left-panel .pair-select').filter({ hasText: base }).first().click();
    await page.waitForTimeout(500);
    return measure(page);
  };
  let m = await pick('ETH');
  check(new URL(page.url()).searchParams.get('pair') === 'ETH/USDT' && m.pairName === 'ETH/USDT', 'picking ETH opens ETH', { url: page.url(), pair: m.pairName });
  check(m.tab === 'trade' && !(await page.locator('.left-panel').isVisible()), 'the list closes onto the ticket', m.tab);
  m = await pick('ETH');
  check(m.tab === 'trade' && m.pairName === 'ETH/USDT' && !(await page.locator('.left-panel').isVisible()), 'picking the SAME pair also closes the list', m.tab);
  // Fast switching ends on the last pick with that pair's own figures.
  for (const base of ['SOL', 'BTC', 'ETH']) {
    await page.locator('.ticker-bar .pair-selector').click();
    await page.locator('.left-panel .pair-select').filter({ hasText: base }).first().click();
  }
  await settle(page, SPOT);
  m = await measure(page);
  check(m.pairName === 'ETH/USDT' && /^3[,\s ]?1\d\d/.test(m.price || ''), 'fast switching ends on ETH with ETH figures', { pair: m.pairName, price: m.price });
  const bestAsk = await page.locator('.orderbook-area .ob-row').first().textContent();
  check(/3[,\s ]?1\d\d/.test(bestAsk || ''), 'the book shows ETH levels, not BTC', bestAsk);
  // Back / forward / reload across the «Спот / Фьючерсы» switch: each page
  // shows the pair in its address, with that pair's figures.
  await page.locator('.terminal-market-option[data-market-switch=futures]').click();
  await page.waitForURL(/\/futures/);
  await settle(page, FUTURES);
  for (const [step, expect] of [['back', '/trade'], ['forward', '/futures'], ['reload', '/futures']]) {
    if (step === 'back') await page.goBack(); else if (step === 'forward') await page.goForward(); else await page.reload();
    await settle(page, expect === '/trade' ? SPOT : FUTURES);
    m = await measure(page);
    const url = new URL(page.url());
    check(url.pathname === expect && url.searchParams.get('pair') === 'ETH/USDT' && (m.pairName || '').startsWith('ETH/USDT') && /^3[,\s ]?1\d\d/.test(m.price || ''),
      `${step}: ${expect} shows ETH/USDT with ETH figures`, { url: page.url(), pair: m.pairName, price: m.price });
  }
  check(errors.length === 0, 'no page errors', errors);
  await context.close();

  scope = `Futures pairs ${width}`;
  ({ context, page, errors } = await open(browser, fx, FUTURES, { width, height }));
  await settle(page, FUTURES);
  const pickFutures = async (base) => {
    await page.locator('.ticker-bar .pair-selector').click();
    const dialog = page.locator('dialog.reference-market-dialog[open]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    await dialog.locator('.pair-row').filter({ hasText: base }).first().click();
    await page.waitForTimeout(500);
    return { m: await measure(page), open: await dialog.count() };
  };
  let r = await pickFutures('ETH');
  check(r.open === 0 && r.m.tab === 'trade' && new URL(page.url()).searchParams.get('pair') === 'ETH/USDT', 'picking ETH closes the chooser onto the ticket', { open: r.open, tab: r.m.tab, url: page.url() });
  r = await pickFutures('ETH');
  check(r.open === 0 && r.m.tab === 'trade', 'picking the SAME contract also closes the chooser', { open: r.open, tab: r.m.tab });
  await page.keyboard.press('Escape');
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function crossMarket(browser, fx, [width, height]) {
  scope = `Spot→Futures ${width}`;
  const { context, page, errors } = await open(browser, fx, '/trade?pair=PEPE%2FUSDT', { width, height });
  await settle(page, '/trade');
  const href = await page.locator('.terminal-market-option[data-market-switch=futures]').getAttribute('href');
  check(href === '/futures?from=PEPE%2FUSDT', 'a Spot-only pair travels as ?from=, not ?pair=', href);
  await page.locator('.terminal-market-option[data-market-switch=futures]').click();
  await page.waitForURL(/\/futures/);
  await page.waitForTimeout(2500);
  const url = new URL(page.url());
  const note = page.locator('.terminal-switch-note').filter({ hasText: 'PEPE/USDT' });
  check(!url.searchParams.has('from') && url.searchParams.get('pair') !== 'PEPE/USDT', 'Futures does not invent PEPE/USDT', page.url());
  check(await page.locator('dialog.reference-market-dialog[open]').count() === 1 && await note.first().isVisible(), 'the contract chooser opens with a note', await note.count());
  const pepeReads = fx.state.requests.filter(q => /PEPE/i.test(q.path) && /futures|perp|linear/i.test(q.path)).map(q => q.path);
  check(pepeReads.length === 0, 'no Futures read for PEPE', pepeReads);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await measure(page)).form, 'closing the chooser leaves a working terminal', null);
  // Back the other way with a pair both markets list.
  await page.goto(fx.origin + '/futures?pair=ETH%2FUSDT');
  await settle(page, FUTURES);
  await page.locator('.terminal-market-option[data-market-switch=spot]').click();
  await page.waitForURL(/\/trade/);
  await settle(page, SPOT);
  scope = `Futures→Spot ${width}`;
  check((await measure(page)).pairName === 'ETH/USDT', 'ETH/USDT carries over to Spot', page.url());
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function prelisting(browser, fx, [width, height]) {
  scope = `Prelisting VTA ${width}`;
  const { context, page, errors, posts } = await open(browser, fx, '/trade?pair=VTA%2FUSDT', { width, height });
  await page.locator('.vta-countdown').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const timer = await page.locator('.vta-countdown').first().boundingBox().catch(() => null);
  const m = await measure(page);
  check(m.tab === 'chart' && timer && timer.y + timer.height <= height, 'the countdown is on the first screen', { tab: m.tab, timer });
  await page.screenshot({ path: path.join(OUT, `after-prelisting-${width}.png`) });
  await page.locator('#mobile-trade-trade').click();
  await page.waitForTimeout(300);
  const qty = page.locator('.order-form-area input').nth(1);
  if (await qty.count()) await qty.fill('10').catch(() => {});
  const buy = page.locator('.order-form-area .submit-btn').first();
  if (await buy.isEnabled().catch(() => false)) await buy.click();
  await page.waitForTimeout(800);
  check(posts.filter(p => /order/i.test(p)).length === 0, 'the ticket does not send an order before listing', posts);
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function deposit(browser, fx, [width, height], full) {
  scope = `Deposit ${width}`;
  const { context, page, errors, posts } = await open(browser, fx, SPOT, { width, height });
  await settle(page, SPOT);
  const priceInput = page.locator('.order-form-area input').first();
  await priceInput.fill('12345');
  const before = { url: page.url(), pair: (await measure(page)).pairName };
  await page.locator('.global-header .deposit-button:visible').first().click();
  const overlay = page.locator('.dc-overlay');
  await page.getByTestId('deposit-address').waitFor({ state: 'visible', timeout: 10000 });
  const sheet = await page.locator('.dc-dialog').boundingBox();
  check(await overlay.getAttribute('data-tone') === 'terminal', 'the dialog takes the terminal theme', await overlay.getAttribute('data-tone'));
  check(await page.locator('.dc-qr').count() === 0, 'no QR on the first screen', null);
  check(width > 600 || (sheet && Math.abs(sheet.y + sheet.height - height) <= 1 && sheet.width >= width - 1), 'a bottom sheet on a phone', sheet);
  check((await page.getByTestId('deposit-address').textContent()) === address('USDT', 'tron'), 'USDT · Tron address first', await page.getByTestId('deposit-address').textContent());
  const copyButton = page.locator('.dc-copy-row .dc-primary');
  const reach = await reachable(page, copyButton);
  check(reach.ok, '«Копировать адрес» is reachable', reach.why);
  const addressClip = await page.getByTestId('deposit-address').evaluate(el => el.scrollWidth - el.clientWidth);
  check(addressClip <= 1, 'the long address wraps instead of being cut', addressClip);
  await page.screenshot({ path: path.join(OUT, `after-deposit-${width}.png`) });
  if (full) {
    // Asset search.
    await page.locator('.dc-asset-trigger').click();
    await page.locator('.dc-menu').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(OUT, `after-deposit-assets-${width}.png`) });
    await page.locator('.dc-search input').fill('xr');
    const shown = await page.locator('.dc-asset-row strong').allTextContents();
    check(shown.length === 1 && shown[0] === 'XRP', 'search narrows the assets', shown);
    await page.locator('.dc-asset-row').first().click();
    await page.locator('.dc-memo').waitFor({ state: 'visible' });
    check(await page.locator('.dc-memo-required').isVisible(), 'the Destination Tag is marked required', null);
    check((await page.locator('.dc-memo .dc-address').textContent()) === '4410029', 'the tag is shown exactly', await page.locator('.dc-memo .dc-address').textContent());
    await page.locator('.dc-memo').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `after-deposit-memo-${width}.png`) });
    // Network choice.
    await page.locator('.dc-asset-trigger').click();
    await page.locator('.dc-search input').fill('usdt');
    await page.locator('.dc-asset-row').filter({ hasText: 'USDT' }).first().click();
    const networks = page.locator('.dc-network-option');
    check(await networks.count() === 3, 'USDT offers its three networks', await networks.count());
    await networks.filter({ hasText: 'Ethereum' }).click();
    check((await page.getByTestId('deposit-address').textContent()) === address('USDT', 'ethereum'), 'Ethereum shows the Ethereum address', null);
    await page.locator('.dc-networks').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `after-deposit-networks-${width}.png`) });
    // Exact-bytes copy, and its one event.
    const events = () => posts.filter(p => p.endsWith('/deposit-address-copies')).length;
    await copyButton.click();
    await page.waitForTimeout(400);
    let copies = await page.evaluate(() => window.__copies);
    check(copies.at(-1) === address('USDT', 'ethereum'), 'the clipboard receives the exact address', copies.at(-1));
    check((await copyButton.textContent()).includes('скопирован'), 'the button says it was copied', await copyButton.textContent());
    check(events() >= 1, 'a successful copy notes one copy event', events());
    // A refused clipboard: no success, no event.
    const eventsBefore = events();
    await page.evaluate(() => { window.__copyMode = 'failure'; });
    await networks.filter({ hasText: 'BNB' }).click();
    await copyButton.click();
    await page.waitForTimeout(400);
    check(await page.locator('.dc-copy-error').isVisible() && !(await copyButton.textContent()).includes('скопирован'), 'a refused clipboard shows no success', await copyButton.textContent());
    check(events() === eventsBefore, 'a refused clipboard notes no event', events() - eventsBefore);
    // Switching network while the clipboard works: what was copied stays the old address.
    await page.evaluate(() => { window.__copyMode = 'slow'; });
    await copyButton.click();
    await networks.filter({ hasText: 'Tron' }).click();
    await page.waitForTimeout(700);
    copies = await page.evaluate(() => window.__copies);
    check(copies.at(-1) === address('USDT', 'bsc') && (await page.getByTestId('deposit-address').textContent()) === address('USDT', 'tron'), 'a mid-copy network switch does not swap the destination', copies.at(-1));
    check(!(await copyButton.textContent()).includes('скопирован'), 'and the new network is not marked copied', await copyButton.textContent());
    // Session changes while the clipboard works: no event for the other user.
    const eventsSession = events();
    const tokens = { other: qaToken('qa-other-user'), own: qaToken('qa-user') };
    await networks.filter({ hasText: 'Ethereum' }).click();
    await copyButton.click();
    await page.evaluate(token => localStorage.setItem('exchange_token', token), tokens.other);
    await page.waitForTimeout(700);
    check(events() === eventsSession, 'a copy that finishes in another session notes nothing', events() - eventsSession);
    await page.evaluate(token => { localStorage.setItem('exchange_token', token); window.__copyMode = 'success'; }, tokens.own);
    // The optional QR.
    await page.locator('.dc-qr-button').click();
    const qr = await page.locator('.dc-qr').boundingBox();
    check(qr && qr.width >= 140 && qr.width <= 180, 'the QR is drawn on request at 140–180px', qr);
    await page.locator('.dc-qr').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `after-deposit-qr-${width}.png`) });
    await page.locator('.dc-qr-button').click();
    check(await page.locator('.dc-qr').count() === 0, 'and hidden again on the second press', null);
    // Escape closes the asset list first, then the dialog.
    await page.locator('.dc-asset-trigger').click();
    await page.keyboard.press('Escape');
    check(await page.locator('.dc-menu').count() === 0 && await overlay.count() === 1, 'Escape closes the asset list, not the dialog', null);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await overlay.count() === 0, 'Escape closes the dialog', null);
  check(page.url() === before.url && (await measure(page)).pairName === before.pair && (await priceInput.inputValue()) === '12345', 'closing keeps the pair, the URL and the draft', { url: page.url(), price: await priceInput.inputValue() });
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function futuresAccountDeposit(browser, fx, [width, height]) {
  scope = `Futures account deposit ${width}`;
  const { context, page, errors } = await open(browser, fx, FUTURES, { width, height });
  await settle(page, FUTURES);
  const button = page.locator('.futures-mobile-extras .futures-account-actions button').first();
  check(await button.count() === 1 && (await button.textContent()).trim() === 'Депозит', 'the account block has its «Депозит»', await button.count());
  const reach = await reachable(page, button);
  check(reach.ok, 'and it is reachable under the positions', reach.why);
  const scrollBefore = await page.evaluate(() => scrollY);
  await button.click();
  await page.getByTestId('deposit-address').waitFor({ state: 'visible', timeout: 10000 });
  check(await page.locator('.dc-overlay').count() === 1 && new URL(page.url()).pathname === '/futures', 'it opens the same dialog on the terminal (no trip to the Wallet)', page.url());
  check(await page.locator('.dc-overlay').getAttribute('data-tone') === 'terminal', 'in the terminal theme', null);
  await page.locator('.dc-close').click();
  await page.waitForTimeout(300);
  check(await page.locator('.dc-overlay').count() === 0 && Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 40, 'closing returns to the same place', null);
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
}

async function desktop(browser, fx, [width, height]) {
  for (const [name, url] of [['Spot', SPOT], ['Futures', FUTURES]]) {
    scope = `${name} desktop ${width}`;
    const { context, page, errors } = await open(browser, fx, url, { width, height });
    await settle(page, url);
    const m = await measure(page);
    check(!m.switchBox, 'no phone switch on desktop', m.switchBox);
    check(m.book && m.form && m.chart, 'chart, book and ticket are all on screen', { book: !!m.book, form: !!m.form, chart: !!m.chart });
    check(m.overflowX <= 0, 'no sideways page scroll', m.overflowX);
    check(m.orderTypeControls === 1, 'one order-type control', m.orderTypeControls);
    if (width === 1440) await page.screenshot({ path: path.join(OUT, `after-${name.toLowerCase()}-desktop-${width}.png`) });
    await page.locator('.global-header .deposit-button:visible').first().click();
    await page.getByTestId('deposit-address').waitFor({ state: 'visible', timeout: 10000 });
    const dialog = await page.locator('.dc-dialog').boundingBox();
    check(dialog && dialog.width < width * 0.7 && await page.locator('.dc-qr').count() === 0, 'the header deposit opens the centred dialog without a QR', dialog);
    if (width === 1440 && name === 'Futures') await page.screenshot({ path: path.join(OUT, `after-deposit-desktop-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await page.locator('.dc-overlay').count() === 0, 'and closes', null);
    check(errors.length === 0, 'no page errors', errors);
    await context.close();
  }
}

async function edgeStates(browser, dist) {
  const guest = await serve(dist, { guest: true });
  for (const [name, url] of [['Spot', SPOT], ['Futures', FUTURES]]) {
    scope = `${name} guest 390`;
    const { context, page, errors } = await open(browser, guest, url, { width: 390, height: 844, guest: true });
    await page.waitForTimeout(3500);
    const m = await measure(page);
    // Both terminals sit behind RequireAuth (unchanged): a guest is sent to
    // sign in, and that page must not inherit any phone-terminal rule.
    check(!/^\/(trade|futures)/.test(new URL(page.url()).pathname) && !m.form && !m.switchBox, 'a guest is still sent to sign in, as on main', page.url());
    check(m.overflowX <= 0, 'no sideways page scroll', m.overflowX);
    check(errors.length === 0, 'no page errors', errors);
    await page.screenshot({ path: path.join(OUT, `after-${name.toLowerCase()}-guest-390.png`) });
    await context.close();
  }
  guest.server.close();
  const fx = await serve(dist, { positions: 'none' });
  for (const lang of ['en', 'es', 'hi', 'ja', 'ko', 'zh']) for (const [name, url] of [['Spot', SPOT], ['Futures', FUTURES]]) {
    scope = `${name} ${lang} 360`;
    const { context, page, errors } = await open(browser, fx, url, { width: 360, height: 800, lang });
    await page.waitForTimeout(3000);
    const m = await measure(page);
    check(m.overflowX <= 0 && m.options.every(o => !o.clipped && o.box && o.box.right <= m.vw + 0.5), 'header fits and no label is cut', { o: m.overflowX, options: m.options.map(o => [o.text, o.clipped]) });
    check(![m.switchBox, ...m.options.map(o => o.box)].some(b => overlaps(b, m.wallet) || overlaps(b, m.deposit)) && m.deposit, 'header controls do not overlap', m.options.map(o => o.box));
    check(errors.length === 0, 'no page errors', errors);
    await context.close();
  }
  scope = 'Spot PEPE 320';
  const { context, page, errors } = await open(browser, fx, '/trade?pair=PEPE%2FUSDT', { width: 320, height: 568 });
  await settle(page, SPOT);
  const m = await measure(page);
  check(m.overflowX <= 0 && m.price && m.book && m.form, 'a sub-cent price keeps the layout', { o: m.overflowX, price: m.price });
  check(errors.length === 0, 'no page errors', errors);
  await context.close();
  fx.server.close();
}

/** Requests a phone terminal makes on its own, before vs after, by endpoint. */
async function idleRequests(browser, dist) {
  const counts = {};
  for (const [name, url] of [['Spot', SPOT], ['Futures', FUTURES]]) {
    const fx = await serve(dist);
    const { context, page } = await open(browser, fx, url, { width: 390, height: 844 });
    await settle(page, url);
    await page.waitForTimeout(1500);
    const start = fx.state.requests.length;
    await page.waitForTimeout(20000);
    const families = {};
    for (const q of fx.state.requests.slice(start)) {
      if (!q.path.startsWith('/api/')) continue;
      const key = q.path.replace(/\/[A-Z0-9%-]{3,}(?=\/|$)/g, '/:x');
      families[key] = (families[key] || 0) + 1;
    }
    counts[name] = families;
    await context.close();
    fx.server.close();
  }
  return counts;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ran = {};
  for (const kind of BROWSERS) {
    let browser;
    try { browser = await playwright[kind].launch(kind === 'chromium' ? { args: ['--no-sandbox'] } : {}); }
    catch (error) { ran[kind] = `not available here: ${String(error.message || error).split('\n')[0]}`; console.log(`${kind}: ${ran[kind]}`); continue; }
    ran[kind] = 'ran';
    console.log(`── ${kind}`);
    const fx = await serve(DIST);
    for (const size of PHONES) for (const [name, url] of [['Spot', SPOT], ['Futures', FUTURES]]) await phoneWorkspace(browser, fx, size, name, url);
    for (const size of [[390, 844], [320, 568]]) {
      await pairPicking(browser, fx, size);
      await crossMarket(browser, fx, size);
      await prelisting(browser, fx, size);
      await futuresAccountDeposit(browser, fx, size);
    }
    for (const size of PHONES) await deposit(browser, fx, size, size[0] === 390 || size[0] === 320);
    for (const size of DESKTOPS) await desktop(browser, fx, size);
    fx.server.close();
    await edgeStates(browser, DIST);
    if (BEFORE && kind === 'chromium') {
      const before = await idleRequests(browser, path.resolve(BEFORE));
      const after = await idleRequests(browser, DIST);
      ran.idleRequests = { before, after };
      for (const name of Object.keys(after)) {
        scope = `${name} idle 20s 390`;
        const added = Object.keys(after[name]).filter(key => !(key in before[name]));
        const total = obj => Object.values(obj).reduce((a, b) => a + b, 0);
        check(added.length === 0, 'the new UI adds no endpoint while idle', added);
        check(total(after[name]) <= total(before[name]) + 2, 'and no more idle requests than main', { before: total(before[name]), after: total(after[name]) });
      }
    }
    await browser.close();
  }
  const failed = results.filter(r => !r.ok);
  const report = { status: failed.length ? 'FAIL' : 'PASS', browsers: ran, checks: results.length, failed: failed.length, failures: failed, results };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, browsers: ran, checks: results.length, failed: failed.length }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
