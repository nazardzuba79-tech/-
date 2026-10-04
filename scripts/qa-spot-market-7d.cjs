'use strict';
/**
 * SPOT COMPACT MARKET RAIL — browser regression.
 *
 * Owner 2026-10-04 removed 7d from the narrow terminal rail. The full Markets
 * page keeps 7d. This QA checks the real production bundle at 1920/1440/1366
 * and panel widths 240/250/258/300/340:
 *   - Price + 24h fit without cutting ticker/logo;
 *   - logo stays visible even at 240px;
 *   - search keeps NRX/VTA/BTC/ETH readable;
 *   - «Новые» promotes simulated/listed assets newest-first and toggles back;
 *   - no horizontal overflow or wrapped rows.
 */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const dist = path.resolve(__dirname, '../frontend/dist');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/spot-market-7d');

const TICKERS = [
  ['BTC/USDT', '84555.10', '0.06', 3.2e9], ['ETH/USDT', '2674.40', '0.24', 1.9e9], ['USDC/USDT', '1.0000', '0.01', 9e8],
  ['XRP/USDT', '1.4855', '0.06', 8e8], ['SOL/USDT', '119.08', '0.39', 7e8], ['PUMP/USDT', '0.005403', '0.32', 6e8],
  ['NEAR/USDT', '4.6398', '-1.13', 5e8], ['MOG/USDT', '0.000000123456', '2.50', 4e8], ['NIGHT/USDT', '0.04992', '2.02', 3e8],
  ['HYPE/USDT', '88.07', '-1.13', 2.5e8], ['FARTCOIN/USDT', '1.2345', '-12.34', 2e8], ['ZEC/USDT', '1315.14', '1.14', 1.5e8],
  ['QNT/USDT', '251.18', '1.71', 1e8], ['LTC/USDT', '68.87', '-1.46', 9e7], ['TAO/USDT', '290.56', '-0.56', 8e7],
  ['BTC/USD', '84560.00', '0.07', 1e9], ['BTC/EUR', '72101.20', '-0.10', 3e8],
];

const now = Date.parse('2026-10-04T08:00:00Z');
const testAsset = (symbol, listingAt, price, change, tradable) => ({
  pair: symbol + '/USDT', symbol, name: symbol === 'NRX' ? 'NEURIX' : 'VOLTORA', quote: 'USDT',
  isTestAsset: true, isTradable: tradable, status: 'SPOT', listingArmed: true, listingAt,
  initialPrice: symbol === 'NRX' ? 0.8 : 0.01,
  state: { phase: 'live', lastPrice: price, openPrice24h: price / (1 + change / 100), change24hPercent: change,
    high24h: price * 1.1, low24h: price * .9, volume24h: 1000, quoteVolume24h: 1000000, serverTime: now },
});
const TEST_ASSETS = [
  testAsset('VTA', '2026-09-28T14:00:00.000Z', .81, 10, false),
  testAsset('NRX', '2026-10-03T18:00:00.000Z', 44.2, 5424.38, true),
];

