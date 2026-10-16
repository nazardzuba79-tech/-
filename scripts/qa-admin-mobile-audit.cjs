'use strict';

/**
 * Admin console at phone, tablet and desktop widths — an audit probe.
 *
 * Serves the synthetic fixture of scripts/qa-admin-practicality.cjs (QA_PREVIEW
 * mode, localhost only, every other host refused) and, for every admin section
 * at 320/360/390/430/768/1440/1920 px, measures what an operator would hit:
 *   - the page scrolling sideways;
 *   - controls (buttons, links, inputs, selects) outside the viewport or
 *     covered by another element at their centre (hit test after scrolling
 *     them into view);
 *   - text cut off by its box (ellipsis/overflow hidden) — reported, not judged;
 *   - inner horizontal scrollers (tables) and what they hide.
 * Writes report.json and screenshots to QA_OUT (default
 * output/admin-mobile-audit). Synthetic data only; no write reaches anything
 * but the fixture.
 *
 * Needs a frontend build made like admin-practicality.yml does:
 *   VITE_API_URL=/api/v1 VITE_MANUAL_DEPOSIT_CATALOGUE=true
 *   VITE_DEPOSIT_CATALOGUE_URL=http://127.0.0.1:4402/api/v1/deposit-catalogue
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, process.env.QA_FRONTEND_DIST || 'frontend/dist');
const out = path.resolve(root, process.env.QA_OUT || 'output/admin-mobile-audit');
const PORT = 4402;
// "W" or "WxH"; 844x390 is a phone held sideways (dialog footers must stay reachable).
const VIEWPORTS = (process.env.QA_WIDTHS || '320,360,390,430,768,1440,1920,844x390').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { width: w, height: h || (w <= 360 ? 640 : w <= 430 ? 844 : w === 768 ? 1024 : w === 1440 ? 900 : 1080) };
});
const WIDTHS = VIEWPORTS.map((v) => v.width);
const ROUTES = (process.env.QA_ROUTES || 'users,users/qa-user-1,users/qa-user-1?tab=balances,deposits,withdrawals,kyc,otc,wallets,listings,audit-log').split(',');
/** Screens behind a click: drawers, dialogs, folded tools, the phone menu. Only opens; never confirms. */
const SCENARIOS = [
  { name: 'deposits:credit-drawer', route: 'deposits', act: async (p) => { await p.locator('[data-open-package]').first().click(); await p.locator('[data-credit-drawer]').waitFor(); await p.waitForTimeout(400); } },
  { name: 'deposits:manual-check', route: 'deposits', act: async (p) => { const d = p.locator('details:has([data-check-tx]), details:has(input)').first(); if (await d.count()) await d.locator('summary').first().click(); await p.waitForTimeout(200); } },
  { name: 'withdrawals:approve-dialog', route: 'withdrawals', act: async (p) => { await p.getByRole('button', { name: 'Одобрить', exact: true }).first().click(); await p.locator('dialog[open]').waitFor(); } },
  { name: 'kyc:decision-dialog', route: 'kyc', act: async (p) => { await p.getByRole('button', { name: 'Проверено', exact: true }).first().click(); await p.locator('dialog[open]').waitFor(); } },
  { name: 'users:actions', route: 'users/qa-user-1', act: async (p) => { await p.locator('details.admin-user-actions > summary').click(); await p.waitForTimeout(200); } },
  { name: 'otc:first-request', route: 'otc', act: async (p) => { const row = p.locator('.admin-main a[href*="/admin/otc/"], .admin-main [data-otc-request], .admin-main button:has-text("OTC-")').first(); if (await row.count()) { await row.click(); await p.waitForTimeout(500); } } },
  { name: 'listings:create', route: 'listings', act: async (p) => { await p.getByRole('button', { name: /Создать листинг/ }).click(); await p.waitForTimeout(400); } },
  { name: 'users:kyc-tab', route: 'users/qa-user-1?tab=kyc', act: async (p) => {
    // The selected tab must be on screen, not scrolled out of the strip.
    const r = await p.evaluate(() => { const t = document.querySelector('.admin-tabs'); const a = t && t.querySelector('[aria-selected="true"]'); if (!a) return null; const tr = t.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { inside: ar.left >= tr.left - 1 && ar.right <= tr.right + 1, tab: a.textContent.trim() }; });
    if (r && !r.inside) throw new Error(`selected tab «${r.tab}» is outside the visible strip`);
  } },
  { name: 'users:balances-fit', route: 'users/qa-user-1?tab=balances', act: async (p) => {
    // Asset, available and reserved are all on screen: no inner sideways scroll either.
    const hidden = await p.evaluate(() => [...document.querySelectorAll('.admin-balance-table')].map((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth).filter((d) => d > 1));
    if (hidden.length) throw new Error(`balance table scrolls sideways by ${hidden.join(', ')} px`);
  } },
  // The panel itself overlays the page, so the page-wide hit test is skipped. Held
  // sideways (390px tall) the site-wide widget's conversation area is ~30px — a
  // property of the shared support widget, reported separately, not an admin defect.
  { name: 'support:panel', route: 'withdrawals', skipHitTest: true, minHeight: 600, act: async (p) => {
    // «Поддержка» from the admin: the panel opens fully on screen and its controls are reachable.
    await p.locator('button.support-launcher').click();
    const panel = p.locator('#voltex-assistant-panel');
    await panel.waitFor();
    const box = await panel.boundingBox(), vp = p.viewportSize();
    if (!box || box.x < -1 || box.y < -1 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) throw new Error(`support panel leaves the viewport: ${JSON.stringify(box)}`);
    const blocked = await p.evaluate(() => [...document.querySelectorAll('#voltex-assistant-panel button, #voltex-assistant-panel textarea, #voltex-assistant-panel input')].filter((el) => el.offsetParent).filter((el) => {
      const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top && top !== el && !el.contains(top);
    }).map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)));
    if (blocked.length) throw new Error(`support panel controls covered: ${blocked.join(', ')}`);
  } },
  { name: 'layout:menu-escape', route: 'users', phoneOnly: true, act: async (p) => {
    await p.getByRole('button', { name: 'Открыть меню' }).click();
    await p.waitForTimeout(200);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    if (await p.locator('aside.admin-mobile-sidebar.mobile-open').count()) throw new Error('Escape does not close the phone menu');
  } },
  { name: 'layout:menu', route: 'users', phoneOnly: true, act: async (p) => { await p.getByRole('button', { name: 'Открыть меню' }).click(); await p.waitForTimeout(300); } },
];

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`fixture did not start: ${url}`);
}

