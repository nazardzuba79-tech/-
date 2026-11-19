#!/usr/bin/env node
'use strict';
/**
 * The phone Futures terminal after the owner's reference (2026-11-19,
 * FuturesMobileReference.css): the view switch in the instrument row, the
 * ticket on the left and a short order book on the right, the account lists
 * under the ticket, the «Ордера» screen, Long / Short under the chart.
 *
 * Built frontend against the read-only loopback fixture of
 * qa-futures-proportions.cjs (three positions; every write answers 405).
 * Controls are pressed to prove they open what they should; no order, close
 * or protection is submitted, and the run fails on any write request.
 *
 *   node scripts/qa-futures-mobile-terminal.cjs [--dist frontend/dist]
 *        [--out output/futures-mobile-terminal] [--widths 320,360,390,430] [--port 4401]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/futures-mobile-terminal')));
const WIDTHS = arg('--widths', '320,360,390,430').split(',').map(Number);
const PORT = Number(arg('--port', '4401'));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); };

function startFixture() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'qa-futures-proportions.cjs'), '--serve', '--port', String(PORT), '--dist', DIST], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const timer = setTimeout(() => reject(new Error(`fixture did not start: ${log.slice(-400)}`)), 20000);
    const seen = chunk => { log += chunk; if (/Read-only fixture preview/.test(log)) { clearTimeout(timer); resolve(child); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${log.slice(-400)}`)); });
  });
}

/** Geometry and text of the trade screen, read in the page. */
const readTrade = page => page.evaluate(() => {
  const q = sel => document.querySelector(sel);
  const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const terminal = q('.terminal');
  const tabs = [...document.querySelectorAll('.futures-mobile-tabs button')];
  const bottomTabs = [...document.querySelectorAll('.bottom-tabs .bottom-tab')];
  const rows = [...document.querySelectorAll('.futures-position-row')];
  const card = row => {
    const cell = name => row.querySelector(`td[data-col="${name}"]`);
    const figure = name => { const td = cell(name); if (!shown(td)) return null; const r = document.createRange(); r.selectNodeContents(td); const boxes = [...r.getClientRects()].filter(b => b.width > 0); const last = boxes[boxes.length - 1]; return last ? { left: last.left, right: last.right, bottom: last.bottom } : null; };
    const buttons = [row.querySelector('.fut-tpslTrigger'), row.querySelector('.futures-position-close[data-limit-close-open]'), row.querySelector('.futures-position-close:not([data-limit-close-open])')].filter(Boolean);
    const box = row.getBoundingClientRect();
    return {
      rect: rect(row), border: getComputedStyle(row).borderBottomWidth, radius: getComputedStyle(row).borderTopLeftRadius,
      ticker: row.querySelector('.futures-position-ticker b')?.textContent ?? null,
      side: row.querySelector('.futures-position-contract > .futures-sr-only')?.textContent.trim() ?? null,
      mode: row.querySelector('.futures-position-mode')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      result: row.querySelector('td[data-col="unrealized"] .futures-unrealized')?.innerText.replace(/\s+/g, '') ?? null,
      resultRect: rect(cell('unrealized')), headRect: rect(cell('contract')),
      figures: Object.fromEntries(['qty', 'entry', 'mark', 'liq', 'margin', 'realized'].map(n => [n, figure(n)])),
      protection: (() => { const el = row.querySelector('.futures-mobile-protection-values'); return shown(el) ? el.textContent.replace(/\s+/g, ' ').trim() : null; })(),
      actions: buttons.map(b => ({ text: b.textContent.trim(), ...rect(b), clipped: b.scrollWidth > b.clientWidth + 1 })),
      outside: [...row.querySelectorAll('td[data-col], button')].filter(shown).filter(el => { const b = el.getBoundingClientRect(); return b.left < box.left - 12 || b.right > box.right + 12; }).length,
    };
  };
  const book = q('.orderbook-area .reference-book');
  return {
    tab: terminal.getAttribute('data-mobile-tab'), viewport: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    header: { rect: rect(q('.ticker-bar')), position: getComputedStyle(q('.ticker-bar')).position, background: getComputedStyle(q('.ticker-bar')).backgroundColor, pair: q('.ticker-bar .pair-name')?.textContent.trim(), priceShown: shown(q('.ticker-bar .futures-primary-price')),
      stats: rect(q('.futures-mobile-stats-toggle')), calculator: rect(q('.ticker-calc-btn')) },
    switch: tabs.map(b => ({ id: b.id, selected: b.getAttribute('aria-selected'), label: b.querySelector('.futures-mobile-tab-label')?.textContent ?? null, icon: !!b.querySelector('svg'), ...rect(b) })),
    form: rect(q('.order-form-area')), bookArea: rect(q('.orderbook-area')),
    margin: [...document.querySelectorAll('.fo-mlRow > .fo-mlTrigger')].map(b => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), ...rect(b) })),
    available: q('.fo-availRow')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    family: q('.order-family-select select')?.value ?? null,
    sizeFields: [...document.querySelectorAll('.fo-sizeField')].map(f => ({ unit: f.getAttribute('data-size-field'), shown: shown(f) })),
    swap: rect([...document.querySelectorAll('.fo-unitSwap')].find(shown)),
    presets: [...document.querySelectorAll('.percent-slider-presets button')].filter(shown).length,
    slider: shown(q('.percent-slider-track')),
    info: q('.fo-infoBox')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    reduceOnly: shown(q('.fo-reduceOnlyRow')),
    submit: [...document.querySelectorAll('.fo-submitPair button')].map(b => ({ text: b.textContent.trim(), radius: parseFloat(getComputedStyle(b).borderTopLeftRadius), ...rect(b), clipped: b.scrollWidth > b.clientWidth + 1 })),
    funding: (() => { const el = q('.futures-mobile-funding'); return shown(el) ? { text: el.innerText.replace(/\s+/g, ' ').trim(), ...rect(el) } : null; })(),
    book: book ? { asks: book.querySelectorAll('.rb-asks .rb-row').length, bids: book.querySelectorAll('.rb-bids .rb-row').length, last: book.querySelector('.rb-last')?.textContent.trim() ?? null,
      ratio: shown(book.querySelector('.rb-ratio')), step: shown(book.querySelector('.rb-controls select')), tabs: shown(book.querySelector('.rb-tabs')),
      rows: [...book.querySelectorAll('.rb-row')].slice(0, 3).map(r => ({ text: r.innerText.replace(/\s+/g, ' ').trim(), clipped: [...r.querySelectorAll('span')].filter(shown).some(s => s.scrollWidth > s.clientWidth + 1) })) } : null,
    bottomTabs: bottomTabs.map(b => ({ id: b.id, text: b.textContent.replace(/\s+/g, ' ').trim(), shown: shown(b), active: b.classList.contains('active') })),
    ordersOpen: rect(q('.futures-mobile-orders-open')), allMarkets: rect(q('.archive-pair-filter')), closeAll: q('.futures-close-all-trigger') ? 'present' : null,
    summaryShown: shown(q('.futures-positions-summary')), ordersBar: shown(q('.futures-mobile-orders-bar')), quick: shown(q('.futures-mobile-quick')),
    cards: rows.map(card), text: document.body.innerText,
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { dist: path.relative(ROOT, DIST), environment: 'Built frontend; read-only loopback fixture; nothing submitted', views: [] };
  let fixture, browser;
  try {
    fixture = await startFixture();
    browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
    for (const width of WIDTHS) {
      const P = String(width);
      const context = await browser.newContext({ viewport: { width, height: width <= 320 ? 700 : 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: true, isMobile: true, locale: 'ru-RU' });
      await context.addCookies([{ name: 'qa_state', value: 'filled', url: ORIGIN }]);
      const view = { width, writes: [], errors: [], external: [] }; report.views.push(view);
      await context.route('**/*', route => {
        const q = route.request(), u = new URL(q.url());
        if (u.origin !== ORIGIN) { view.external.push(u.host); return route.abort(); }
        // The terminal opens its execution session on load; the fixture answers it and refuses every other write.
        if (!['GET', 'HEAD'].includes(q.method()) && u.pathname !== '/api/v1/private-trading/native/execution-session') view.writes.push(`${q.method()} ${u.pathname}`);
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => view.errors.push(e.message.slice(0, 200)));
      await page.goto(`${ORIGIN}/futures?pair=BTC%2FUSDT`, { waitUntil: 'domcontentloaded' });
      await page.locator('.futures-position-row').first().waitFor({ timeout: 20000 });
      await page.locator('.rb-bids .rb-row:not(.is-placeholder)').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(700);
      const t = await readTrade(page);

      // ── Instrument row and the view switch ──
      ok(`${P}: the terminal opens on the trade screen without a horizontal page scroll`, t.tab === 'trade' && t.overflow <= 1, { tab: t.tab, overflow: t.overflow });
      ok(`${P}: instrument row — the pair, the «24h» figures key and the calculator; no second price beside the book's`, /^BTC\/USDT/.test(t.header.pair) && Math.round(t.header.rect.height) === 48 && t.header.position === 'sticky'
        && !t.header.priceShown && t.header.stats.width >= 40 && t.header.calculator.width >= 32, { height: t.header.rect.height, stats: Math.round(t.header.stats.width), calc: Math.round(t.header.calculator.width) });
      const sw = t.switch;
      ok(`${P}: the view switch is three icon keys in the instrument row, at its right edge: chart, ticket, orders`, sw.length === 3 && sw.map(b => b.id).join() === 'mobile-futures-chart,mobile-futures-trade,mobile-futures-positions'
        && sw.every(b => b.icon && b.label && b.height >= 36 && b.width >= 36 && b.top >= t.header.rect.top && b.bottom <= t.header.rect.bottom) && sw[1].selected === 'true'
        && Math.abs(sw[2].right - (t.viewport - (width < 360 ? 8 : 12))) <= 1 && t.header.calculator.right <= sw[0].left && t.header.stats.right <= t.header.calculator.left + 1, sw.map(b => [b.id.replace('mobile-futures-', ''), Math.round(b.left), Math.round(b.width)]));

      // ── Ticket left, book right ──
      ok(`${P}: the ticket is on the left and the order book on the right, side by side, inside the screen`, t.form.left < t.bookArea.left && t.form.right <= t.bookArea.left + 1 && Math.abs(t.form.top - t.bookArea.top) <= 1
        && t.form.width > t.bookArea.width && t.bookArea.width >= width * 0.34 && t.bookArea.right <= t.viewport + 0.5 && t.form.left >= 7.5, { form: Math.round(t.form.width), book: Math.round(t.bookArea.width) });
      ok(`${P}: ticket — margin mode and leverage on one row, available balance, order type, one size field with its unit swap, the size slider without preset keys, the order summary, reduce-only`,
        t.margin.length === 2 && Math.abs(t.margin[0].top - t.margin[1].top) <= 1 && /Кросс/.test(t.margin[0].text) && /10\.00x/.test(t.margin[1].text) && t.margin.every(m => m.height >= 32 && m.right <= t.form.right + 0.5)
        && /Доступно/.test(t.available) && /56,381,922\.68 USDT/.test(t.available) && t.family === 'LIMIT'
        && t.sizeFields.length === 2 && t.sizeFields.find(f => f.unit === 'base').shown && !t.sizeFields.find(f => f.unit === 'quote').shown && t.swap && t.swap.width >= 32
        && t.presets === 0 && t.slider && /Стоимость позиции/.test(t.info) && /Маржа/.test(t.info) && t.reduceOnly, { margin: t.margin.map(m => m.text), available: t.available, family: t.family });
      const [long, short] = t.submit;
      ok(`${P}: Long over Short, two full-width pills, their words whole`, t.submit.length === 2 && long.text === 'Открыть Лонг' && short.text === 'Открыть Шорт' && short.top >= long.bottom + 4 && [long, short].every(b => b.height >= 40 && b.radius >= 20 && !b.clipped
        && Math.abs(b.left - t.form.left) <= 1 && Math.abs(b.right - t.form.right) <= 1), t.submit.map(b => [b.text, Math.round(b.width), Math.round(b.height)]));
      ok(`${P}: book column — funding with its countdown, at least four asks and four bids around the last price, the buy/sell ratio and the price step; no tab strip`, t.funding && /Ставка финансирования/.test(t.funding.text) && /\d\d:\d\d:\d\d/.test(t.funding.text)
        && t.funding.left >= t.bookArea.left - 0.5 && t.book.asks >= 4 && t.book.bids >= 4 && t.book.last === '85,421.30' && t.book.ratio && t.book.step && !t.book.tabs && t.book.rows.every(r => !r.clipped && /\d/.test(r.text)), { funding: t.funding?.text, asks: t.book.asks, bids: t.book.bids, rows: t.book.rows.map(r => r.text) });

      // ── Account lists under the ticket ──
      const names = t.bottomTabs.filter(b => b.shown).map(b => b.text);
      ok(`${P}: under the ticket — «Ордера», «Позиции», «Активы» with counts, the list key for the full screen, then «Все рынки»; history lives on the «Ордера» screen; bulk close is not in this design`,
        names.map(n => n.replace(/\s/g, '')).join('|') === 'Ордера(0)|Позиции(3)|Активы' && t.bottomTabs.find(b => b.id === 'futures-tab-positions').active && t.ordersOpen && t.ordersOpen.width >= 36
        && t.allMarkets && t.closeAll === null && !/Закрыть все/.test(t.text) && !t.summaryShown && !t.ordersBar && !t.quick, { tabs: names });
      const [btc, eth, pepe] = t.cards;
      const line = c => ['qty', 'entry', 'mark', 'liq'].map(n => c.figures[n]);
      ok(`${P}: position card — name over side and margin mode on the left, the result with ROI on the right, in one line`, t.cards.length === 3 && btc.ticker === 'BTCUSDT' && btc.side === 'Лонг' && eth.side === 'Шорт' && /^Кросс 10\.00x$/.test(btc.mode)
        && btc.result === '+3,077.97(+16.92%)' && btc.resultRect.left > btc.headRect.left + 60 && Math.abs(btc.resultRect.right - btc.rect.right) <= 1 && parseFloat(btc.radius) === 0 && parseFloat(btc.border) === 1, { result: btc.result, mode: btc.mode });
      ok(`${P}: position card — size, entry, mark and liquidation price on one line; margin and realized P&L are left to the «Ордера» screen`, line(btc).every(Boolean) && Math.max(...line(btc).map(f => f.bottom)) - Math.min(...line(btc).map(f => f.bottom)) <= 1.5
        && line(btc).every((f, i, all) => i === 0 || f.left > all[i - 1].left) && Math.abs(btc.figures.liq.right - btc.rect.right) <= 1.5 && !btc.figures.margin && !btc.figures.realized, btc.figures);
      ok(`${P}: position card — three outlined pills in one row with their words whole: TP/SL, limit close, market close`, [btc, eth, pepe].every(c => c.actions.length === 3 && c.actions.map(a => a.text).join('|') === 'Установить TP/SL|Закрыть лимитом|Закрыть по рынку'
        && c.actions.every(a => a.height >= 32 && !a.clipped && Math.abs(a.top - c.actions[0].top) <= 1 && Math.abs(a.width - c.actions[0].width) <= 1.5)), btc.actions.map(a => [a.text, Math.round(a.width), Math.round(a.height)]));
      ok(`${P}: the TP/SL line shows only where protection is set; nothing leaves a card`, /TP 90000/.test(btc.protection ?? '') && /SL 81000/.test(btc.protection ?? '') && eth.protection === null && pepe.protection === null && t.cards.every(c => c.outside === 0), [btc.protection, eth.protection]);
      ok(`${P}: no demo wording anywhere on the screen`, !/демо|demo/i.test(t.text));
      await page.screenshot({ path: path.join(OUT, `${P}-trade.png`), animations: 'disabled' });
      if (width === 390) await page.screenshot({ path: path.join(OUT, '390-trade-full.png'), fullPage: true, animations: 'disabled' });

      // ── The controls do what they did ──
      await page.locator('.fo-unitSwap:visible').click();
      const quote = page.locator('.fo-sizeField[data-size-field=quote] input');
      await quote.fill('1000'); await page.waitForTimeout(150);
      const qty = await page.locator('.fo-sizeField[data-size-field=base] input').inputValue();
      const afterSwap = await readTrade(page);
      ok(`${P}: the unit swap shows the value field; 1000 USDT writes the quantity the order would carry`, afterSwap.sizeFields.find(f => f.unit === 'quote').shown && !afterSwap.sizeFields.find(f => f.unit === 'base').shown && Number(qty) > 0.0117 && Number(qty) < 0.0118, qty);
      await page.locator('.fo-unitSwap:visible').click();
      await page.locator('.order-family-select select').selectOption('MARKET'); await page.waitForTimeout(150);
      const market = await page.evaluate(() => ({ lastKey: !!document.querySelector('.fo-lastPriceBtn'), info: document.querySelector('.fo-infoBox').innerText.replace(/\s+/g, ' '), cut: [...document.querySelectorAll('.fo-infoBox .fo-infoRow > :first-child')].filter(el => el.scrollWidth > el.clientWidth + 1).length }));
      ok(`${P}: the order type select switches to market; the summary keeps every label whole`, !market.lastKey && /1,000\.00 USDT/.test(market.info) && market.cut === 0, market.info.slice(0, 90));
      await page.locator('.order-family-select select').selectOption('LIMIT');
      await page.locator('.rb-asks .rb-row').first().click(); await page.waitForTimeout(150);
      ok(`${P}: a price pressed in the book fills the ticket and keeps the trade screen`, /^85[,.]?42\d/.test(await page.locator('.fo-priceInputRow input').inputValue()) && await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade', await page.locator('.fo-priceInputRow input').inputValue());

      await page.evaluate(() => window.scrollTo(0, 420)); await page.waitForTimeout(150);
      const pinned = await page.evaluate(() => { const bar = document.querySelector('.ticker-bar'), b = bar.getBoundingClientRect(), tab = document.querySelector('#mobile-futures-trade').getBoundingClientRect(); return { top: Math.round(b.top), background: getComputedStyle(bar).backgroundColor, switchTop: Math.round(tab.top), hit: document.elementFromPoint(40, 24)?.closest('.ticker-bar') !== null }; });
      ok(`${P}: scrolled, the instrument row and the switch stay at the top, opaque, over the ticket`, pinned.top === 0 && pinned.switchTop >= 0 && pinned.switchTop <= 8 && !/rgba\(0, 0, 0, 0\)|transparent/.test(pinned.background) && pinned.hit, pinned);

      await page.locator('.futures-mobile-stats-toggle').click(); await page.waitForTimeout(150);
      const figures = await page.evaluate(() => ({ expanded: document.querySelector('.futures-mobile-stats-toggle').getAttribute('aria-expanded'), text: document.querySelector('.ticker-bar').innerText.replace(/\s+/g, ' '), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      ok(`${P}: the «24h» key opens every figure of the contract in place`, figures.expanded === 'true' && /Маркировочная цена/.test(figures.text) && /Открытый интерес/.test(figures.text) && /Ставка финансирования/.test(figures.text) && figures.overflow <= 1, figures.text.slice(0, 120));
      await page.locator('.futures-mobile-stats-toggle').click();
      await page.locator('.ticker-calc-btn').click(); await page.waitForTimeout(250);
      ok(`${P}: the calculator opens from the instrument row`, await page.locator('.fc-panel').isVisible());
      await page.locator('.fc-close').click();

      const firstCard = page.locator('.futures-position-row').first();
      await firstCard.locator('.fut-tpslTrigger').scrollIntoViewIfNeeded(); await firstCard.locator('.fut-tpslTrigger').click();
      const editor = page.locator('.fut-tpslPopover');
      ok(`${P}: «Установить TP/SL» opens the protection editor with the server-held prices`, await editor.isVisible() && (await editor.locator('input').first().inputValue()) === '90000');
      await page.keyboard.press('Escape'); if (await editor.isVisible()) await firstCard.locator('.fut-tpslTrigger').click();
      await firstCard.locator('.futures-position-close[data-limit-close-open]').click(); await page.waitForTimeout(300);
      const limit = page.locator('dialog.futures-limit-close[open]');
      ok(`${P}: «Закрыть лимитом» opens the limit-close dialog`, await limit.first().isVisible() && /84,000\.00/.test(await limit.first().innerText()));
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);

      const shareKey = await firstCard.locator('.archive-pnl-open').evaluate(el => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return hit === el || el.contains(hit); });
      ok(`${P}: the result-card key beside the P&L label takes the press`, shareKey);

      // ── «Ордера» ──
      await page.locator('.futures-mobile-orders-open').click(); await page.waitForTimeout(250);
      const orders = await readTrade(page);
      ok(`${P}: the list key opens «Ордера»: a title row with the way back, all five lists, the totals line and the full position card`, orders.tab === 'positions' && orders.ordersBar && orders.bottomTabs.every(b => b.shown) && orders.bottomTabs.length === 5
        && orders.summaryShown && orders.cards.length === 3 && !!orders.cards[0].figures.margin && !!orders.cards[0].figures.realized && orders.overflow <= 1 && orders.switch[2].selected === 'true', orders.bottomTabs.map(b => b.text));
      await page.screenshot({ path: path.join(OUT, `${P}-orders.png`), animations: 'disabled' });
      await page.locator('#futures-tab-orderHistory').click(); await page.waitForTimeout(250);
      ok(`${P}: order history opens on the «Ордера» screen`, await page.locator('.futures-orders-panel').isVisible() && /История ордеров пока пуста|Последние/.test(await page.locator('.futures-orders-panel').innerText()));
      await page.locator('#futures-tab-positions').click();
      await page.locator('.futures-mobile-orders-bar button').click(); await page.waitForTimeout(200);
      ok(`${P}: the arrow in the title row returns to the ticket`, await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade');

      // ── Chart ──
      await page.locator('#mobile-futures-chart').click(); await page.locator('.chart-surface').waitFor(); await page.waitForTimeout(600);
      const chart = await page.evaluate(() => {
        const q = sel => document.querySelector(sel), rect = el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        const quick = [...document.querySelectorAll('.futures-mobile-quick button')].map(b => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), ...rect(b), bg: getComputedStyle(b).backgroundColor }));
        const nav = q('.bottom-nav') ? rect(q('.bottom-nav')) : null;
        return { head: q('.ticker-bar').innerText.replace(/\s+/g, ' '), price: parseFloat(getComputedStyle(q('.ticker-bar .value.price')).fontSize), tabs: [...document.querySelectorAll('.futures-mobile-chart-tabs button')].map(b => b.textContent.trim()),
          chart: rect(q('.chart-surface')), quick, nav, viewport: innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, scroll: document.documentElement.scrollHeight - innerHeight };
      });
      ok(`${P}: chart screen — last price large with its change, the day's high and low, mark price and turnover, then «График | Стакан»`, /85,421\.30/.test(chart.head) && /\+1\.25%/.test(chart.head) && /Макс\. за 24ч/.test(chart.head) && /Мин\. за 24ч/.test(chart.head)
        && /Маркировочная цена/.test(chart.head) && /Оборот за 24ч/.test(chart.head) && chart.price >= 20 && chart.tabs.join('|') === 'График|Стакан' && chart.overflow <= 1, chart.head.slice(0, 140));
      ok(`${P}: Long and Short sit under the chart, above the bottom menu, and the chart keeps a useful height`, chart.quick.length === 2 && /^Лонг 85421\.3$/.test(chart.quick[0].text) && /^Шорт 85421\.3$/.test(chart.quick[1].text)
        && chart.quick.every(b => b.height >= 44) && chart.quick[0].bg !== chart.quick[1].bg && chart.quick[0].top >= chart.chart.bottom - 1 && (!chart.nav || chart.quick[0].bottom <= chart.nav.top + 1) && chart.chart.height >= 240, { chart: Math.round(chart.chart.height), quick: chart.quick.map(b => b.text), scroll: chart.scroll });
      await page.screenshot({ path: path.join(OUT, `${P}-chart.png`), animations: 'disabled' });
      await page.locator('.futures-mobile-quick button.long').click(); await page.waitForTimeout(200);
      ok(`${P}: Long under the chart opens the ticket and submits nothing`, await page.locator('.terminal').getAttribute('data-mobile-tab') === 'trade' && view.writes.length === 0, view.writes);
      await page.locator('.pair-selector').click(); await page.waitForTimeout(300);
      ok(`${P}: the pair name opens the market list with its search`, await page.locator('dialog.reference-market-dialog[open] input').first().isVisible());

      ok(`${P}: no page error, no write request, nothing left the stand`, view.errors.length === 0 && view.writes.length === 0 && view.external.length === 0, { errors: view.errors, writes: view.writes, external: [...new Set(view.external)] });
      await context.close();
    }

    // The desktop terminal is not touched by the phone sheet.
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'ru-RU' });
      await context.addCookies([{ name: 'qa_state', value: 'filled', url: ORIGIN }]);
      await context.route('**/*', route => new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/futures?pair=BTC%2FUSDT`, { waitUntil: 'domcontentloaded' });
      await page.locator('.futures-position-row').first().waitFor({ timeout: 20000 });
      const desktop = await page.evaluate(() => { const shown = sel => [...document.querySelectorAll(sel)].some(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
        return { phoneOnly: ['.futures-mobile-tabs', '.futures-mobile-funding', '.futures-mobile-orders-bar', '.futures-mobile-orders-open', '.futures-mobile-quick', '.fo-unitSwap'].filter(shown), sizeFields: [...document.querySelectorAll('.fo-sizeField')].filter(el => getComputedStyle(el).display !== 'none').length,
          close: [...document.querySelectorAll('.futures-position-row .futures-position-close')].slice(0, 2).map(b => b.textContent.trim()) }; });
      ok('1440: none of the phone controls is drawn; both size fields and the desktop action names are as before', desktop.phoneOnly.length === 0 && desktop.sizeFields === 2 && desktop.close.join('|') === 'Лимитный|Рыночный', desktop);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    if (fixture) fixture.kill();
  }
  report.checks = checks; report.passed = checks.filter(c => c.pass).length; report.failed = checks.filter(c => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
