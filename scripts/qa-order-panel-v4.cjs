#!/usr/bin/env node
/**
 * v4 before/after evidence for the Futures order ticket.
 *
 * Drives the REAL build against the loopback fixture harness, at the three
 * QA viewports, in the states the brief asks to see separately: an empty
 * ticket (submit pair disabled) and a filled one (enabled). Run once per
 * build to get directly comparable frames.
 *
 *   node scripts/qa-order-panel-v4.cjs --dist <path> --out <dir> [--port N]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'order-panel-v4', 'after')));
const PORT = Number(arg('--port', '4311'));
const TOKEN = arg('--token', 'qa-user-c');

const VIEWPORTS = [['1440x900', 1440, 900], ['1366x768', 1366, 768], ['390x844', 390, 844]];
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const waitForServer = (port) => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { r.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const harness = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'qa-futures-account-harness.cjs'), '--port', String(PORT), '--dist', DIST,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  const report = { dist: DIST, token: TOKEN, viewports: [] };
  try {
    await waitForServer(PORT);
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const [name, width, height] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      const errors = [];
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript((t) => {
        localStorage.setItem('exchange_token', t);
        localStorage.setItem('voltex_lang', 'ru');
      }, TOKEN);
      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);

      const shoot = async (suffix) => {
        await page.screenshot({ path: path.join(OUT, `${name}-${suffix}-terminal.png`) });
        for (const [sel, tag] of [['.fo-panel', 'column'], ['.fo-form', 'ticket'], ['.futures-account-summary', 'account']]) {
          const el = await page.$(sel);
          if (el) await el.screenshot({ path: path.join(OUT, `${name}-${suffix}-${tag}.png`) }).catch(() => {});
        }
      };

      // 1. Empty ticket — the submit pair is disabled, which is the state
      //    the owner's reference frame was captured in.
      await shoot('empty');
      const emptyState = await page.evaluate(() => {
        const b = document.querySelector('.submit-btn.buy');
        return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
      });

      // 2. Filled ticket — enabled, so the palette can be compared like for like.
      const price = await page.$('.fo-priceInputRow input');
      const qty = await page.$('.fo-qtyInputRow input');
      if (price) { await price.fill('77000'); await page.waitForTimeout(400); }
      if (qty) { await qty.fill('0.01'); await page.waitForTimeout(700); }
      await shoot('filled');
      const filledState = await page.evaluate(() => {
        const b = document.querySelector('.submit-btn.buy');
        return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
      });

      // 3. Reduce-only — the label must stop promising it opens anything.
      const reduce = await page.$('.fo-reduceOnlyRow input');
      let reduceState = null;
      if (reduce) {
        await reduce.check(); await page.waitForTimeout(500);
        await shoot('reduce-only');
        reduceState = await page.evaluate(() => ({
          buy: document.querySelector('.submit-btn.buy')?.textContent.trim(),
          sell: document.querySelector('.submit-btn.sell')?.textContent.trim(),
        }));
        await reduce.uncheck(); await page.waitForTimeout(300);
      }

      const measured = await page.evaluate(() => {
        const rect = (s) => { const n = document.querySelector(s); if (!n) return null;
          const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
        const rows = [...document.querySelectorAll('.futures-account-stat')].map((row) => {
          const l = row.querySelector('.fa-label'), v = row.querySelector('.fa-value');
          if (!l || !v) return null;
          const a = l.getBoundingClientRect(), b = v.getBoundingClientRect();
          return { label: l.textContent.trim(), value: v.textContent.trim(),
            gap: b.top >= a.bottom - 1 ? 'wrapped' : Math.round(b.left - a.right) };
        }).filter(Boolean);
        return {
          columns: getComputedStyle(document.querySelector('.terminal') || document.body).gridTemplateColumns,
          orderColumn: rect('.fo-panel'), chart: rect('.chart-surface'),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rows,
        };
      });

      report.viewports.push({ name, width, height, errors, emptyState, filledState, reduceState, ...measured });
      await context.close();
    }
    await browser.close();
  } finally { harness.kill('SIGTERM'); }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
