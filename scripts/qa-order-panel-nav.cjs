#!/usr/bin/env node
/**
 * Before/after evidence for the order-panel + header cleanup.
 *
 * It drives the REAL built app against `qa-futures-account-harness.cjs`
 * (loopback fixtures, no production data, no real funds), so both captures
 * run the same code path a trader runs. Two runs of this script — one
 * against a `main` build, one against the branch build — produce directly
 * comparable frames because the account, the viewport and the token are
 * identical in both.
 *
 *   node scripts/qa-order-panel-nav.cjs --dist <path> --out <dir> [--port N]
 *
 * Captures, per viewport:
 *   panel   — the right order/account column on its own
 *   header  — the full top navigation bar on its own
 *   page    — the whole terminal, for context
 * and reports console/page errors plus a horizontal-overflow check.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'order-panel', 'after')));
const PORT = Number(arg('--port', '4241'));
const TOKEN = arg('--token', 'qa-user-c');

const VIEWPORTS = [
  ['desktop-1440x900', 1440, 900],
  ['desktop-1366x768', 1366, 768],
  ['mobile-390x844', 390, 844],
];

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

function waitForServer(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('harness did not start'));
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const harness = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'qa-futures-account-harness.cjs'), '--port', String(PORT), '--dist', DIST,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  harness.stdout.on('data', () => {});
  harness.stderr.on('data', (c) => process.stderr.write(c));

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

      await page.addInitScript((token) => {
        localStorage.setItem('exchange_token', token);
        localStorage.setItem('voltex_lang', 'ru');
      }, TOKEN);

      await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);

      await page.screenshot({ path: path.join(OUT, `${name}-page.png`), fullPage: false });

      const header = await page.$('header.global-header');
      if (header) await header.screenshot({ path: path.join(OUT, `${name}-header.png`) });

      // The order/account column. On mobile the terminal stacks, so the
      // account card is captured on its own rather than as a column.
      const panel = (await page.$('.terminal-order-column')) || (await page.$('.futures-order-form'))
        || (await page.$('.futures-account-summary'));
      if (panel) await panel.screenshot({ path: path.join(OUT, `${name}-panel.png`) });

      const card = await page.$('.futures-account-summary');
      if (card) await card.screenshot({ path: path.join(OUT, `${name}-account.png`) });

      /** Overlapped area, px², between each account action button and the
       *  fixed support launcher. Measured AT REST — what a trader meets on
       *  load — and again after scrolling the column to its end. */
      const chatOverlap = () => page.evaluate(() => {
        const launcher = document.querySelector('.support-launcher');
        if (!launcher) return null;
        const l = launcher.getBoundingClientRect();
        return [...document.querySelectorAll('.futures-account-actions button')].map((b) => {
          const r = b.getBoundingClientRect();
          return Math.round(Math.max(0, Math.min(r.right, l.right) - Math.max(r.left, l.left))
            * Math.max(0, Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top)));
        });
      });
      const chatOverlapAtRest = await chatOverlap();

      // Scroll each scrollable column to its end before measuring: the
      // Deposit/Transfer buttons are the LAST thing in the order column,
      // so "are they covered by the support launcher" is only answerable
      // where they actually come to rest.
      await page.evaluate(() => {
        const card = document.querySelector('.futures-account-summary');
        const column = card && card.closest('.fo-panel');
        if (column) column.scrollTop = column.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(400);

      const measured = await page.evaluate(() => {
        const read = (selector) => {
          const node = document.querySelector(selector);
          return node ? node.textContent.trim().replace(/\s+/g, ' ') : null;
        };
        const rows = [...document.querySelectorAll('.futures-account-stat')].map((row) => ({
          label: row.querySelector('.fa-label')?.textContent?.trim()
            ?? row.firstElementChild?.textContent?.trim() ?? null,
          value: row.querySelector('.fa-value')?.textContent?.trim()
            ?? row.lastElementChild?.textContent?.trim() ?? null,
          // A real gap between the two columns is the collision check.
          gap: (() => {
            const label = row.querySelector('.fa-label') ?? row.firstElementChild;
            const value = row.querySelector('.fa-value') ?? row.lastElementChild;
            if (!label || !value) return null;
            const a = label.getBoundingClientRect(), b = value.getBoundingClientRect();
            return b.top >= a.bottom - 1 ? 'wrapped' : Math.round(b.left - a.right);
          })(),
        }));
        const tracks = [...document.querySelectorAll('.futures-account-usage .fa-track')]
          .map((t) => { const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; });
        const rightBlock = [...document.querySelectorAll('.nav-desktop-right > *')]
          .map((n) => n.className || n.tagName.toLowerCase());
        return {
          accountCard: read('.futures-account-summary') !== null,
          marginTypeRowPresent: [...document.querySelectorAll('.futures-account-stat')]
            .some((r) => /Тип маржи/i.test(r.textContent || '')),
          rows, tracks, rightBlock,
          walletLinks: document.querySelectorAll('.nav-wallet-link').length,
          headerHeight: Math.round(document.querySelector('header.global-header')?.getBoundingClientRect().height ?? 0),
          sliderValueVisible: (() => {
            const node = document.querySelector('.percent-slider-value');
            if (!node) return false;
            const r = node.getBoundingClientRect();
            return r.width > 2 && r.height > 2;
          })(),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          actionButtonSizes: [...document.querySelectorAll('.futures-account-actions button')]
            .map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }),
        };
      });

      report.viewports.push({
        name, width, height, errors,
        chatOverlapAtRest, chatOverlapScrolled: await chatOverlap(),
        ...measured,
      });
      await context.close();
    }

    await browser.close();
  } finally {
    harness.kill('SIGTERM');
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
