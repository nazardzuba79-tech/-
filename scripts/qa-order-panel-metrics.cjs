#!/usr/bin/env node
/**
 * Computed geometry and colour of the Futures order column.
 *
 * Reads the REAL build through `qa-futures-account-harness.cjs`, so every
 * number below is what the browser computed for the shipped CSS — not a
 * value read off a screenshot. Run it on a `main` build and on a branch
 * build to get a true before/after table.
 *
 *   node scripts/qa-order-panel-metrics.cjs [--dist path] [--port N]
 *                                           [--token qa-user-a] [--width 1440]
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4301'));
const TOKEN = arg('--token', 'qa-user-c');
const WIDTH = Number(arg('--width', '1440'));
const HEIGHT = Number(arg('--height', '900'));

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const waitForServer = (port) => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

(async () => {
  const harness = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'qa-futures-account-harness.cjs'), '--port', String(PORT), '--dist', DIST,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  let out;
  try {
    await waitForServer(PORT);
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await context.newPage();
    await page.addInitScript((t) => {
      localStorage.setItem('exchange_token', t);
      localStorage.setItem('voltex_lang', 'ru');
    }, TOKEN);
    await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // ENABLED-STATE PASS. The ticket loads empty, so the submit pair starts
    // disabled — measuring it there and calling it the button's colour is
    // exactly the mistake of reading a palette off a screenshot of a
    // disabled control. Type a quantity first, then read both states.
    const submitState = async () => page.evaluate(() => {
      const read = (sel) => {
        const n = document.querySelector(sel); if (!n) return null;
        const s = getComputedStyle(n), r = n.getBoundingClientRect();
        return { disabled: n.disabled === true, text: n.textContent.trim(),
          w: Math.round(r.width), h: Math.round(r.height), radius: s.borderRadius,
          bg: s.backgroundColor, color: s.color, opacity: s.opacity,
          font: `${s.fontSize}/${s.fontWeight}` };
      };
      return { buy: read('.submit-btn.buy'), sell: read('.submit-btn.sell') };
    });
    const disabledState = await submitState();
    // This harness serves no market feed, so the LIMIT price never
    // auto-seeds and `orderSizeKnown` stays false. Both fields have to be
    // typed for the pair to enable — which is the guard doing its job, and
    // is exactly why the owner's screenshot shows dim buttons beside an
    // empty quantity. Nothing here disables a check to get a brighter frame.
    const price = await page.$('.fo-priceInputRow input');
    const qty = await page.$('.fo-qtyInputRow input');
    if (price) { await price.fill('77000'); await page.waitForTimeout(400); }
    if (qty) { await qty.fill('0.01'); await page.waitForTimeout(700); }
    const enabledState = await submitState();
    if (qty) { await qty.fill(''); }
    if (price) { await price.fill(''); }
    await page.waitForTimeout(400);

    out = await page.evaluate(() => {
      const px = (v) => Math.round(parseFloat(v) * 100) / 100;
      const probe = (label, selector, index = 0) => {
        const nodes = [...document.querySelectorAll(selector)];
        const node = nodes[index];
        if (!node) return { label, selector, missing: true, count: nodes.length };
        const s = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        return {
          label, selector, count: nodes.length,
          w: px(r.width), h: px(r.height), left: px(r.left), right: px(r.right),
          radius: s.borderRadius,
          bg: s.backgroundColor,
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
          color: s.color,
          font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`,
          padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
        };
      };
      const terminal = document.querySelector('.terminal');
      return {
        viewport: `${innerWidth}x${innerHeight}`,
        dpr: devicePixelRatio,
        terminalColumns: terminal ? getComputedStyle(terminal).gridTemplateColumns : null,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        probes: [
          probe('order column', '.fo-panel'),
          probe('order form', '.fo-form'),
          probe('margin/leverage row', '.fo-mlRow'),
          probe('margin select', '.fo-mlTrigger', 0),
          probe('leverage select', '.fo-mlTrigger', 1),
          probe('price field', '.fo-priceInputRow', 0),
          probe('price input', '.fo-priceInputRow input', 0),
          probe('quantity field', '.fo-qtyInputRow', 0),
          probe('slider track', '.percent-slider-track'),
          probe('info box', '.fo-infoBox'),
          probe('submit pair', '.fo-submitPair'),
          probe('buy button', '.submit-btn.buy'),
          probe('sell button', '.submit-btn.sell'),
          probe('account card', '.futures-account-summary'),
          probe('account row', '.futures-account-stat'),
          probe('account action', '.futures-account-actions button'),
          probe('order book panel', '.rb-panel'),
          probe('chart surface', '.chart-surface'),
        ],
      };
    });
    out.submitDisabled = disabledState;
    out.submitEnabled = enabledState;

    await context.close();
    await browser.close();
  } finally { harness.kill('SIGTERM'); }

  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