/** Runs in the page: every measurement for one screen. */
function probe() {
  const vw = window.innerWidth, vh = window.innerHeight;
  // Content of a closed <details> keeps a box in Chromium but cannot be reached until it is opened.
  const folded = (el) => { const d = el.closest('details:not([open])'); return !!d && !el.closest('summary'); };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && !folded(el); };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
  const scrollerOf = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p; } return null; };
  const controls = [...document.querySelectorAll('.admin-main button, .admin-main a[href], .admin-main input:not([type=hidden]), .admin-main select, .admin-main textarea, dialog[open] button, dialog[open] input, dialog[open] select, dialog[open] textarea, [aria-modal="true"] button, [aria-modal="true"] input, [aria-modal="true"] select, [aria-modal="true"] textarea')].filter(visible);
  const offscreen = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !scrollerOf(el)) offscreen.push({ label: label(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }
  const clipped = [];
  for (const el of document.querySelectorAll('.admin-main *, dialog[open] *, [aria-modal="true"] *')) {
    if (!visible(el) || el.children.length > 0 || !(el.textContent || '').trim()) continue;
    const s = getComputedStyle(el);
    if ((s.overflowX === 'hidden' || s.textOverflow === 'ellipsis' || s.overflow === 'hidden') && el.scrollWidth > el.clientWidth + 1) {
      clipped.push({ text: label(el), shown: el.clientWidth, needs: el.scrollWidth, title: el.getAttribute('title') || null });
    }
  }
  const scrollers = [];
  for (const el of document.querySelectorAll('.admin-main *')) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && visible(el)) {
      scrollers.push({ cls: String(el.className || el.tagName).slice(0, 60), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, hiddenShare: Math.round((1 - el.clientWidth / el.scrollWidth) * 100) });
    }
  }
  return {
    vw, vh,
    documentWidth: document.documentElement.scrollWidth,
    pageOverflow: document.documentElement.scrollWidth > vw + 1,
    controls: controls.length,
    offscreen, clipped: clipped.slice(0, 40), scrollers: scrollers.slice(0, 20),
    title: (document.querySelector('.admin-main h1')?.textContent || '').trim(),
  };
}

