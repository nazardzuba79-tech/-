#!/usr/bin/env node
/**
 * The shared header, in every state the cleanup has to survive.
 *
 * Routes: the five pages that mount `Nav`, plus a page that supplies its
 * own extra header action. States: an ordinary user, an admin, and a
 * logged-out visitor. For each it reports the wallet-link count, where the
 * wallet sits relative to the deposit button, the deposit label, the
 * header height and the spacing either side of the money pair — the four
 * things the header change could have broken somewhere other than
 * /futures.
 *
 *   node scripts/qa-header-states.cjs [--dist path] [--port N]
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4281'));

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROUTES = ['/futures', '/trade', '/markets', '/wallet', '/copy-trading'];
const STATES = [['user', 'qa-user-a'], ['admin', 'qa-user-admin'], ['anonymous', null]];

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

  const rows = [];
  try {
    await waitForServer(PORT);
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    for (const [state, token] of STATES) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
        const page = await context.newPage();
        await page.addInitScript((t) => {
          if (t) localStorage.setItem('exchange_token', t); else localStorage.removeItem('exchange_token');
          localStorage.setItem('voltex_lang', 'ru');
        }, token);

        for (const route of ROUTES) {
          await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1200);
          rows.push({ state, width, route, ...await page.evaluate(() => {
            const right = document.querySelector('.nav-desktop-right');
            const kids = right ? [...right.children] : [];
            const walletIndex = kids.findIndex((n) => n.classList.contains('nav-wallet-link'));
            const depositIndex = kids.findIndex((n) => n.classList.contains('deposit-button'));
            const gapAfter = (i) => {
              if (i < 0 || i + 1 >= kids.length) return null;
              return Math.round(kids[i + 1].getBoundingClientRect().left - kids[i].getBoundingClientRect().right);
            };
            const mobileMenu = document.querySelector('.nav-mobile-menu');
            return {
              headerPresent: !!document.querySelector('header.global-header'),
              headerHeight: Math.round(document.querySelector('header.global-header')?.getBoundingClientRect().height ?? 0),
              walletLinksDesktop: document.querySelectorAll('.nav-desktop-right .nav-wallet-link').length,
              // DOM presence is not access. Below the header's own mobile
              // breakpoint the right-block wallet link is display:none and
              // the drawer plus the bottom navigation carry the wallet, so
              // the visible count is the one that answers "can I reach it".
              walletLinksVisible: [...document.querySelectorAll('.nav-desktop-right .nav-wallet-link')]
                .filter((n) => n.getClientRects().length > 0).length,
              brandOverlapsWallet: (() => {
                const brand = document.querySelector('.header-brand');
                const wallet = document.querySelector('.nav-wallet-link');
                if (!brand || !wallet || wallet.getClientRects().length === 0) return 0;
                return Math.max(0, Math.round(brand.getBoundingClientRect().right - wallet.getBoundingClientRect().left));
              })(),
              walletInLeftNav: document.querySelectorAll('.nav-desktop-links a[href="/wallet"]').length,
              walletThenDeposit: walletIndex >= 0 && depositIndex === walletIndex + 1,
              walletActive: !!document.querySelector('.nav-wallet-link.nav-active'),
              gapWalletDeposit: gapAfter(walletIndex),
              gapAfterDeposit: gapAfter(depositIndex),
              depositLabel: document.querySelector('.top-nav-fund-btn')?.textContent?.trim() ?? null,
              depositHasArrow: !!document.querySelector('.top-nav-fund-btn svg'),
              adminLink: document.querySelectorAll('.nav-desktop-links a[href="/admin"]').length,
              mobileWallet: mobileMenu ? mobileMenu.querySelectorAll('a[href="/wallet"]').length : 0,
              bottomNavWallet: document.querySelectorAll('.bottom-nav a[href="/wallet"], nav a[href="/wallet"]').length,
              horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          }) });
        }
        await context.close();
      }
    }
    await browser.close();
  } finally { harness.kill('SIGTERM'); }

  console.log(JSON.stringify(rows, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
