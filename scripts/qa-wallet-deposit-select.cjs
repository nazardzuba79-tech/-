#!/usr/bin/env node
/**
 * The Wallet page's deposit modal, driven in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. Placeholder addresses, zeroed balances, reads
 * only; no production account, database, treasury or external request.
 *
 * It exists to answer one question with evidence rather than reading: when
 * you open the network picker and choose a different network, does the
 * screen actually move — new address, new asset list — or does it sit
 * there? It reports what each step changed, and fails if a pick leaves the
 * address untouched.
 *
 *   node scripts/qa-wallet-deposit-select.cjs [--dist path] [--port N] [--out dir]
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4293'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'wallet-deposit')));

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const WALLETS = {
  bitcoin: { address: 'QA-ONLY-bc1q-NOT-A-VALID-DEPOSIT-ADDRESS-0001', supportedAssets: ['BTC'], nativeAsset: 'BTC' },
  tron: { address: 'QA-ONLY-T-NOT-A-VALID-DEPOSIT-ADDRESS-0002', supportedAssets: ['USDT'], nativeAsset: 'TRX' },
  ethereum: { address: 'QA-ONLY-0x-NOT-A-VALID-DEPOSIT-ADDRESS-0003', supportedAssets: ['ETH', 'USDT'], nativeAsset: 'ETH' },
};

function start() {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/api/v1/deposit-chains', (req, res) => {
    const list = Object.entries(WALLETS).map(([chain, w]) => ({
      chain, nativeAsset: w.nativeAsset,
      tokens: w.supportedAssets.filter(a => a !== w.nativeAsset),
      supportedAssets: w.supportedAssets, address: w.address,
    }));
    res.json(req.query.includeConfig === 'true'
      ? { chains: list, minDepositUsd: 300, usdPeggedAssets: ['USDT'] }
      : list.map(({ supportedAssets, address, ...rest }) => rest));
  });
  app.get('/api/v1/deposit-address/:chain', (req, res) => {
    const wallet = WALLETS[req.params.chain];
    if (!wallet) return res.status(404).json({ error: 'Unconfigured' });
    res.json({ chain: req.params.chain, address: wallet.address, supportedAssets: wallet.supportedAssets,
      note: 'LOCAL TEST FIXTURE. Never send funds.' });
  });
  // A non-USD-pegged asset needs a ticker for its minimum equivalent.
  app.get('/api/v1/market/external/ticker', (_req, res) => res.json({ ticker: { lastPrice: '80000' } }));
  app.get(/^\/api\/v1\/market\/external\/ticker\/.*/, (_req, res) => res.json({ ticker: { lastPrice: '80000' } }));

  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/wallet/overview', (_req, res) => res.json({
    real: { spot: [], funding: [], unified: [] }, totalUsd: '0', pricedComplete: true, unpricedAssets: [] }));
  app.get('/api/v1/wallet/performance', (_req, res) => res.json({ points: [], windows: {} }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], (_req, res) => res.json([]));
  app.get(['/api/v1/deposits/me', '/api/v1/withdrawals/me', '/api/v1/trades/me',
    '/api/v1/products', '/api/v1/purchases/me'], (_req, res) => res.json([]));
  app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_req, res) => res.json({ conversation: null, messages: [] }));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside wallet deposit QA scope', path: req.path }));

  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
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

/** Everything the modal is currently telling the user. */
const readModal = (page) => page.evaluate(() => {
  const modal = [...document.querySelectorAll('div')].find(el => el.textContent?.includes('Пополнение') && el.querySelector('button'));
  const scope = modal ?? document.body;
  const trigger = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const labels = [...scope.querySelectorAll('p,span,dt')].map(n => n.textContent?.trim()).filter(Boolean);
  const address = [...scope.querySelectorAll('.num, .mono')].map(n => n.textContent?.trim()).find(t => t && t.startsWith('QA-')) ?? null;
  return {
    network: trigger('deposit-network'),
    asset: trigger('deposit-asset'),
    address,
    // The order the two pickers appear in, top to bottom.
    order: [...scope.querySelectorAll('#deposit-network, #deposit-asset')].map(n => n.id),
    warningTone: (() => {
      const warn = [...scope.querySelectorAll('p')].find(n => n.textContent?.includes('только'));
      return warn ? getComputedStyle(warn).backgroundColor : null;
    })(),
    text: labels.join(' | ').slice(0, 400),
  };
});

