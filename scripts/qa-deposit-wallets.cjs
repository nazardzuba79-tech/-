#!/usr/bin/env node
/**
 * The header's Депозит button, driven in a real browser.
 *
 * LOCAL PRESENTATION QA ONLY. The addresses below are obvious placeholders
 * and are never valid deposit destinations; no production account, database,
 * treasury, external request or write is involved. Every route this serves
 * is a read, and anything outside the deposit contract 404s.
 *
 * It runs the screen twice against the SAME built bundle:
 *
 *   current  — the API carries each chain's address in the config envelope,
 *              so the whole list costs one request;
 *   fallback — an API that has not shipped that field yet, which is what a
 *              frontend deploy reaching a not-yet-updated backend sees. The
 *              list must come out identical, sourced from the per-chain
 *              /deposit-address/:chain route instead.
 *
 * Plus a degraded case where one chain has no address at all: that wallet
 * must be absent rather than rendered blank.
 *
 *   node scripts/qa-deposit-wallets.cjs [--dist path] [--port N] [--out dir]
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4287'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'deposit-wallets')));

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

// Placeholder destinations. Long enough to exercise the wrapping a real
// address causes, and unmistakably not spendable.
const WALLETS = {
  bitcoin: { address: 'QA-ONLY-bc1q-NOT-A-VALID-DEPOSIT-ADDRESS-0001', supportedAssets: ['BTC'] },
  tron: { address: 'QA-ONLY-T-NOT-A-VALID-DEPOSIT-ADDRESS-0002', supportedAssets: ['USDT'] },
  ethereum: { address: 'QA-ONLY-0x-NOT-A-VALID-DEPOSIT-ADDRESS-0003', supportedAssets: ['ETH', 'USDT'] },
  bsc: { address: 'QA-ONLY-0x-NOT-A-VALID-DEPOSIT-ADDRESS-0004', supportedAssets: ['BNB', 'USDT'] },
  solana: { address: 'QA-ONLY-So-NOT-A-VALID-DEPOSIT-ADDRESS-0005', supportedAssets: ['SOL', 'USDT'] },
  ton: { address: 'QA-ONLY-UQ-NOT-A-VALID-DEPOSIT-ADDRESS-0006', supportedAssets: ['TON', 'USDT'] },
};
const NATIVE = { bitcoin: 'BTC', tron: 'TRX', ethereum: 'ETH', bsc: 'BNB', solana: 'SOL', ton: 'TON' };

/** `mode` decides what the API pretends to be, per the header comment. */
let mode = 'current';

