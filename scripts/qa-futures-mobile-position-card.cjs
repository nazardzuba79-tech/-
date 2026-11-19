#!/usr/bin/env node
'use strict';
/**
 * The open-position card on a phone (FuturesMobilePositions.css), laid out as
 * Bybit's phone card: header tags, P&L and ROI side by side, two rows of three
 * figures, the TP/SL line and three actions.
 *
 * Built frontend against the read-only loopback fixture of
 * qa-futures-proportions.cjs (three positions; every write answers 405).
 * Nothing is sent to a market or account service, and no order is submitted:
 * the market-close button is measured, never pressed.
 *
 *   node scripts/qa-futures-mobile-position-card.cjs [--dist frontend/dist]
 *        [--out output/futures-mobile-position-card] [--widths 320,360,390,430] [--port 4396]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/futures-mobile-position-card')));
const WIDTHS = arg('--widths', '320,360,390,430').split(',').map(Number);
const PORT = Number(arg('--port', '4396'));
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

/** Everything the checks need from the first card and the whole list, read in the page. */
const read = page => page.evaluate(() => {
  const rect = el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const rows = [...document.querySelectorAll('.futures-position-row')];
  const visible = el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).display !== 'contents' && el.getBoundingClientRect().width > 0;
  const cards = rows.map(row => {
    const cell = name => row.querySelector(`td[data-col="${name}"]`);
    const label = name => { const td = cell(name); if (!td) return null; const c = getComputedStyle(td, '::before').content; return c === 'none' ? null : c.replace(/^"|"$/g, ''); };
    // The figure of a cell: its last visible box, so labels of different heights do not matter.
    const figure = name => { const td = cell(name); if (!td || !visible(td)) return null; const r = document.createRange(); r.selectNodeContents(td); const boxes = [...r.getClientRects()].filter(b => b.width > 0); const last = boxes[boxes.length - 1]; return last ? { top: last.top, bottom: last.bottom, left: last.left, right: last.right } : null; };
    const items = [...row.querySelectorAll('td[data-col], .futures-mobile-protection-values, .fut-tpslTrigger, .futures-position-close, .archive-pnl-open')].filter(visible);
    const name = el => el.getAttribute('data-col') || [...el.classList].find(c => /fut-tpslTrigger|futures-position-close|archive-pnl-open|futures-mobile-protection-values/.test(c)) || el.className;
    const card = row.getBoundingClientRect();
    const outside = items.filter(el => { const b = el.getBoundingClientRect(); return b.left < card.left - 0.5 || b.right > card.right + 0.5 || b.top < card.top - 0.5 || b.bottom > card.bottom + 0.5; }).map(name);
    const overlaps = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      // The share button sits in the header's reserved right corner: that pair is intended.
      if ([name(items[i]), name(items[j])].sort().join() === 'archive-pnl-open,contract') continue;
      const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) overlaps.push(`${name(items[i])} × ${name(items[j])}`);
    }
    const sideTag = row.querySelector('.futures-position-contract > .futures-sr-only');
    const actions = [row.querySelector('.fut-tpslTrigger'), row.querySelector('.futures-position-close[data-limit-close-open]'), row.querySelector('.futures-position-close:not([data-limit-close-open])')].filter(Boolean).map(b => { const r = document.createRange(); r.selectNodeContents(b); return { text: b.textContent.trim(), ...rect(b), words: r.getBoundingClientRect().width }; });
    return {
      side: row.getAttribute('data-side'), split: row.hasAttribute('data-pnl-split'), display: getComputedStyle(row).display, rect: rect(row),
      labels: Object.fromEntries(['unrealized', 'qty', 'margin', 'realized', 'net', 'entry', 'mark', 'liq', 'trading', 'funding', 'fees'].map(n => [n, label(n)])),
      figures: Object.fromEntries(['qty', 'margin', 'realized', 'net', 'entry', 'mark', 'liq', 'trading', 'funding', 'fees'].map(n => [n, figure(n)])),
      ticker: row.querySelector('.futures-position-ticker b')?.textContent ?? null,
      sideTag: sideTag ? { text: sideTag.textContent.trim(), ...rect(sideTag), color: getComputedStyle(sideTag).color } : null,
      mode: row.querySelector('.futures-position-mode')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      money: row.querySelector('.futures-position-money')?.innerText.trim() ?? null,
      roiSide: (() => { const el = row.querySelector('.futures-position-roi-side'); return el && visible(el) ? { text: el.querySelector('b').textContent.trim(), label: el.querySelector('i').textContent.trim(), ...rect(el) } : null; })(),
      roiBracketVisible: (() => { const el = row.querySelector('.futures-position-roi'); return !!el && visible(el); })(),
      approxVisible: [...row.querySelectorAll('.futures-position-approx')].some(visible),
      unitsInline: [...row.querySelectorAll('td[data-col-unit] .futures-position-unit, td[data-col-unit] .futures-unrealized-unit')].some(visible),
      protection: row.querySelector('.futures-mobile-protection-values')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      actions, outside, overlaps,
      controls: [...row.querySelectorAll('button')].filter(visible).map(b => ({ name: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 32), width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
      text: row.innerText,
    };
  });
  return { cards, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, viewport: innerWidth };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { dist: path.relative(ROOT, DIST), environment: 'Built frontend; read-only loopback fixture; no order submitted', views: [] };
  let fixture, browser;
  try {
    fixture = await startFixture();
    browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const session = async (width, height, { split = false, phone = true } = {}) => {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce', hasTouch: phone, isMobile: phone, locale: 'ru-RU' });
      await context.addCookies([{ name: 'qa_state', value: 'filled', url: ORIGIN }]);
      const view = { width, split, writes: [], errors: [], external: [] };
      await context.route('**/*', async route => {
        const q = route.request(), u = new URL(q.url());
        if (u.origin !== ORIGIN) { view.external.push(u.host); return route.abort(); }
        // The terminal opens its execution session on load; the fixture answers it and refuses every other write.
        if (!['GET', 'HEAD'].includes(q.method()) && u.pathname !== '/api/v1/private-trading/native/execution-session') view.writes.push(`${q.method()} ${u.pathname}`);
        if (split && /\/api\/v1\/private-trading\/native\/(state|live)/.test(u.pathname)) {
          const response = await route.fetch(); const body = await response.json();
          // The native engine's own split of a position's result.
          (body.positions || []).forEach(p => Object.assign(p, { tradingPnl: '3090.12', fundingNet: '-4.2051', feesPaid: '7.9488', netPnl: '3077.9661' }));
          return route.fulfill({ response, json: body });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e => view.errors.push(e.message.slice(0, 200)));
      await page.goto(`${ORIGIN}/futures?pair=BTC%2FUSDT`, { waitUntil: 'domcontentloaded' });
      if (phone) await page.locator('#mobile-futures-positions').click();
      await page.locator('.futures-position-row').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      return { context, page, view };
    };

    for (const width of WIDTHS) {
      const P = String(width), { context, page, view } = await session(width, width <= 320 ? 700 : 844);
      report.views.push(view);
      const state = await read(page), [btc, eth, pepe] = state.cards;
      view.cardHeights = state.cards.map(c => Math.round(c.rect.height));
      ok(`${P}: three position cards, laid out as a grid, without a horizontal page scroll`, state.cards.length === 3 && state.cards.every(c => c.display === 'grid') && state.pageOverflow <= 1, { cards: state.cards.length, overflow: state.pageOverflow });
      // The card this replaced measured 570px for the same position at 390px. 370, not 350: since 2026-11-19 the last label is the
      // reference's «Ориент. цена ликвидации», which takes two lines on a 360px phone.
      ok(`${P}: a card is compact (the ordinary one under 370px)`, btc.rect.height < 370, view.cardHeights);

      ok(`${P}: header — contract, side tag, margin mode with leverage`, btc.ticker === 'BTCUSDT' && btc.sideTag?.text === 'Лонг' && btc.sideTag.width > 20 && /^Кросс 10\.00x$/.test(btc.mode)
        && eth.sideTag?.text === 'Шорт' && /^Изолированная 5\.00x$/.test(eth.mode) && btc.sideTag.color !== eth.sideTag.color, { btc: [btc.ticker, btc.sideTag?.text, btc.mode], eth: [eth.sideTag?.text, eth.mode] });
      ok(`${P}: P&L on the left and ROI on the right under its own label, no brackets, no repeated «≈ USD»`, btc.money === '+3,077.97' && btc.roiSide?.text === '+16.92%' && btc.roiSide.label === 'ROI'
        && !btc.roiBracketVisible && !btc.approxVisible && btc.roiSide.right > btc.rect.right - 20, { money: btc.money, roi: btc.roiSide?.text });
      const unit = width >= 360 ? ' (USDT)' : '';
      ok(`${P}: labels name the figure and its unit; the unit is not repeated beside the figure`, btc.labels.unrealized === 'Нереализ. PnL (USDT)' && btc.labels.qty === 'Кол-во (BTC)' && btc.labels.margin === 'Маржа (USDT)'
        && btc.labels.realized === `Реализ. PnL${unit}` && btc.labels.entry === 'Цена Входа' && btc.labels.mark === 'Цена маркировки' && btc.labels.liq === 'Ориент. цена ликвидации' && !btc.unitsInline, btc.labels);
      const sameLine = names => { const f = names.map(n => btc.figures[n]); return f.every(Boolean) && Math.max(...f.map(x => x.bottom)) - Math.min(...f.map(x => x.bottom)) <= 1.5; };
      ok(`${P}: two rows of three figures — size, margin, realized P&L; entry, mark and liquidation price`, sameLine(['qty', 'margin', 'realized']) && sameLine(['entry', 'mark', 'liq'])
        && btc.figures.entry.top > btc.figures.qty.bottom && btc.figures.qty.left < btc.figures.margin.left && btc.figures.margin.left < btc.figures.realized.left
        && Math.abs(btc.figures.liq.right - btc.figures.realized.right) <= 1.5, btc.figures);
      ok(`${P}: the figures are the fixture's own`, /2\.166/.test(btc.text) && /18,191\.04/.test(btc.text) && /84,000\.00/.test(btc.text) && /85,421\.30/.test(btc.text) && /74,800\.00/.test(btc.text)
        && !/NaN|Infinity|undefined/.test(state.cards.map(c => c.text).join(' ')));
      ok(`${P}: the TP/SL line shows the server-held protection`, /TP 90000/.test(btc.protection) && /SL 81000/.test(btc.protection) && /TP —/.test(eth.protection) && /SL —/.test(eth.protection), [btc.protection, eth.protection]);
      const a = btc.actions;
      ok(`${P}: three equal actions in one row — TP/SL, limit close, market close — each at least 44px tall`, a.length === 3 && a[0].text === 'Установить TP/SL' && a[1].text === 'Закрыть лимитом' && a[2].text === 'Закрыть по рынку' && a.every(b => b.words <= b.width - 2)
        && a.every(b => b.height >= 44 && Math.abs(b.top - a[0].top) <= 1 && Math.abs(b.width - a[0].width) <= 1.5) && a[0].left < a[1].left && a[1].left < a[2].left, a.map(b => [b.text, Math.round(b.width), Math.round(b.height)]));
      ok(`${P}: every control on the card is at least 44px tall`, btc.controls.every(c => c.height >= 44), btc.controls.filter(c => c.height < 44));
      ok(`${P}: nothing leaves a card and nothing overlaps`, state.cards.every(c => c.outside.length === 0 && c.overlaps.length === 0), state.cards.flatMap(c => [...c.outside, ...c.overlaps]));
      ok(`${P}: a long contract and quantity stay inside the card`, pepe.ticker === '1000PEPEUSDT' && pepe.outside.length === 0 && pepe.rect.right <= state.viewport, Math.round(pepe.rect.height));
      await page.screenshot({ path: path.join(OUT, `${P}-positions.png`), animations: 'disabled' });
      await page.locator('.futures-position-row').first().screenshot({ path: path.join(OUT, `${P}-card.png`), animations: 'disabled' });

      // The same controls do the same things.
      const first = page.locator('.futures-position-row').first();
      await first.locator('.fut-tpslTrigger').click();
      const editor = page.locator('.fut-tpslPopover');
      await editor.waitFor({ timeout: 5000 });
      const box = await editor.boundingBox(), inputs = await editor.locator('.fut-tpslInput').count();
      ok(`${P}: «TP/SL» opens the protection editor inside the screen`, !!box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && inputs === 2, box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) });
      if (width === 390) await page.screenshot({ path: path.join(OUT, `${P}-tpsl-editor.png`), animations: 'disabled' });
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      if (await editor.count()) { await first.locator('.fut-tpslTrigger').click(); await page.waitForTimeout(150); }
      ok(`${P}: the editor closes again`, await editor.count() === 0);
      // The share key lies over the header cell: it must be the element a press lands on (2026-11-19: the cell used to take it).
      const share = await first.locator('.archive-pnl-open').evaluate(el => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { pressed: hit === el || el.contains(hit), hit: hit && hit.tagName }; });
      ok(`${P}: the result-card key in the corner of the card takes the press`, share.pressed, share);
      await first.locator('.futures-position-close[data-limit-close-open]').click();
      const dialog = page.locator('[data-limit-close-dialog="fixture-btc"]');
      await dialog.waitFor({ timeout: 5000 });
      ok(`${P}: «Лимитный» opens «Закрытие по лимиту» for this very position`, await dialog.getAttribute('data-limit-close-side') === 'LONG');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      ok(`${P}: no order or other write request was made and nothing left the stand`, view.writes.length === 0 && view.errors.length === 0, { writes: view.writes, errors: view.errors, external: [...new Set(view.external)] });
      await context.close();
    }

    // The native engine's P&L split takes a third row instead of the realized figure.
    {
      const { context, page, view } = await session(390, 844, { split: true });
      report.views.push(view);
      const state = await read(page), card = state.cards[0];
      const line = names => { const f = names.map(n => card.figures[n]); return f.every(Boolean) && Math.max(...f.map(x => x.bottom)) - Math.min(...f.map(x => x.bottom)) <= 1.5; };
      ok('390 split: net P&L beside size and margin, then the prices, then trading, funding and fees', card.split && card.labels.realized === null && line(['qty', 'margin', 'net']) && line(['entry', 'mark', 'liq']) && line(['trading', 'funding', 'fees'])
        && card.figures.trading.top > card.figures.entry.bottom && /3,090\.12/.test(card.text) && /-4\.21/.test(card.text) && /-7\.95/.test(card.text), { labels: card.labels, height: Math.round(card.rect.height) });
      ok('390 split: nothing leaves a card and nothing overlaps', state.cards.every(c => c.outside.length === 0 && c.overlaps.length === 0) && state.pageOverflow <= 1, state.cards.flatMap(c => [...c.outside, ...c.overlaps]));
      await page.locator('.futures-position-row').first().screenshot({ path: path.join(OUT, '390-card-split.png'), animations: 'disabled' });
      await context.close();
    }

    // The desktop row is not the card: the table stays a table and keeps its bracketed ROI.
    {
      const { context, page, view } = await session(1440, 900, { phone: false });
      report.views.push(view);
      const desktop = await page.evaluate(() => {
        const row = document.querySelector('.futures-position-row'), visible = el => !!el && getComputedStyle(el).display !== 'none';
        return { display: getComputedStyle(row).display, roiSide: visible(row.querySelector('.futures-position-roi-side')), roiBracket: row.querySelector('.futures-position-roi')?.textContent, mode: row.querySelector('.futures-position-mode')?.textContent.replace(/\s+/g, ' ').trim(),
          sideTagWidth: row.querySelector('.futures-position-contract > .futures-sr-only').getBoundingClientRect().width, headers: [...document.querySelectorAll('.futures-positions-table thead th')].map(th => th.textContent.trim()) };
      });
      ok('1440: the desktop table is unchanged — a table row, bracketed ROI, «Марж. торговля», the side said aloud only', desktop.display === 'table-row' && !desktop.roiSide && desktop.roiBracket === '(+16.92%)' && /^Марж\. торговля 10\.00x$/.test(desktop.mode)
        && desktop.sideTagWidth <= 1 && desktop.headers.includes('К-во') && desktop.headers.includes('Нереализованный P&L (ROI)'), desktop);
      await context.close();
    }
  } finally {
    await browser?.close();
    fixture?.kill();
  }
  report.checks = checks;
  report.passed = checks.filter(c => c.pass).length;
  report.failed = checks.filter(c => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