async function openList(page, id) {
  await page.locator(`#${id}`).click();
  await page.waitForTimeout(250);
  return page.evaluate((listId) => {
    const list = document.getElementById(`${listId}-listbox`);
    return list ? [...list.querySelectorAll('[role="option"]')].map(o => o.textContent.trim()) : [];
  }, id);
}

/** Open the list if it is closed, then choose. */
async function pick(page, id, label) {
  if (!(await page.locator(`#${id}-listbox`).count())) {
    await page.locator(`#${id}`).click();
    await page.waitForTimeout(250);
  }
  await page.locator(`#${id}-listbox [role="option"]`, { hasText: label }).first().click();
  await page.waitForTimeout(900);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const steps = [];
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(String(error)));
    await page.addInitScript(() => {
      localStorage.setItem('exchange_token', 'qa-wallet-token');
      localStorage.setItem('exchange_lang', 'ru');
    });

    await page.goto(`http://127.0.0.1:${PORT}/wallet?action=deposit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    // The deep link may not open it; fall back to the page's own button.
    if (!(await page.locator('#deposit-network').count())) {
      await page.locator('button', { hasText: 'Внести' }).first().click();
      await page.waitForTimeout(1200);
    }
    await page.waitForSelector('#deposit-network', { timeout: 8000 });

    const opened = { step: 'opened', ...(await readModal(page)) };
    steps.push(opened);
    await page.screenshot({ path: path.join(OUT, '1-opened.png') });

    const assetList = await openList(page, 'deposit-asset');
    steps.push({ step: 'asset list', assets: assetList });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // USDT rides two of the three fixture chains; that is the case the old
    // network-first order could not express.
    await pick(page, 'deposit-asset', 'USDT');
    const onUsdt = { step: 'picked USDT', ...(await readModal(page)) };
    steps.push(onUsdt);
    const usdtNetworks = await openList(page, 'deposit-network');
    steps.push({ step: 'networks for USDT', networks: usdtNetworks });
    await page.screenshot({ path: path.join(OUT, '2-usdt.png') });

    await pick(page, 'deposit-network', 'Ethereum');
    const usdtOnEth = { step: 'USDT on Ethereum', ...(await readModal(page)) };
    steps.push(usdtOnEth);
    await page.screenshot({ path: path.join(OUT, '3-usdt-ethereum.png') });

    await pick(page, 'deposit-asset', 'BTC');
    const onBtc = { step: 'picked BTC', ...(await readModal(page)) };
    steps.push(onBtc);
    const btcNetworks = await openList(page, 'deposit-network');
    steps.push({ step: 'networks for BTC', networks: btcNetworks });
    await page.screenshot({ path: path.join(OUT, '4-btc.png') });

    fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ steps, pageErrors: failures }, null, 2));

    // Asset sits above network, both on screen.
    assert.deepEqual(opened.order, ['deposit-asset', 'deposit-network'],
      `asset must come first, saw ${opened.order.join(' then ')}`);
    // Every asset the wallets credit is offered, none invented.
    assert.deepEqual([...assetList].sort(), ['BTC', 'ETH', 'USDT']);
    // The asset picker is the one with somewhere to go: USDT spans two chains.
    assert.equal(usdtNetworks.length, 2, `USDT should offer two networks, saw ${usdtNetworks.length}`);
    assert.ok(usdtNetworks.some(n => n.includes('TRC-20')) && usdtNetworks.some(n => n.includes('Ethereum')));
    // Switching network within one asset moves the address.
    assert.ok(usdtOnEth.address && usdtOnEth.address !== onUsdt.address, 'switching network did not change the address');
    // BTC narrows the network list to the one chain that credits it, and the
    // address follows the asset rather than staying on the old chain.
    assert.deepEqual(btcNetworks, ['Bitcoin']);
    assert.ok(onBtc.address && onBtc.address !== usdtOnEth.address, 'switching asset did not change the address');
    assert.equal(failures.length, 0, `page errors: ${failures.join('; ')}`);

    console.log(JSON.stringify({ status: 'PASS', steps, pageErrors: failures }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', steps }, null, 2));
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
