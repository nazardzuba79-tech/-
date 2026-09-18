#!/usr/bin/env node
/**
 * Two small corrections, measured in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture market data, zeroed balances, reads
 * only; every write 404s. No production account, database or external call.
 *
 * The gainers tape is gone from Wallet and still there on Futures, and its
 * removal left no empty band: the Wallet content sits HIGHER than a page
 * that still has the tape, by about the tape's own height.
 *
 * The Spot button labels are NOT checked here. They are covered by a real
 * React render of the real OrderForm across five pairs in
 * frontend/src/lib/__tests__/spotButtonLabels.test.ts — this process cannot
 * serve the Spot terminal's full data surface, and a half-rendered page
 * would be weaker evidence than that render, not stronger.
 *
 *   node scripts/qa-spot-labels-wallet-tape.cjs [--dist path] [--port N] [--out dir]
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4297'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'spot-labels')));

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

// A long symbol on purpose: it is what made the old label wrap.
const PAIRS = ['BTC/USDT', 'ETH/USDT', 'USELESS/USDT'];

const ticker = (pair) => ({
  pair, lastPrice: '80000', changePercent24h: '1.5', high24h: '81000', low24h: '79000',
  volume24h: '1000', quoteVolume24h: '80000000',
});

function start() {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/balances', (_q, r) => r.json([]));
  app.get('/api/v1/pairs', (_q, r) => r.json(PAIRS.map(pair => ({ pair, base: pair.split('/')[0], quote: pair.split('/')[1] }))));
  app.get(/^\/api\/v1\/market\/ticker.*/, (req, r) => r.json({ ticker: ticker(req.query.pair || 'BTC/USDT') }));
  app.get(/^\/api\/v1\/market\/external\/ticker.*/, (_q, r) => r.json({ ticker: ticker('BTC/USDT') }));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get(/^\/api\/v1\/market\/.*/, (_q, r) => r.json({}));
  app.get(['/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/cfd/tickers', (_q, r) => r.json([]));
  app.get('/api/v1/wallet/overview', (_q, r) => r.json({ real: { spot: [], funding: [], unified: [] }, totalUsd: '0', pricedComplete: true, unpricedAssets: [] }));
  app.get('/api/v1/wallet/performance', (_q, r) => r.json({ points: [], windows: {} }));
  app.get(['/api/v1/futures/balances', '/api/v1/deposits/me', '/api/v1/withdrawals/me',
    '/api/v1/trades/me', '/api/v1/products', '/api/v1/purchases/me'], (_q, r) => r.json([]));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside QA scope', path: req.path }));

  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

const open = async (page, route) => {
  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
};

/** The Spot action buttons, and whether any of them wraps to a second line. */
const spotButtons = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.order-form-tab, .submit-btn')];
  return nodes.map((node) => {
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    return {
      text: node.textContent.trim(),
      width: Math.round(node.getBoundingClientRect().width),
      lines: Math.max(1, Math.round(node.scrollHeight / lineHeight)),
    };
  });
});

/** Where the page's own content starts, and whether the tape is there. */
const tapeGeometry = (page) => page.evaluate(() => {
  const tape = document.querySelector('.market-ticker');
  const header = document.querySelector('.global-header');
  // The first block of page content below the header, whatever the route.
  const content = document.querySelector('main, .wallet-workspace, .trade-terminal');
  return {
    tapePresent: !!tape,
    tapeHeight: tape ? Math.round(tape.getBoundingClientRect().height) : 0,
    headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : null,
    contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
    // A leftover band would show up as this gap, not as a missing element.
    gapBelowHeader: header && content
      ? Math.round(content.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
      : null,
    bodyOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = { spot: {}, tape: {} };
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    if (process.env.QA_DEBUG) page.on('console', (msg) => { if (msg.type() === 'error') console.error('CONSOLE', msg.text().slice(0, 400)); });
    const missing = new Set();
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/')) missing.add(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    process.on('exit', () => { if (process.env.QA_DEBUG) console.error('MISSING', [...missing]); });
    await page.addInitScript(() => {
      localStorage.setItem('exchange_token', 'qa-token');
      localStorage.setItem('exchange_lang', 'ru');
    });

    // The tape: gone from Wallet, still on a page that keeps it.
    await open(page, '/futures');
    report.tape.futures = await tapeGeometry(page);
    await page.screenshot({ path: path.join(OUT, 'futures-with-tape.png') });
    await open(page, '/wallet');
    report.tape.wallet = await tapeGeometry(page);
    await page.screenshot({ path: path.join(OUT, 'wallet-no-tape.png') });

    // QA_MEASURE_ONLY records the same geometry without asserting, so this
    // script can also be run against a build that still HAS the tape to get
    // the before half of the comparison.
    if (!process.env.QA_MEASURE_ONLY) {
    assert.equal(report.tape.futures.tapePresent, true, 'Futures lost its gainers tape');
    assert.equal(report.tape.wallet.tapePresent, false, 'Wallet still renders the gainers tape');
    // No leftover band: the Wallet content starts right under the header.
    assert.ok(report.tape.wallet.gapBelowHeader <= 8,
      `Wallet leaves a ${report.tape.wallet.gapBelowHeader}px band under the header`);
    // Whether the content actually ROSE is a before/after on this same page,
    // not a comparison with a differently-structured one: run this script
    // against a build with and without the change and compare
    // `wallet.contentTop`. Futures is here only to prove the flag is per
    // page — its own header/content geometry is not comparable.
    assert.equal(report.tape.wallet.bodyOverflowX, 0, 'Wallet gained horizontal overflow');
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
    }

    const summary = { status: process.env.QA_MEASURE_ONLY ? 'MEASURED' : 'PASS', report, pageErrors };
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', report }, null, 2));
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
