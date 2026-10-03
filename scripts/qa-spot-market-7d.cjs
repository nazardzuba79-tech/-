'use strict';
/**
 * SPOT MARKET LIST «Цена · 24ч % · 7д %» — browser regression.
 *
 * Real production bundle, real components and CSS, stubbed read-only API
 * (no backend, no writes, no secrets). At 1920, 1440 and 1366 and at panel
 * widths 240, 250, 258 (default), 300 and 340 it measures:
 *   - every price, 24h and 7d cell fits its column (a sub-satoshi price is
 *     the one allowed overflow: it ends in "…" and keeps its full title);
 *   - each header label sits over its column (±1px);
 *   - no horizontal overflow of the list or the page, no wrapped row;
 *   - the pair name never runs into the price;
 *   - the logo is hidden only below 250px.
 * And once: «7д %» sorts descending → ascending → normal list with unknown
 * weeks last, unknown weeks read «—» (never 0%), and the 24h cells are the
 * same before and after.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const dist = path.resolve(__dirname, '../frontend/dist');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/spot-market-7d');
// pair, price, 24h %, quote volume
const TICKERS = [
  ['NRX/USDT', '1.4582', '82.28', 4e9], ['VTA/USDT', '0.810005', '1.25', 3.5e9],
  ['BTC/USDT', '84555.10', '0.06', 3.2e9], ['ETH/USDT', '2674.40', '0.24', 1.9e9], ['USDC/USDT', '1.0000', '0.01', 9e8],
  ['XRP/USDT', '1.4855', '0.06', 8e8], ['SOL/USDT', '119.08', '0.39', 7e8], ['PUMP/USDT', '0.005403', '0.32', 6e8],
  ['NEAR/USDT', '4.6398', '-1.13', 5e8], ['MOG/USDT', '0.000000123456', '2.50', 4e8], ['NIGHT/USDT', '0.04992', '2.02', 3e8],
  ['HYPE/USDT', '88.07', '-1.13', 2.5e8], ['FARTCOIN/USDT', '1.2345', '-12.34', 2e8], ['ZEC/USDT', '1315.14', '1.14', 1.5e8],
  ['QNT/USDT', '251.18', '1.71', 1e8], ['LTC/USDT', '68.87', '-1.46', 9e7], ['TAO/USDT', '290.56', '-0.56', 8e7],
  ['BTC/USD', '84560.00', '0.07', 1e9], ['BTC/EUR', '72101.20', '-0.10', 3e8],
];
// symbol -> 7d. NEAR is ambiguous in the catalogue, ZEC has no reported week, NIGHT is absent.
const WEEKS = { BTC: 3.21, ETH: -5.674, USDC: 0.004, XRP: 12.34, SOL: -23.45, PUMP: 145.67, NEAR: 9.99, MOG: -8.9, HYPE: 7.77,
  FARTCOIN: -45.6, ZEC: null, QNT: 1.5, LTC: -0.004, TAO: 0.33 };

const app = express();
app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/market/display/spot-snapshot', (_q, r) => r.json({
  _display: { mode: 'snapshot', refreshMs: 60000, capturedAt: Date.now() },
  tickers: { available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: TICKERS.map(([pair, p, c, v]) => ({
    pair, lastPrice: p, bidPrice: p, askPrice: p, high24h: p, low24h: p, volume24h: '1', quoteVolume24h: String(v), changePercent24h: c })) },
  overview: { available: false, reason: 'qa' }, sentiment: { available: false, reason: 'qa' },
}));
app.get('/api/v1/market/assets', (_q, r) => {
  const assets = Object.entries(WEEKS).map(([symbol, week], i) => ({ id: symbol.toLowerCase(), symbol, name: symbol, logoUrl: null,
    providers: {}, tradingPairs: [], tradable: true, metadataSource: 'qa', rank: i + 1,
    ambiguous: symbol === 'NEAR', collidingIds: symbol === 'NEAR' ? ['near-other'] : [],
    market: { priceUsd: null, changePercent24h: null, changePercent7d: week, marketCapUsd: null, volume24hUsd: null, circulatingSupply: null } }));
  r.json({ available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: { assets, matched: assets.length,
    catalogueTotal: assets.length, tradableCount: assets.length, collisions: ['NEAR'], metadataComplete: true, limit: 1000, offset: 0 } });
});
app.get('/api/v1/market/assets/icons', (_q, r) => r.json({ icons: {} }));
app.use('/api/v1', (_q, r) => r.json([]));
app.use(express.static(dist, { index: false }));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));

const VIEWPORTS = [[1920, 1080], [1440, 900], [1366, 768]];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const findings = [];
  const report = { viewports: [], sort: null };
  const fail = (message) => findings.push(message);
  try {
    for (const [w, h] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
      // Fixture QA cannot reach production/providers or submit a financial write.
      await page.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== base || !['GET', 'HEAD'].includes(request.method())) return route.abort();
        return route.continue();
      });
      await page.addInitScript(() => { window.WebSocket = class { close() {} addEventListener() {} removeEventListener() {} }; });
      await page.addInitScript(() => { try { localStorage.setItem('exchange_token', 'local-qa'); localStorage.setItem('exchange_lang', 'ru'); } catch {} });
      await page.goto(`${base}/trade`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.spot-terminal .pair-row[data-pair="BTC/USDT"] .p-change-7d')?.textContent?.includes('%'), null, { timeout: 30000 });
      const separator = page.locator('.spot-terminal .pairs-resize-handle[role="separator"]');
      // 258 (default), then 240 (two steps left clamp), 250, 300, 340.
      const plan = [[258, []], [240, ['ArrowLeft', 'ArrowLeft']], [250, ['ArrowRight']], [300, Array(5).fill('ArrowRight')], [340, Array(4).fill('ArrowRight')]];
      for (const [expected, keys] of plan) {
        if (keys.length) { await separator.focus(); for (const key of keys) await page.keyboard.press(key); }
        await page.waitForTimeout(250);
        const width = Number(await separator.getAttribute('aria-valuenow'));
        if (width !== expected) fail(`${w}: panel ${width} != ${expected}`);
        const m = await page.evaluate(() => {
          const section = document.querySelector('.spot-terminal .pairs-section');
          const list = section.querySelector('.pairs-list');
          const head = [...section.querySelectorAll('.pairs-sort button')];
          const rows = [...list.querySelectorAll('.pair-row[data-pair]')];
          const out = { clipped: [], allowed: [], names: [], broken: [], headerClipped: [], baseSymbols: [] };
          for (const row of rows) {
            for (const [label, sel] of [['price', '.p-price'], ['24h', '.p-change:not(.p-change-7d)'], ['7d', '.p-change-7d']]) {
              const el = row.querySelector(sel);
              if (el.scrollWidth > el.clientWidth + 0.5) {
                const entry = `${row.dataset.pair} ${label} "${el.textContent}" ${el.scrollWidth}>${el.clientWidth}`;
                const subSatoshi = label === 'price' && el.textContent.length > 10 && el.getAttribute('title') === el.textContent
                  && getComputedStyle(el).textOverflow === 'ellipsis';
                (subSatoshi ? out.allowed : out.clipped).push(entry);
              }
            }
            const name = row.querySelector('.p-name').getBoundingClientRect(), price = row.querySelector('.p-price').getBoundingClientRect();
            const base = row.querySelector('.p-base');
            out.baseSymbols.push({ pair: row.dataset.pair, text: base.textContent,
              clipped: base.scrollWidth > base.clientWidth + .5,
              width: base.clientWidth, naturalWidth: base.scrollWidth });
            if (name.right > price.left + 0.5) out.names.push(row.dataset.pair);
            if (row.querySelector('.p-change-7d').getBoundingClientRect().top >= price.bottom) out.broken.push(row.dataset.pair);
          }
          for (const button of head) if (button.scrollWidth > button.clientWidth + 0.5) out.headerClipped.push(button.textContent.trim());
          const btc = rows.find(row => row.dataset.pair === 'BTC/USDT');
          const cells = ['.p-price', '.p-change:not(.p-change-7d)', '.p-change-7d'].map(sel => btc.querySelector(sel).getBoundingClientRect().right);
          out.align = head.map((button, i) => Math.round((cells[i] - button.getBoundingClientRect().right) * 10) / 10);
          out.icon = getComputedStyle(btc.querySelector('.p-icon')).display !== 'none';
          out.listOverflowX = list.scrollWidth - list.clientWidth;
          out.pageOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          out.tracks = getComputedStyle(btc.querySelector('.pair-select')).gridTemplateColumns;
          return out;
        });
        const tag = `${w}x${h} @${width}px`;
        for (const entry of m.clipped) fail(`${tag}: clipped ${entry}`);
        for (const pair of m.names) fail(`${tag}: name runs into price on ${pair}`);
        for (const pair of ['NRX/USDT', 'VTA/USDT', 'BTC/USDT', 'ETH/USDT']) {
          const symbol = m.baseSymbols.find(row => row.pair === pair);
          if (!symbol || symbol.clipped || symbol.text !== pair.split('/')[0]) fail(`${tag}: base ticker clipped/missing: ${pair}`);
        }
        for (const pair of m.broken) fail(`${tag}: row wrapped on ${pair}`);
        for (const label of m.headerClipped) fail(`${tag}: header clipped "${label}"`);
        if (m.align.some(delta => Math.abs(delta) > 1)) fail(`${tag}: header misaligned ${m.align}`);
        if (m.listOverflowX > 0 || m.pageOverflowX > 0) fail(`${tag}: horizontal overflow list ${m.listOverflowX} page ${m.pageOverflowX}`);
        if (m.icon !== (width >= 250)) fail(`${tag}: logo ${m.icon ? 'shown' : 'hidden'}`);
        report.viewports.push({ viewport: `${w}x${h}`, panel: width, ...m });
        // Search restores /USDT beside the base. Even a fractional-pixel flex
        // shrink can turn NRX into N… while scrollWidth/clientWidth round equal.
        const search = page.locator('.spot-terminal .pairs-search input');
        for (const symbol of ['NRX', 'VTA', 'BTC', 'ETH']) {
          await search.fill(symbol);
          const row = page.locator(`.spot-terminal .pair-row[data-pair="${symbol}/USDT"]`);
          const result = await row.evaluate(el => {
            const base = el.querySelector('.p-base'), quote = el.querySelector('.p-quote');
            const range = document.createRange(); range.selectNodeContents(base);
            const textWidth = range.getBoundingClientRect().width;
            const box = base.getBoundingClientRect();
            return { text: base.textContent, textWidth, width: box.width, quote: quote?.textContent,
              overlapsPrice: box.right > el.querySelector('.p-price').getBoundingClientRect().left + .1 };
          });
          if (result.text !== symbol || result.textWidth > result.width + .01 || result.overlapsPrice || result.quote !== '/USDT')
            fail(`${tag}: search ${symbol} truncated/overlaps: ${JSON.stringify(result)}`);
          if (symbol === 'NRX' && width === 258) await page.locator('.spot-terminal .pairs-section').screenshot({ path: path.join(OUT, `search-nrx-${w}.png`) });
        }
        await search.fill('');
        if ([240, 258, 340].includes(width)) {
          await page.waitForTimeout(600);
          const box = await page.locator('.spot-terminal .pairs-section').boundingBox();
          await page.screenshot({ path: path.join(OUT, `panel-${w}-${width}.png`),
            clip: { x: Math.max(0, box.x - 2), y: box.y, width: box.width + 4, height: Math.min(box.height, 620) } });
        }
      }
      if (errors.length) fail(`${w}: page errors ${errors.join(' | ')}`);
      if (w === 1440) report.sort = await sortCheck(page);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const status = findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ status, findings, ...report }, null, 2));
  console.log(JSON.stringify({ status, findings, sort: report.sort }, null, 2));
  process.exit(findings.length ? 1 : 0);

  async function sortCheck(page) {
    const state = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('.spot-terminal .pairs-list .pair-row[data-pair]')];
      return {
        order: rows.map(row => row.dataset.pair),
        h24: Object.fromEntries(rows.map(row => [row.dataset.pair, row.querySelector('.p-change:not(.p-change-7d)').textContent])),
        d7: Object.fromEntries(rows.map(row => [row.dataset.pair, row.querySelector('.p-change-7d').textContent])),
      };
    });
    const header = page.locator('.spot-terminal .pairs-sort [data-sort-field="change7d"]');
    const before = await state();
    await header.click(); const desc = await state();
    await header.click(); const asc = await state();
    await header.click(); const reset = await state();
    const week = (pair, s) => { const t = s.d7[pair]; return t === '—' ? null : Number(t.replace('%', '')); };
    const ordered = (s, dir) => {
      const known = s.order.filter(p => week(p, s) !== null), unknown = s.order.filter(p => week(p, s) === null);
      const isSorted = known.every((p, i) => i === 0 || (week(known[i - 1], s) - week(p, s)) * dir >= 0);
      return isSorted && s.order.slice(known.length).every(p => unknown.includes(p));
    };
    if (!ordered(desc, 1)) fail(`sort: 7d descending wrong ${desc.order}`);
    if (!ordered(asc, -1)) fail(`sort: 7d ascending wrong ${asc.order}`);
    if (JSON.stringify(reset.order) !== JSON.stringify(before.order)) fail('sort: third click did not restore the normal list');
    // Compared pair by pair: the row order is exactly what sorting changes.
    const cells = (map) => JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
    for (const s of [desc, asc, reset]) if (cells(s.h24) !== cells(before.h24)) fail('sort: 24h cells changed');
    for (const pair of ['NEAR/USDT', 'NIGHT/USDT', 'ZEC/USDT']) if (before.d7[pair] !== '—') fail(`null: ${pair} shows ${before.d7[pair]}`);
    if (Object.values(before.d7).some(text => /^[+-]?0%$/.test(text))) fail('null: an unknown week reads 0%');
    return { before: before.order, desc: desc.order, asc: asc.order, reset: reset.order, unknown: ['NEAR/USDT', 'NIGHT/USDT', 'ZEC/USDT'].map(p => `${p} ${before.d7[p]}`) };
  }
})().catch(error => { console.error(error); process.exit(1); });