const app = express();
app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa', displayName: 'QA', email: 'qa@example.invalid', kycStatus: 'NOT_STARTED', isAdmin: false, role: 'USER' }));
app.get('/api/v1/market/display/spot-snapshot', (_q, r) => r.json({
  _display: { mode: 'snapshot', refreshMs: 60000, capturedAt: Date.now() },
  tickers: { available: true, source: 'qa', fetchedAt: Date.now(), stale: false, value: TICKERS.map(([pair, p, c, v]) => ({
    pair, lastPrice: p, bidPrice: p, askPrice: p, high24h: p, low24h: p, volume24h: '1', quoteVolume24h: String(v), changePercent24h: c })) },
  overview: { available: false, reason: 'qa' }, sentiment: { available: false, reason: 'qa' },
}));
app.get('/api/v1/market/test-assets', (_q, r) => r.json({ serverTime: now, assets: TEST_ASSETS }));
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
  const report = { viewports: [], newest: null };
  const fail = (message) => findings.push(message);
  try {
    for (const [w, h] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
      await page.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== base || !['GET', 'HEAD'].includes(request.method())) return route.abort();
        return route.continue();
      });
      await page.addInitScript(() => { window.WebSocket = class { close() {} addEventListener() {} removeEventListener() {} }; });
      await page.addInitScript(() => { try { localStorage.setItem('exchange_token', 'local-qa'); localStorage.setItem('exchange_lang', 'ru'); } catch {} });
      await page.goto(`${base}/trade`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.spot-terminal .pair-row[data-pair="NRX/USDT"] .p-price')?.textContent?.trim(), null, { timeout: 30000 });
      if (await page.locator('.spot-terminal .p-change-7d').count()) fail(`${w}: 7d cell still exists in terminal rail`);
      if (await page.locator('.spot-terminal .pairs-sort [data-sort-field="change7d"]').count()) fail(`${w}: 7d sorter still exists in terminal rail`);

      const separator = page.locator('.spot-terminal .pairs-resize-handle[role="separator"]');
      const plan = [[258, []], [240, ['ArrowLeft', 'ArrowLeft']], [250, ['ArrowRight']], [300, Array(5).fill('ArrowRight')], [340, Array(4).fill('ArrowRight')]];
      for (const [expected, keys] of plan) {
        if (keys.length) { await separator.focus(); for (const key of keys) await page.keyboard.press(key); }
        await page.waitForTimeout(160);
        const width = Number(await separator.getAttribute('aria-valuenow'));
        if (width !== expected) fail(`${w}: panel ${width} != ${expected}`);
        const m = await page.evaluate(() => {
          const section = document.querySelector('.spot-terminal .pairs-section');
          const list = section.querySelector('.pairs-list');
          const rows = [...list.querySelectorAll('.pair-row[data-pair]')];
          const out = { clipped: [], names: [], broken: [], iconsMissing: [], baseSymbols: [] };
          for (const row of rows) {
            for (const [label, sel] of [['price', '.p-price'], ['24h', '.p-change']]) {
              const el = row.querySelector(sel);
              if (el.scrollWidth > el.clientWidth + .5) {
                const subSatoshi = label === 'price' && el.textContent.length > 10 && el.getAttribute('title') === el.textContent
                  && getComputedStyle(el).textOverflow === 'ellipsis';
                if (!subSatoshi) out.clipped.push(`${row.dataset.pair} ${label} "${el.textContent}" ${el.scrollWidth}>${el.clientWidth}`);
              }
            }
            const name = row.querySelector('.p-name').getBoundingClientRect();
            const price = row.querySelector('.p-price').getBoundingClientRect();
            const base = row.querySelector('.p-base');
            out.baseSymbols.push({ pair: row.dataset.pair, text: base.textContent, clipped: base.scrollWidth > base.clientWidth + .5 });
            if (name.right > price.left + .5) out.names.push(row.dataset.pair);
            if (row.getBoundingClientRect().height > 38) out.broken.push(row.dataset.pair);
            if (getComputedStyle(row.querySelector('.p-icon')).display === 'none') out.iconsMissing.push(row.dataset.pair);
          }
          const btc = rows.find(row => row.dataset.pair === 'BTC/USDT');
          const price = btc.querySelector('.p-price').getBoundingClientRect();
          const change = btc.querySelector('.p-change').getBoundingClientRect();
          const priceHead = section.querySelector('.pairs-sort [data-sort-field="price"]').getBoundingClientRect();
          const changeHead = section.querySelector('.pairs-sort [data-sort-field="change"]').getBoundingClientRect();
          out.align = [Math.round((price.right - priceHead.right) * 10) / 10, Math.round((change.right - changeHead.right) * 10) / 10];
          out.listOverflowX = list.scrollWidth - list.clientWidth;
          out.pageOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          out.tracks = getComputedStyle(btc.querySelector('.pair-select')).gridTemplateColumns;
          return out;
        });
        const tag = `${w}x${h} @${width}px`;
        for (const entry of m.clipped) fail(`${tag}: clipped ${entry}`);
        for (const pair of m.names) fail(`${tag}: name runs into price on ${pair}`);
        for (const pair of m.broken) fail(`${tag}: row wrapped on ${pair}`);
        if (m.iconsMissing.length) fail(`${tag}: hidden logos ${m.iconsMissing.join(', ')}`);
        for (const pair of ['NRX/USDT', 'VTA/USDT', 'BTC/USDT', 'ETH/USDT']) {
          const symbol = m.baseSymbols.find(row => row.pair === pair);
          if (!symbol || symbol.clipped || symbol.text !== pair.split('/')[0]) fail(`${tag}: base ticker clipped/missing: ${pair}`);
        }
        if (m.align.some(delta => Math.abs(delta) > 1)) fail(`${tag}: header misaligned ${m.align}`);
        if (m.listOverflowX > 0 || m.pageOverflowX > 0) fail(`${tag}: horizontal overflow list ${m.listOverflowX} page ${m.pageOverflowX}`);
        report.viewports.push({ viewport: `${w}x${h}`, panel: width, ...m });

        const search = page.locator('.spot-terminal .pairs-search input');
        for (const symbol of ['NRX', 'VTA', 'BTC', 'ETH']) {
          await search.fill(symbol);
          const row = page.locator(`.spot-terminal .pair-row[data-pair="${symbol}/USDT"]`);
          const result = await row.evaluate(el => {
            const base = el.querySelector('.p-base'), quote = el.querySelector('.p-quote');
            const range = document.createRange(); range.selectNodeContents(base);
            const textWidth = range.getBoundingClientRect().width, box = base.getBoundingClientRect();
            return { text: base.textContent, textWidth, width: box.width, quote: quote?.textContent,
              iconVisible: getComputedStyle(el.querySelector('.p-icon')).display !== 'none',
              overlapsPrice: box.right > el.querySelector('.p-price').getBoundingClientRect().left + .1 };
          });
          if (result.text !== symbol || result.textWidth > result.width + .01 || result.overlapsPrice || result.quote !== '/USDT' || !result.iconVisible)
            fail(`${tag}: search ${symbol} truncated/overlaps/icon: ${JSON.stringify(result)}`);
        }
        await search.fill('');
        if ([240, 258, 340].includes(width)) {
          const box = await page.locator('.spot-terminal .pairs-section').boundingBox();
          await page.screenshot({ path: path.join(OUT, `panel-${w}-${width}.png`),
            clip: { x: Math.max(0, box.x - 2), y: box.y, width: box.width + 4, height: Math.min(box.height, 620) } });
        }
      }
      if (errors.length) fail(`${w}: page errors ${errors.join(' | ')}`);
      if (w === 1440) report.newest = await newestCheck(page);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const status = findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ status, findings, ...report }, null, 2));
  console.log(JSON.stringify({ status, findings, newest: report.newest }, null, 2));
  process.exit(findings.length ? 1 : 0);

  async function newestCheck(page) {
    const order = () => page.evaluate(() => [...document.querySelectorAll('.spot-terminal .pairs-list .pair-row[data-pair]')].map(row => row.dataset.pair));
    const button = page.locator('.spot-terminal .pairs-sort [data-sort-field="new"]');
    const before = await order();
    await button.click();
    const newest = await order();
    if (newest[0] !== 'NRX/USDT' || newest[1] !== 'VTA/USDT') fail(`newest: expected NRX,VTA first; got ${newest.slice(0, 4).join(',')}`);
    if (await button.getAttribute('aria-pressed') !== 'true') fail('newest: button is not active after click');
    await button.click();
    const reset = await order();
    if (JSON.stringify(reset) !== JSON.stringify(before)) fail('newest: second click did not restore normal ranking');
    return { before, newest, reset };
  }
})().catch(error => { console.error(error); process.exit(1); });