function start() {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const chains = () => Object.entries(WALLETS)
    .filter(([chain]) => !(mode === 'degraded' && chain === 'solana'))
    .map(([chain, wallet]) => ({
      chain, nativeAsset: NATIVE[chain],
      tokens: wallet.supportedAssets.filter(asset => asset !== NATIVE[chain]),
      supportedAssets: wallet.supportedAssets,
      // `fallback` is an API predating the field; `degraded` keeps solana in
      // the list but cannot resolve it, which is the case the UI must drop.
      ...(mode === 'fallback' ? {} : { address: wallet.address }),
    }));

  app.get('/api/v1/deposit-chains', (req, res) => {
    const list = mode === 'degraded'
      ? [...chains(), { chain: 'solana', nativeAsset: 'SOL', tokens: ['USDT'], supportedAssets: ['SOL', 'USDT'] }]
      : chains();
    res.json(req.query.includeConfig === 'true'
      ? { chains: list, minDepositUsd: 20, usdPeggedAssets: ['USDT'] }
      : list.map(({ supportedAssets, address, ...rest }) => rest));
  });

  app.get('/api/v1/deposit-address/:chain', (req, res) => {
    // In `degraded` this chain has no address anywhere, exactly as the real
    // route behaves for a chain with no treasury configured.
    if (mode === 'degraded' && req.params.chain === 'solana') return res.status(404).json({ error: 'Unconfigured' });
    const wallet = WALLETS[req.params.chain];
    if (!wallet) return res.status(404).json({ error: 'Unconfigured' });
    res.json({ chain: req.params.chain, ...wallet, note: 'LOCAL TEST FIXTURE. Never send funds.' });
  });

  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/market/external/rankings', (_req, res) => res.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_req, res) => res.json({ conversation: null, messages: [] }));
  app.all('/api/*', (req, res) => res.status(404).json({ error: 'Outside deposit QA scope', path: req.path }));

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

/** Open the header's deposit modal and read back what it actually rendered. */
async function openModal(page, width) {
  await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  if (width === 390) {
    // Below the mobile breakpoint the money pair lives in the burger menu.
    const burger = page.locator('.mobile-menu-btn, .burger, [aria-label="Menu"]').first();
    if (await burger.count()) await burger.click().catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.locator('button.deposit-button').first().click();
  await page.waitForSelector('.modal-liquid-glass', { timeout: 5000 });
  await page.waitForTimeout(700);

  // The list is taller than the old one-address screen, so the bottom of it
  // is where a floating overlay would sit on top of a Copy button. Read the
  // modal scrolled to its end, which is the worst case.
  await page.evaluate(() => { const m = document.querySelector('.modal-liquid-glass'); m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(300);

  return page.evaluate(() => {
    const modal = document.querySelector('.modal-liquid-glass');
    const text = modal.innerText;
    const buttons = [...modal.querySelectorAll('button')];
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const hits = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    // Anything fixed and stacked above the modal — the support launcher is
    // the one that actually floats over this corner.
    const modalZ = Number(getComputedStyle(modal.parentElement).zIndex) || 0;
    const floating = [...document.querySelectorAll('body *')].filter((el) => {
      const style = getComputedStyle(el);
      return style.position === 'fixed' && (Number(style.zIndex) || 0) > modalZ
        && !modal.contains(el) && !el.contains(modal) && el.getBoundingClientRect().width > 0
        && style.visibility !== 'hidden' && style.display !== 'none';
    }).map((el) => ({ z: Number(getComputedStyle(el).zIndex) || 0, ...box(el) }));
    const copies = buttons.filter(b => (b.getAttribute('aria-label') || '').includes('опировать')).map(box);
    return {
      text,
      selects: modal.querySelectorAll('select').length,
      copyButtons: copies.length,
      addresses: [...modal.querySelectorAll('.mono')].map(node => node.textContent.trim()),
      scrollOverflow: modal.scrollHeight - modal.clientHeight,
      width: Math.round(modal.getBoundingClientRect().width),
      modalZ,
      coveredCopyButtons: copies.filter(c => floating.some(f => hits(f, c))).length,
      floatingAbove: floating.length,
      warningTones: [...modal.querySelectorAll('p')]
        .filter(node => node.textContent?.includes('Отправляй на этот адрес'))
        .map(node => getComputedStyle(node).color),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const checks = [];
  const report = {};
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const scenario of ['current', 'fallback', 'degraded']) {
      mode = scenario;
      report[scenario] = {};

      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        const page = await context.newPage();
        await page.addInitScript(() => {
          localStorage.setItem('exchange_token', 'qa-deposit-token');
          localStorage.setItem('exchange_lang', 'ru');
        });

        const seen = await openModal(page, width);
        report[scenario][width] = seen;
        await page.screenshot({ path: path.join(OUT, `${scenario}-${width}.png`), fullPage: false });
        await context.close();

        const expected = scenario === 'degraded'
          ? Object.keys(WALLETS).filter(c => c !== 'solana')
          : Object.keys(WALLETS);

        // Every wallet that resolved is printed in full, none abbreviated.
        for (const chain of expected) assert.ok(seen.addresses.includes(WALLETS[chain].address),
          `${scenario}/${width}: ${chain} address missing from the modal`);
        assert.equal(seen.addresses.length, expected.length,
          `${scenario}/${width}: expected ${expected.length} addresses, saw ${seen.addresses.length}`);
        // The network picker is gone, and no address renders empty.
        assert.equal(seen.selects, 0, `${scenario}/${width}: a <select> is still in the modal`);
        assert.ok(seen.addresses.every(address => address.length > 10), `${scenario}/${width}: a blank address rendered`);
        assert.equal(seen.copyButtons, expected.length, `${scenario}/${width}: one copy button per wallet expected`);
        // One warning per wallet, under the address it belongs to, naming
        // that wallet's own assets — not one generic notice for all six.
        const warnings = seen.text.match(/Отправляй на этот адрес только/g) ?? [];
        assert.equal(warnings.length, expected.length,
          `${scenario}/${width}: expected ${expected.length} per-address warnings, saw ${warnings.length}`);
        // Amber, not the red this app uses for a loss or a failure.
        assert.ok(seen.warningTones.length > 0, `${scenario}/${width}: no warning found to sample`);
        for (const tone of seen.warningTones) {
          const [r, g, b] = tone.match(/\d+(\.\d+)?/g).map(Number);
          assert.ok(r > b && g > b, `${scenario}/${width}: warning tone ${tone} is not amber`);
          assert.ok(!(r > 150 && g < 90), `${scenario}/${width}: warning tone ${tone} reads as red`);
        }
        assert.match(seen.text, /от 20 \$/, `${scenario}/${width}: minimum not shown`);
        assert.ok(!seen.text.includes('{'), `${scenario}/${width}: an unsubstituted placeholder rendered`);
        // A wallet the user cannot tap to copy is a wallet they do not have.
        assert.equal(seen.coveredCopyButtons, 0,
          `${scenario}/${width}: ${seen.coveredCopyButtons} copy button(s) sit under a floating overlay`);
      }

      if (scenario === 'degraded') {
        assert.ok(!report.degraded[1440].text.includes(WALLETS.solana.address));
        // It says a wallet could not be loaded rather than listing five silently.
        assert.match(report.degraded[1440].text, /Не удалось загрузить адрес/);
        checks.push('an unresolvable chain is dropped, not blank, and the screen says so');
      }
      checks.push(`${scenario}: every configured wallet listed at 1440 and 390, no network picker`);
    }

    // The two API shapes must produce the same list, or the deploy window
    // would quietly show the user a different set of wallets.
    assert.deepEqual(report.current[1440].addresses, report.fallback[1440].addresses);
    checks.push('the one-request and per-chain paths render an identical wallet list');

    // Copy puts the real address on the clipboard, not a truncated label.
    mode = 'current';
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('exchange_token', 'qa-deposit-token');
      localStorage.setItem('exchange_lang', 'ru');
    });
    await openModal(page, 1440);
    await page.locator('.modal-liquid-glass button[aria-label*="Ethereum"]').first().click();
    await page.waitForTimeout(300);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboard, WALLETS.ethereum.address, 'copy did not put the full address on the clipboard');
    const copiedLabels = await page.evaluate(() =>
      [...document.querySelectorAll('.modal-liquid-glass button')].filter(b => b.textContent.trim() === 'Скопировано').length);
    // Only the button that was pressed acknowledges; six at once would be a lie.
    assert.equal(copiedLabels, 1, 'more than one copy button reported success');
    checks.push('copy yields the full address and only the pressed button confirms');
    await context.close();

    const summary = { status: 'PASS', checks, report };
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