/** Scrolls each control into view and checks that its centre is really it (not a launcher, sticky bar or overlay). */
async function hitTest(page) {
  return page.evaluate(async () => {
    const folded = (el) => { const d = el.closest('details:not([open])'); return !!d && !el.closest('summary'); };
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !folded(el); };
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
    const describe = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ').slice(0, 2).join('.')}[${label(el).slice(0, 30)}]` : 'none';
    // The topmost open surface: a modal dialog or drawer, else the page.
    const modals = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], aside.admin-mobile-sidebar.mobile-open')].filter(visible);
    const scope = modals[modals.length - 1] || document.querySelector('.admin-main');
    if (!scope) return { blocked: [], tested: 0 };
    const controls = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), select, textarea')].filter(visible).slice(0, 80);
    const blocked = [];
    for (const el of controls) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r()));
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue; // its own container clips it; covered by scroller check
      // Centre and four inner points: a launcher over one corner of a confirm button counts.
      const points = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
      const covers = [];
      for (const [fx, fy] of points) {
        const x = Math.min(Math.max(r.left + r.width * fx, 1), innerWidth - 2);
        const y = Math.min(Math.max(r.top + r.height * fy, 1), innerHeight - 2);
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(top)))) covers.push(describe(top));
      }
      if (covers.length) blocked.push({ control: label(el), points: `${covers.length}/5`, by: [...new Set(covers)].join(' | ') });
    }
    window.scrollTo(0, 0);
    return { blocked, tested: controls.length };
  });
}

function log(width, route, measured, hits) {
  const flags = [measured.pageOverflow && `page overflow ${measured.documentWidth}px`, measured.offscreen.length && `${measured.offscreen.length} controls off screen`, hits.blocked.length && `${hits.blocked.length} controls covered`].filter(Boolean);
  console.log(`${String(width).padStart(4)} ${route.padEnd(28)} ${flags.join('; ') || 'ok'}${measured.scrollers.length ? `  [scrollers: ${measured.scrollers.map((s) => `${s.cls.split(' ')[0]} hides ${s.hiddenShare}%`).join(', ')}]` : ''}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = spawn(process.execPath, [path.join(__dirname, 'qa-admin-practicality.cjs')], {
    env: { ...process.env, QA_PREVIEW: '1', QA_PORT: String(PORT), QA_FRONTEND_DIST: dist, QA_VARIANT: 'mobile-audit' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const origin = `http://127.0.0.1:${PORT}`;
  const report = { origin, dist, widths: WIDTHS, routes: ROUTES, screens: [], pageErrors: [], external: [] };
  let browser;
  try {
    await waitFor(`${origin}/__qa/state`);
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
    for (const { width, height } of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 844, isMobile: false, locale: 'ru-RU' });
      await context.route((url) => url.hostname !== '127.0.0.1', (route) => { report.external.push(new URL(route.request().url()).host); return route.abort(); });
      if (context.routeWebSocket) await context.routeWebSocket('**/*', (s) => s.close());
      const page = await context.newPage();
      page.on('pageerror', (e) => report.pageErrors.push({ width, error: String(e).slice(0, 200) }));
      for (const route of ROUTES) {
        await page.goto(`${origin}/admin/${route}`, { waitUntil: 'networkidle' });
        await page.locator('.admin-main').waitFor({ timeout: 15000 });
        await page.waitForTimeout(250);
        const measured = await page.evaluate(probe);
        const slug = route.replace(/[/?=]/g, '-');
        // Before the hit test, which scrolls every control (and tab strips) into view.
        await page.screenshot({ path: path.join(out, `${slug}-${width}.png`), fullPage: true });
        const hits = await hitTest(page);
        report.screens.push({ route, width, ...measured, blocked: hits.blocked, hitTested: hits.tested });
        log(width, route, measured, hits);
      }
      for (const sc of SCENARIOS) {
        if (sc.phoneOnly && width > 767) continue;
        if (sc.minHeight && height < sc.minHeight) continue;
        await page.goto(`${origin}/admin/${sc.route}`, { waitUntil: 'networkidle' });
        await page.locator('.admin-main').waitFor({ timeout: 15000 });
        try { await sc.act(page); } catch (err) { report.screens.push({ route: sc.name, width, error: String(err).slice(0, 160) }); console.log(`${String(width).padStart(4)} ${sc.name.padEnd(28)} could not open: ${String(err).split('\n')[0].slice(0, 100)}`); continue; }
        const measured = await page.evaluate(probe);
        await page.screenshot({ path: path.join(out, `${sc.name.replace(/[:/]/g, '-')}-${width}.png`), fullPage: false });
        const hits = sc.skipHitTest ? { blocked: [], tested: 0 } : await hitTest(page);
        report.screens.push({ route: sc.name, width, ...measured, blocked: hits.blocked, hitTested: hits.tested });
        log(width, sc.name, measured, hits);
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    fixture.kill('SIGTERM');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  const problems = report.screens.filter((s) => s.error || s.pageOverflow || s.offscreen?.length || s.blocked?.length);
  console.log(JSON.stringify({ screens: report.screens.length, withProblems: problems.length, pageErrors: report.pageErrors.length, external: [...new Set(report.external)] }));
  if (problems.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
})().catch((err) => { console.error(err); process.exit(1); });
