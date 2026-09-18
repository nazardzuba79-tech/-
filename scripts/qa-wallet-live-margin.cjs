/**
 * PROOF THAT THE WALLET'S MARGIN AND UNREALIZED P&L ARE A LIVE ENGINE.
 *
 * The owner's reading of production was that `IM 0,00% · MM 0,00% ·
 * Нереализованный PnL 0,00` are "empty labels". Two different things were
 * true at once: the gauge had lost its CSS (fixed, and guarded elsewhere),
 * and the account genuinely had no open positions, so the zeros were
 * correct. Nothing in the suite proved the other half — that the figures
 * MOVE when a position exists — because the review stand could not open
 * one.
 *
 * This driver opens a real position through the REAL native engine in the
 * isolated stand, then reads what the REAL Wallet header prints:
 *
 *   flat      → IM/MM/uPnL are zero and the header says why
 *               ("Нет открытых позиций", linking to the terminal)
 *   position  → IM, MM and unrealized P&L all carry the engine's figures,
 *               the gauges fill, and the idle note is gone
 *   closed    → it returns to the flat reading
 *
 * Nothing here computes a financial figure. Every number asserted is the
 * one the engine produced; the test only checks that the page shows it.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('node:fs');

const BASE = process.env.WALLET_REVIEW_URL || 'http://127.0.0.1:4179';
const OUT = process.env.QA_OUT || '/tmp/qa-wallet-live-margin';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const num = (text) => Number(String(text).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

async function api(path, body) {
  const res = await fetch(`${BASE}/api/v1/private-trading/native${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
}

/** What the Wallet's own header is showing right now. */
function readHeader() {
  const rows = [...document.querySelectorAll('.wallet-margin-usage > div')].map((row) => {
    const spans = [...row.querySelectorAll('span')];
    return {
      label: spans[0].textContent.trim(),
      percent: row.querySelector('.wallet-im-bar + span').textContent.trim(),
      value: spans[spans.length - 1].textContent.trim(),
      fill: row.querySelector('.wallet-im-bar > span').style.width,
    };
  });
  const metrics = [...document.querySelectorAll('.wallet-account-metric')].map((el) =>
    el.querySelectorAll('p')[1].childNodes[0].textContent.trim());
  return {
    rows,
    metrics,
    unrealized: metrics[2] ?? null,
    idle: document.querySelectorAll('.wallet-margin-idle').length,
  };
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await (await fetch(`${BASE}/__mode/owner?opened=1&history=45`)).json();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const open = async () => {
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-overview', { timeout: 15000 });
      await page.locator('.wallet-side-nav .wallet-nav-item', { hasText: 'Unified Trading' }).first().click();
      await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
      await page.waitForTimeout(500);
      return page.evaluate(readHeader);
    };

    // ── 1. Flat: the zeros are correct, and the header says which fact ──
    const flat = await open();
    check('flat: IM and MM read zero', flat.rows.length === 2 && flat.rows.every((r) => num(r.value) === 0), JSON.stringify(flat.rows));
    check('flat: unrealized P&L reads zero', num(flat.unrealized) === 0, String(flat.unrealized));
    check('flat: the header says nothing is committed, rather than leaving a bare zero', flat.idle === 1, String(flat.idle));
    await page.screenshot({ path: `${OUT}/margin-flat.png` });

    // ── 2. Open a real position through the real engine ─────────────────
    const placed = await api('/commands', {
      kind: 'OPEN', idempotencyKey: 'qa-live-margin-open', symbol: 'BTCUSDT',
      side: 'LONG', type: 'MARKET', margin: '10000', leverage: '5', marginType: 'CROSS',
    });
    check('the engine accepted a real order', !placed.error, JSON.stringify(placed.error ?? 'ok').slice(0, 120));

    const account = (await api('/wallet')).account;
    const live = await open();
    // Every figure below is the ENGINE's; the page is only asked to show it.
    check('position: the page prints the engine\'s initial margin',
      Math.abs(num(live.rows[0].value) - Number(account.initialMargin)) < 0.02,
      `page ${live.rows[0].value} vs engine ${account.initialMargin}`);
    check('position: the page prints the engine\'s maintenance margin',
      Math.abs(num(live.rows[1].value) - Number(account.maintenanceMargin)) < 0.02,
      `page ${live.rows[1].value} vs engine ${account.maintenanceMargin}`);
    check('position: the page prints the engine\'s unrealized P&L',
      Math.abs(num(live.unrealized) - Number(account.unrealizedPnl)) < 0.02,
      `page ${live.unrealized} vs engine ${account.unrealizedPnl}`);
    check('position: the figures are no longer zero', num(live.rows[0].value) > 0 && num(live.rows[1].value) > 0,
      `IM ${live.rows[0].value}, MM ${live.rows[1].value}`);
    check('position: both gauges fill', live.rows.every((r) => /%$/.test(r.fill) && parseFloat(r.fill) > 0),
      live.rows.map((r) => r.label + ' ' + r.fill).join(', '));
    check('position: the "nothing committed" note is gone', live.idle === 0, String(live.idle));
    await page.screenshot({ path: `${OUT}/margin-live.png` });

    // ── 3. Close it: the reading returns ────────────────────────────────
    const positions = (await api('/state')).positions ?? [];
    check('the engine reports the open position', positions.length === 1, String(positions.length));
    if (positions.length === 1) {
      const closed = await api('/commands', { kind: 'CLOSE', idempotencyKey: 'qa-live-margin-close', positionId: positions[0].id });
      check('the engine accepted the close', !closed.error, JSON.stringify(closed.error ?? 'ok').slice(0, 120));
      const after = await open();
      check('closed: IM and MM return to zero', after.rows.every((r) => num(r.value) === 0), JSON.stringify(after.rows));
      check('closed: the header says nothing is committed again', after.idle === 1, String(after.idle));
    }

    check('no page errors throughout', errors.length === 0, errors.join(' | '));
    await context.close();
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
