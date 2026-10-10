'use strict';
/**
 * MOBILE CLIENT AUDIT — customer pages of the production bundle on phone,
 * tablet and desktop viewports, against the read-only fixture in
 * scripts/qa-mobile-client-fixture.cjs. Nothing leaves the loopback origin:
 * every other request is aborted in the browser, every write answers 405.
 *
 * For each route → state → viewport it records a screenshot and measures,
 * on the real boxes:
 *   - horizontal page overflow (document / body scrollWidth beyond the viewport)
 *   - elements spilling past the viewport edge outside a horizontal scroller
 *   - text cut by an overflow box (hard clip vs. ellipsis) or spilling its box
 *   - text runs whose boxes overlap each other
 *   - tap targets under 44×44 (and under 24×24) on phone widths
 *   - interactive elements whose centre is covered by another layer
 *   - fixed/sticky layers, text under 10px, console and page errors
 *
 * The numbers are a guide for the eye, not the verdict: the screenshots are
 * reviewed. Usage:
 *   node scripts/qa-mobile-client-audit.cjs --out docs/qa/mobile-client-audit-20261009/before
 *   options: --only spot,futures  --widths 320x568,390x844  --fonts none|local
 *            --lang ru  --browser chromium|webkit  --video  --concurrency 4
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const playwright = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { createFixture, LONG_EMAIL } = require('./qa-mobile-client-fixture.cjs');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);
const OUT = path.resolve(arg('out', 'docs/qa/mobile-client-audit-20261009/run'));
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const LANG = arg('lang', 'ru');
const FONTS = arg('fonts', 'local');
const BROWSER = arg('browser', 'chromium');
const CONCURRENCY = Number(arg('concurrency', '4'));
const VIDEO = flag('video');
const DEFAULT_WIDTHS = ['320x568', '320x740', '360x800', '375x812', '390x844', '412x915', '430x932', '844x390', '768x1024', '1366x768', '1440x900', '1920x1080'];
const WIDTHS = (arg('widths', '') ? arg('widths', '').split(',') : DEFAULT_WIDTHS).map(s => s.split('x').map(Number));
const LOCALE = { ru: 'ru-RU', en: 'en-US', zh: 'zh-CN', es: 'es-ES', hi: 'hi-IN', ja: 'ja-JP', ko: 'ko-KR' }[LANG] || 'ru-RU';

const INTER_RANGES = {
  'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
/** The real Inter face from frontend/public, served in place of fonts.googleapis.com.
 * Manrope / DM Sans / Roboto Mono are not in the repository and fall back to the
 * system stack — recorded as such in the report. */
const LOCAL_FONT_CSS = Object.entries(INTER_RANGES).map(([name, range]) =>
  `@font-face{font-family:'Inter';font-style:normal;font-weight:400 800;font-display:swap;src:url(/fonts/inter/${name}.woff2) format('woff2');unicode-range:${range};}`).join('\n');

/* ------------------------------------------------------------------ in-page audit */
const AUDIT = ({ phone }) => {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const sx = window.scrollX, sy = window.scrollY;
  const sel = (el) => {
    const parts = []; let e = el;
    while (e && e.nodeType === 1 && parts.length < 4) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += '#' + e.id; else if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.');
      const role = e.getAttribute('role'); if (role && !e.id) s += `[${role}]`;
      parts.unshift(s); e = e.parentElement;
    }
    return parts.join('>');
  };
  const txt = (el) => (el.getAttribute?.('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const csCache = new Map();
  const cs = (el) => { let c = csCache.get(el); if (!c) { c = getComputedStyle(el); csCache.set(el, c); } return c; };
  const visible = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = cs(e); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false;
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
      // Closed <details>: its body is not rendered, but Chromium still reports boxes for it.
      if (e.tagName === 'DETAILS' && !e.open && el !== e && !(el.tagName === 'SUMMARY' && el.parentElement === e) && !e.querySelector(':scope > summary')?.contains(el)) return false;
    }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const scroller = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = cs(e); if (/auto|scroll/.test(c.overflowX) && e.scrollWidth > e.clientWidth + 1) return e; } return null; };
  const clipBox = (el) => {
    // Visible rect of the element after every clipping ancestor.
    let r = el.getBoundingClientRect(); let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const c = cs(e);
      if (!/hidden|clip|auto|scroll/.test(c.overflowX + c.overflowY) && c.clipPath === 'none') continue;
      const p = e.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(c.overflowX)) { box.left = Math.max(box.left, p.left); box.right = Math.min(box.right, p.right); }
      if (/hidden|clip|auto|scroll/.test(c.overflowY)) { box.top = Math.max(box.top, p.top); box.bottom = Math.min(box.bottom, p.bottom); }
    }
    return box;
  };
  const srOnly = (el) => { const r = el.getBoundingClientRect(); const c = cs(el); return r.width <= 1 || r.height <= 1 || (c.clip && c.clip !== 'auto') || (c.clipPath && c.clipPath.startsWith('inset(')); };
  // A fixed layer that covers the viewport is a modal overlay whatever its markup says.
  const coversViewport = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const c = cs(e); if (c.position === 'fixed') { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.9 && r.height >= vh * 0.85) return true; } } return false; };
  let modal = document.querySelector('[role=dialog][aria-modal="true"], dialog[open], [aria-modal="true"]');
  if (!modal) { for (const e of document.body.querySelectorAll('*')) { const c = cs(e); if (c.position === 'fixed' && visible(e)) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.9 && r.height >= vh * 0.85) { modal = e; break; } } } }
  const inModal = (el) => Boolean(modal && modal.contains(el));
  const isBackdrop = (el) => Boolean(el && (inModal(el) || /backdrop|overlay|modal|dialog|scrim/i.test(el.className || '') || el.closest('[role=dialog],dialog,[aria-modal="true"]') || coversViewport(el)));
  const out = { modalOpen: Boolean(modal), vw, vh, docOverflow: Math.round(document.documentElement.scrollWidth - vw), bodyOverflow: Math.round(document.body.scrollWidth - vw), spill: [], clipped: [], overlaps: [], smallTargets: [], tinyTargets: [], occluded: [], fixedLayers: [], tinyFonts: [], scrollers: [], text: { nan: /\bNaN\b/.test(document.body.innerText), undefined: /\bundefined\b/.test(document.body.innerText) } };

  // --- spilling boxes (deepest only)
  const all = [...document.body.querySelectorAll('*')].filter(el => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName));
  const spills = new Set();
  for (const el of all) {
    const c = cs(el); if (c.position === 'fixed') continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (scroller(el)) continue;
    const b = clipBox(el); if (b.right <= vw + 1 && b.left >= -1 && (b.right - b.left) < r.width - 1) continue; // clipped by an ancestor, not visible spill
    spills.add(el);
  }
  for (const el of spills) {
    if ([...el.children].some(ch => spills.has(ch))) continue;
    const r = el.getBoundingClientRect();
    if (out.spill.length < 40) out.spill.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), text: txt(el) });
  }
  // --- horizontal scrollers (informational)
  for (const el of all) { const c = cs(el); if (/auto|scroll/.test(c.overflowX) && el.scrollWidth > el.clientWidth + 2 && visible(el) && out.scrollers.length < 20) out.scrollers.push({ sel: sel(el), extra: el.scrollWidth - el.clientWidth }); }

  // --- text runs
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const s = node.nodeValue; if (!s || !s.trim()) continue;
    const el = node.parentElement; if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION', 'TITLE'].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    const c = cs(el); if (c.position === 'fixed' && c.visibility === 'hidden') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const r = range.getBoundingClientRect();
    const fs = parseFloat(c.fontSize);
    if (srOnly(el)) continue;
    const box = clipBox(el);
    const visW = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
    const visH = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
    const run = { el, rects, r, fs, s: s.replace(/\s+/g, ' ').trim().slice(0, 48), vis: { left: Math.max(r.left, box.left), right: Math.min(r.right, box.right), top: Math.max(r.top, box.top), bottom: Math.min(r.bottom, box.bottom) }, visW, visH, covered: false };
    // Behind an open dialog? Only decidable inside the viewport.
    if (modal && !inModal(el)) { const cx = (run.vis.left + run.vis.right) / 2, cy = (run.vis.top + run.vis.bottom) / 2; if (cx >= 0 && cy >= 0 && cx <= vw && cy <= vh) { const hit = document.elementFromPoint(cx, cy); run.covered = Boolean(hit && !el.contains(hit) && !hit.contains(el) && isBackdrop(hit)); } else run.covered = true; }
    runs.push(run);
    if (fs < 10 && out.tinyFonts.length < 20) out.tinyFonts.push({ sel: sel(el), fs, text: run.s });
    // Clipped: the text is wider than what its clipping ancestors let through.
    if (visW < r.width - 2 && r.width > 4) {
      const ownerClip = (() => { for (let e = el; e && e !== document.body; e = e.parentElement) { if (/hidden|clip/.test(cs(e).overflowX)) return e; } return null; })();
      const ellipsis = ownerClip && cs(ownerClip).textOverflow === 'ellipsis' && cs(ownerClip).whiteSpace === 'nowrap';
      const inScroller = Boolean(scroller(el));
      if (!inScroller && out.clipped.length < 40) out.clipped.push({ sel: sel(el), kind: ellipsis ? 'ellipsis' : (visW === 0 ? 'hidden' : 'hardClip'), width: Math.round(r.width), visible: Math.round(visW), text: run.s });
    } else if (r.width > 4) {
      // Spills its own box: text wider than the element's padding box (no clipping) — e.g. a word pushed out of a button or cell.
      const er = el.getBoundingClientRect();
      if (r.right > er.right + 2 && c.overflowX === 'visible' && !scroller(el) && out.clipped.length < 40) out.clipped.push({ sel: sel(el), kind: 'spillsBox', width: Math.round(r.width), box: Math.round(er.width), text: run.s });
    }
  }
  // --- overlapping text runs (visible parts only)
  const seen = new Set();
  for (let i = 0; i < runs.length && out.overlaps.length < 60; i++) {
    const a = runs[i]; if (a.visW < 2 || a.visH < 2) continue;
    for (let j = i + 1; j < runs.length; j++) {
      const b = runs[j]; if (b.visW < 2 || b.visH < 2) continue;
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.covered || b.covered) continue;
      const w = Math.min(a.vis.right, b.vis.right) - Math.max(a.vis.left, b.vis.left);
      const h = Math.min(a.vis.bottom, b.vis.bottom) - Math.max(a.vis.top, b.vis.top);
      if (w <= 2 || h <= 2 || w * h < 16) continue;
      // Line-level check: do any individual line boxes intersect?
      let hit = false;
      for (const ra of a.rects) { for (const rb of b.rects) { const ww = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), hh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top); if (ww > 2 && hh > 2) { hit = true; break; } } if (hit) break; }
      if (!hit) continue;
      const key = sel(a.el) + '|' + sel(b.el); if (seen.has(key)) continue; seen.add(key);
      out.overlaps.push({ a: sel(a.el), aText: a.s, b: sel(b.el), bText: b.s, w: Math.round(w), h: Math.round(h), y: Math.round(Math.max(a.vis.top, b.vis.top) + sy) });
      if (out.overlaps.length >= 60) break;
    }
  }
  // --- interactive targets
  const interactive = [...document.body.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=option],summary')].filter(visible);
  for (const el of interactive) {
    const r = el.getBoundingClientRect(); const c = cs(el);
    if (c.pointerEvents === 'none' || srOnly(el)) continue;
    const inline = el.tagName === 'A' && c.display.startsWith('inline') && el.closest('p,li,td,dd,label,small,figcaption');
    if (phone && !inline && el.type !== 'range') {
      const w = Math.round(r.width), h = Math.round(r.height);
      if ((w < 24 || h < 24) && out.tinyTargets.length < 40) out.tinyTargets.push({ sel: sel(el), w, h, text: txt(el) });
      else if ((w < 44 || h < 44) && out.smallTargets.length < 80) out.smallTargets.push({ sel: sel(el), w, h, text: txt(el) });
    }
    // Occlusion: only elements whose centre is inside the viewport right now.
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const b = clipBox(el); if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) continue;
    if (el.contains(hit) || hit.contains(el)) continue;
    if (el.tagName === 'INPUT' && hit.tagName === 'LABEL' && hit.contains(el)) continue;
    if (modal && !inModal(el) && isBackdrop(hit)) continue; // background behind an open dialog: expected
    const hc = cs(hit);
    if (out.occluded.length < 40) out.occluded.push({ sel: sel(el), text: txt(el), by: sel(hit), byText: txt(hit), byPosition: hc.position, byZ: hc.zIndex });
  }
  for (const el of all) { const c = cs(el); if ((c.position === 'fixed' || c.position === 'sticky') && visible(el) && out.fixedLayers.length < 30) { const r = el.getBoundingClientRect(); out.fixedLayers.push({ sel: sel(el), position: c.position, z: c.zIndex, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }); } }
  return out;
};

/* ------------------------------------------------------------------ step helpers */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settle = async (page, ms = 700) => { await page.evaluate(() => document.fonts?.ready).catch(() => {}); await page.waitForTimeout(ms); };
const click = async (page, selector, opts = {}) => { const loc = (typeof selector === 'string' ? page.locator(selector) : selector).first(); await loc.waitFor({ state: 'visible', timeout: opts.timeout ?? 6000 }); await loc.scrollIntoViewIfNeeded(); await loc.click({ timeout: 6000 }); await settle(page, opts.settle ?? 600); };
const tab = (page, name) => click(page, page.getByRole('tab', { name }));
const button = (page, name, exact = false) => click(page, page.getByRole('button', { name, exact }));
const text = (page, name) => click(page, page.getByText(name, { exact: false }));
const openMobileMenu = async (page) => { const burger = page.locator('.global-header .mobile-menu, .marketing-burger, .about-burger, .academy-burger, button[aria-label="Меню"], button[aria-label="Menu"]').first(); if (await burger.isVisible().catch(() => false)) { await burger.click(); await settle(page); return true; } return false; };
const openSupport = async (page) => { const l = page.locator('.support-launcher').first(); if (await l.isVisible().catch(() => false)) { await l.click(); await settle(page, 900); return true; } return false; };
/** Emulates an OS text-scale setting (Android «Размер шрифта», iOS Larger Text):
 * every computed font size is read FIRST, then multiplied once — reading and
 * writing in one pass would compound the factor down the tree. */
const textZoom = async (page, factor) => page.evaluate((f) => {
  const sizes = [];
  for (const el of document.body.querySelectorAll('*')) { if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CANVAS'].includes(el.tagName)) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs) sizes.push([el, fs]); }
  for (const [el, fs] of sizes) el.style.setProperty('font-size', (fs * f) + 'px', 'important');
  window.dispatchEvent(new Event('resize'));
}, factor);
const closeDialogs = async (page) => {
  for (let i = 0; i < 3; i++) {
    const close = page.locator('[role=dialog] button[aria-label*="акрыть"], dialog[open] button[aria-label*="акрыть"], [role=dialog] button[aria-label*="lose"], dialog[open] button[aria-label*="lose"], .support-panel button[aria-label*="акрыть"], .support-panel button[aria-label*="lose"], button[aria-label="Закрыть"], button[aria-label="Close"], .banking-modal-close, .vb-close').locator('visible=true').first();
    if (await close.isVisible().catch(() => false)) { await close.click({ timeout: 3000 }).catch(() => {}); await settle(page, 400); continue; }
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); break;
  }
};
const type = async (page, selector, value) => { const loc = page.locator(selector).first(); await loc.waitFor({ state: 'visible', timeout: 6000 }); await loc.click(); await loc.fill(value); await settle(page, 300); };

/* ------------------------------------------------------------------ scenarios */
// Each step runs on the SAME page in order; failures are recorded, not fatal.
const SCENARIOS = [
  { id: 'home', path: '/', guest: true, steps: [
    { name: 'menu', run: openMobileMenu },
  ] },
  { id: 'login', path: '/login', guest: true, steps: [
    { name: 'filled', run: async (p) => { await type(p, 'input[type=email], input[name=email], input[autocomplete="email"]', LONG_EMAIL); await type(p, 'input[type=password]', 'correct-horse-battery-staple-2026'); } },
    { name: 'text200', phone: true, run: async (p) => textZoom(p, 2) },
  ] },
  { id: 'register', path: '/register', guest: true, steps: [
    { name: 'filled', run: async (p) => { await type(p, 'input[type=email], input[name=email], input[autocomplete="email"]', LONG_EMAIL); const pw = p.locator('input[type=password]'); const n = await pw.count(); for (let i = 0; i < n; i++) { await pw.nth(i).fill('correct-horse-battery-staple-2026'); } await settle(p); } },
    { name: 'text200', phone: true, run: async (p) => textZoom(p, 2) },
  ] },
  { id: 'legal', path: '/legal/terms', guest: true },
  { id: 'academy', path: '/academy', guest: true, steps: [{ name: 'menu', run: openMobileMenu }] },
  { id: 'academy-learn', path: '/academy/learn', guest: true },
  { id: 'academy-faq', path: '/academy/faq', guest: true, steps: [{ name: 'open-first', run: async (p) => click(p, p.locator('button[aria-expanded]').first()) }] },
  { id: 'academy-glossary', path: '/academy/glossary', guest: true },
  { id: 'help-fees', path: '/help/fees', guest: true },
  { id: 'markets', path: '/markets', steps: [
    { name: 'menu', run: openMobileMenu },
    { name: 'search', run: async (p) => { await closeDialogs(p); const burger = p.locator('.global-header .mobile-menu[aria-expanded="true"]'); if (await burger.count()) await burger.first().click().catch(() => {}); await settle(p, 300); await type(p, 'input[placeholder="Поиск по рынкам"]', 'Internet Computer Protocol'); } },
    { name: 'support', run: async (p) => { await p.locator('input[placeholder="Поиск по рынкам"]').first().fill('').catch(() => {}); await openSupport(p); } },
  ] },
  { id: 'markets-analytics', path: '/markets?view=analytics' },
  { id: 'spot', path: '/trade?pair=BTC%2FUSDT', steps: [
    { name: 'trade', phone: true, run: async (p) => tab(p, 'Торговля') },
    { name: 'trade-sell-limit', run: async (p) => { const form = p.locator('.order-form-area'); await click(p, form.getByRole('button', { name: 'Продать', exact: true }).first()); const select = form.locator('select').first(); if (await select.isVisible().catch(() => false)) await select.selectOption({ label: 'Лимит' }).catch(() => {}); else await click(p, form.getByRole('button', { name: 'Лимит', exact: true }).first()).catch(() => {}); await form.getByLabel('Цена', { exact: true }).first().fill('123456789.123456').catch(() => {}); await form.getByLabel('Количество', { exact: true }).first().fill('98765.4321').catch(() => {}); await settle(p); } },
    { name: 'chart', phone: true, run: async (p) => tab(p, 'График') },
    { name: 'book', phone: true, run: async (p) => click(p, p.locator('.terminal-mobile-chart-tabs').getByRole('button', { name: 'Стакан' })) },
    { name: 'markets', phone: true, run: async (p) => click(p, p.locator('.terminal-mobile-chart-tabs').getByRole('button', { name: 'Рынки' })) },
    { name: 'account', phone: true, run: async (p) => tab(p, 'Ордера') },
    { name: 'history', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: 'История ордеров' })) },
    { name: 'assets', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: 'Активы' })) },
    { name: 'deposit', run: async (p) => { if (await openMobileMenu(p)) await click(p, p.locator('.nav-mobile-menu .deposit-button').first()); else await click(p, p.locator('.global-header .header-actions .deposit-button').first()); } },
    { name: 'text200', phone: true, run: async (p) => { await closeDialogs(p); await tab(p, 'Торговля'); await textZoom(p, 2); } },
  ] },
  { id: 'spot-pepe', path: '/trade?pair=PEPE%2FUSDT', steps: [{ name: 'trade', phone: true, run: async (p) => tab(p, 'Торговля') }] },
  { id: 'spot-vta', path: '/trade?pair=VTA%2FUSDT', steps: [{ name: 'trade', phone: true, run: async (p) => tab(p, 'Торговля') }] },
  { id: 'cfd', path: '/trade?market=cfd', steps: [
    { name: 'trade', phone: true, run: async (p) => tab(p, 'Торговля') },
    { name: 'markets', phone: true, run: async (p) => { await tab(p, 'График'); await click(p, p.locator('.terminal-mobile-chart-tabs').getByRole('button', { name: 'Рынки' })); } },
    { name: 'account', phone: true, run: async (p) => tab(p, /^Позиции/) },
  ] },
  { id: 'futures', path: '/futures', steps: [
    { name: 'trade-limit', run: async (p) => { if (await p.getByRole('tab', { name: 'Торговля' }).isVisible().catch(() => false)) await tab(p, 'Торговля'); const form = p.locator('.order-form-area'); await click(p, form.getByRole('button', { name: /^Лимит/ }).or(form.getByRole('tab', { name: /^Лимит/ })).first()).catch(() => {}); const select = form.locator('select').first(); if (await select.isVisible().catch(() => false)) await select.selectOption({ label: 'Лимит' }).catch(() => {}); await form.locator('input[inputmode="decimal"], input[type=number], input[type=text]').first().fill('123456789.12').catch(() => {}); await form.locator('input[inputmode="decimal"], input[type=number], input[type=text]').nth(1).fill('98765.4321').catch(() => {}); await settle(p); } },

    { name: 'chart', phone: true, run: async (p) => tab(p, 'График') },
    { name: 'book', phone: true, run: async (p) => click(p, p.locator('.futures-mobile-chart-tabs').getByRole('button', { name: 'Стакан' })) },
    { name: 'stats', phone: true, run: async (p) => click(p, p.locator('.futures-mobile-stats-toggle').first()) },
    { name: 'positions', phone: true, run: async (p) => tab(p, /^Позиции/) },
    { name: 'tpsl-dialog', run: async (p) => { await click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^Позиции/ })); await click(p, p.locator('.bottom-content .fut-tpslTrigger').locator('visible=true').first()); } },
    { name: 'orders', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^Открытые ордера/ })) },
    { name: 'position-history', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^История позиций/ })) },
    { name: 'order-history', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^История ордеров/ })) },
    { name: 'assets', run: async (p) => click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^Активы/ })) },
    { name: 'close-dialog', run: async (p) => { await closeDialogs(p); await click(p, p.locator('.bottom-tabs').getByRole('tab', { name: /^Позиции/ })); await click(p, p.locator('.bottom-content').getByRole('button', { name: /Лимитный|Limit/ }).first()); } },
    { name: 'close-market-confirm', run: async (p) => { await closeDialogs(p); await click(p, p.locator('.bottom-content').getByRole('button', { name: /Рыночный|Market/ }).first()); } },
    { name: 'markets-dialog', run: async (p) => { await closeDialogs(p); await click(p, p.locator('.pair-markets-btn, [data-market-entry]').locator('visible=true').first()); } },
    { name: 'calculator', run: async (p) => { await closeDialogs(p); await click(p, p.locator('.ticker-calc-btn, [data-open-calculator]').first()); } },
    { name: 'text200', phone: true, run: async (p) => { await closeDialogs(p); await tab(p, 'Торговля'); await textZoom(p, 2); } },
  ] },
  { id: 'wallet', path: '/wallet', steps: [
    { name: 'funding', run: async (p) => click(p, p.locator('.wallet-side-nav').getByRole('button', { name: 'Финансирование' })) },
    { name: 'unified', run: async (p) => click(p, p.locator('.wallet-side-nav').getByRole('button', { name: 'Unified Trading' })) },
    { name: 'pnl', run: async (p) => click(p, p.locator('.wallet-side-nav').getByRole('button', { name: 'P&L Analysis' })) },
    { name: 'orders', run: async (p) => click(p, p.locator('.wallet-side-nav').getByRole('button', { name: 'Orders' })) },
    { name: 'deposit', run: async (p) => { await click(p, p.locator('.wallet-side-nav').getByRole('button', { name: 'Обзор' })); await click(p, p.locator('main').getByRole('button', { name: 'Внести', exact: true }).first()); } },
    { name: 'withdraw', run: async (p) => { await closeDialogs(p); await click(p, p.locator('main').getByRole('button', { name: 'Вывести', exact: true }).first()); } },
    { name: 'withdraw-filled', run: async (p) => { await type(p, '[role=dialog] input[placeholder*="дрес"], [role=dialog] input:not([type=number]):not([placeholder="0.00"])', LONG_ADDRESS_QA); await type(p, '[role=dialog] input[placeholder="0.00"]', '123456789.123456'); } },
    { name: 'transfer', run: async (p) => { await closeDialogs(p); await click(p, p.locator('main').getByRole('button', { name: 'Перевести', exact: true }).first()); } },
    { name: 'text200', phone: true, run: async (p) => { await closeDialogs(p); await click(p, p.locator('main').getByRole('button', { name: 'Вывести', exact: true }).first()); await textZoom(p, 2); } },
  ] },
  { id: 'banking', path: '/banking', steps: [
    // The programme cards above the calculator carry their own «Рассчитать…»
    // shortcut, so both steps are scoped to the calculator section.
    { name: 'calculate', run: async (p) => { await type(p, '#banking-calculator label:has-text("Сумма") input', '5000'); await click(p, p.locator('#banking-calculator').getByRole('button', { name: /^Рассчит/ }).first()); await settle(p, 800); } },
    { name: 'place-dialog', run: async (p) => { await settle(p, 1200); await click(p, p.locator('#banking-calculator').getByRole('button', { name: /^Разместить средства/ }).locator('visible=true').first()); } },
  ] },
  { id: 'copy', path: '/copy-trading', steps: [
    { name: 'profile', run: async (p) => click(p, p.locator('.card-view-button').first()) },
    { name: 'profile-trades', run: async (p) => click(p, p.locator('.copytrading-bolt-root.profile-view button:has-text("Сделки"), .copytrading-bolt-root.profile-view button:has-text("История")').first()) },
  ] },
  { id: 'otc', path: '/otc', steps: [
    { name: 'form', run: async (p) => { await p.locator('#otc-request-form').scrollIntoViewIfNeeded(); await settle(p); } },
    { name: 'filled', run: async (p) => { const form = p.locator('#otc-request-form'); for (const i of await form.locator('input[inputmode], input[type=number], input[type=text]').all()) await i.fill('1234567.89').catch(() => {}); await settle(p); } },
  ] },
  { id: 'arbitrage', path: '/arbitrage', steps: [
    { name: 'dialog', run: async (p) => click(p, p.locator('.arb-row-detail').locator('visible=true').first()) },
    { name: 'strategy', run: async (p) => { await closeDialogs(p); await click(p, p.locator('.arb-strategy-link').first()); } },
  ] },
  { id: 'tools', path: '/tools' },
  { id: 'bots', path: '/trading-bots', steps: [
    { name: 'bot', run: async (p) => click(p, p.locator('.vb-open').first()) },
  ] },
  { id: 'card', path: '/card' },
  { id: 'settings', path: '/settings', steps: [
    { name: 'security', run: async (p) => click(p, p.getByRole('button', { name: 'Безопасность' }).or(p.getByRole('tab', { name: 'Безопасность' })).first()) },
    { name: 'verification', run: async (p) => click(p, p.getByRole('button', { name: 'Верификация' }).or(p.getByRole('tab', { name: 'Верификация' })).first()) },
    { name: 'api', run: async (p) => click(p, p.getByRole('button', { name: 'API', exact: true }).or(p.getByRole('tab', { name: 'API', exact: true })).first()) },
    { name: 'referral', run: async (p) => click(p, p.getByRole('button', { name: 'Реферальная программа' }).or(p.getByRole('tab', { name: 'Реферальная программа' })).first()) },
  ] },
  { id: 'journey', path: '/markets', video: true, steps: [
    { name: 'to-terminal', run: async (p) => { await click(p, p.locator('.bottom-nav a[href="/trade"]')); await p.waitForFunction(() => location.pathname === '/trade'); await settle(p, 2500); } },
    { name: 'order-form', run: async (p) => { await tab(p, 'Торговля'); const form = p.locator('.order-form-area'); await form.getByLabel('Цена', { exact: true }).first().fill('104000').catch(() => {}); await form.getByLabel('Количество', { exact: true }).first().fill('0.25').catch(() => {}); await settle(p, 800); } },
    { name: 'orders', run: async (p) => { await tab(p, 'Ордера'); await settle(p, 800); } },
    { name: 'to-futures', run: async (p) => { await click(p, p.locator('.terminal-market-switch a').first()); await p.waitForFunction(() => location.pathname === '/futures'); await settle(p, 3000); } },
    { name: 'positions', run: async (p) => { await tab(p, /^Позиции/); await settle(p, 800); } },
    { name: 'to-wallet', run: async (p) => { await click(p, p.locator('.bottom-nav a[href="/wallet"]')); await p.waitForFunction(() => location.pathname === '/wallet'); await settle(p, 2500); } },
  ] },
  { id: 'support', path: '/wallet', steps: [
    { name: 'open', run: openSupport },
    { name: 'specialist', run: async (p) => click(p, p.locator('.support-mode button').nth(1)) },
    { name: 'specialist-filled', run: async (p) => { await p.locator('.support-panel input[type=email]').first().fill(LONG_EMAIL).catch(() => {}); await p.locator('.support-panel textarea').first().fill('Очень длинное обращение в поддержку без единого пробела: ' + 'ДлинноеСловоБезПробелов'.repeat(6)).catch(() => {}); await settle(p); } },
  ] },
];
const LONG_ADDRESS_QA = 'bc1q' + 'qa7x'.repeat(9) + 'qa';

/* ------------------------------------------------------------------ runner */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture({});
  const server = fixture.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const engine = playwright[BROWSER];
  const browser = await engine.launch({ headless: true, args: BROWSER === 'chromium' ? ['--no-sandbox'] : [] });
  const scenarios = SCENARIOS.filter(s => ONLY ? ONLY.includes(s.id) : !s.video);
  const report = { startedAt: new Date().toISOString(), origin: 'LOCAL READ-ONLY FIXTURE', lang: LANG, fonts: FONTS, browser: BROWSER, widths: WIDTHS.map(w => w.join('x')), captures: [] };
  const jobs = [];
  for (const scenario of scenarios) for (const [w, h] of WIDTHS) jobs.push({ scenario, w, h });

  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      const job = jobs[index++];
      try { await runJob(job); } catch (error) { report.captures.push({ scenario: job.scenario.id, state: 'load', viewport: `${job.w}x${job.h}`, error: String(error).slice(0, 300) }); }
    }
  };
  async function runJob({ scenario, w, h }) {
    const phone = w <= 600 || (h <= 600 && w <= 900);
    const touch = w <= 1024;
    const context = await browser.newContext({
      viewport: { width: w, height: h }, locale: LOCALE, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1,
      ...(VIDEO || scenario.video ? { recordVideo: { dir: path.join(OUT, 'video', `${scenario.id}-${w}x${h}`), size: { width: w, height: h } } } : {}),
    });
    await context.route('**/*', route => {
      const request = route.request(); const url = new URL(request.url());
      // The browser-side guard mirrors the fixture's: reads pass, the Earn
      // calculator's POST passes (a pure projection the fixture computes),
      // every other write is answered 405 before it leaves the browser.
      const calculatorPost = request.method() === 'POST' && url.pathname === '/api/v1/banking/calculate';
      if (url.origin === origin) return ['GET', 'HEAD'].includes(request.method()) || calculatorPost ? route.continue() : route.fulfill({ status: 405, body: '{"error":"read-only"}' });
      if (FONTS === 'local' && url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: LOCAL_FONT_CSS });
      return route.abort();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(({ guest, lang, token }) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
        if (url.origin === 'https://market.voltextech.net') return original('/api/v1' + url.pathname + url.search, options);
        if (url.origin !== location.origin) return Promise.reject(new Error('External network blocked in fixture'));
        return original(input, options);
      };
      try { if (guest) localStorage.removeItem('exchange_token'); else localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', lang); } catch {}
    }, { guest: Boolean(scenario.guest), lang: LANG, token: fixture.token });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    const key = `${w}x${h}`;
    const dir = path.join(OUT, scenario.id); fs.mkdirSync(dir, { recursive: true });
    const failed = [];
    page.on('requestfailed', r => { try { failed.push(new URL(r.url()).host + ' ' + r.failure()?.errorText); } catch {} });
    const capture = async (state, stepError, skipped) => {
      if (skipped) { report.captures.push({ scenario: scenario.id, path: scenario.path, state, viewport: key, phone, skipped: true }); return; }
      await settle(page, 400);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(150);
      const m = await page.evaluate(AUDIT, { phone }).catch(e => ({ auditError: String(e).slice(0, 200) }));
      const shot = path.join(dir, `${state}-${key}.jpg`);
      await page.screenshot({ path: shot, type: 'jpeg', quality: 82, fullPage: (phone || w <= 1024) && !scenario.video, animations: 'disabled', caret: 'hide' }).catch(async () => page.screenshot({ path: shot, type: 'jpeg', quality: 82 }).catch(() => {}));
      // Scrolled to the bottom: what the fixed layers cover down there (last rows, submit buttons).
      let bottom = null;
      const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8).catch(() => false);
      if (scrollable) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {});
        await page.waitForTimeout(250);
        const mb = await page.evaluate(AUDIT, { phone }).catch(() => null);
        const shotB = path.join(dir, `${state}-bottom-${key}.jpg`);
        await page.screenshot({ path: shotB, type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' }).catch(() => {});
        bottom = { shot: path.relative(OUT, shotB), occluded: mb?.occluded ?? [], spill: mb?.spill ?? [] };
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      }
      const failedHosts = {}; for (const f of failed.splice(0)) failedHosts[f] = (failedHosts[f] || 0) + 1;
      report.captures.push({ scenario: scenario.id, path: scenario.path, state, viewport: key, phone, shot: path.relative(OUT, shot), bottom, stepError: stepError || null, errors: errors.splice(0), failedRequests: failedHosts, metrics: m });
    };
    await page.goto(origin + scenario.path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-app-started'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(scenario.path.startsWith('/futures') || scenario.path.startsWith('/trade') ? 3600 : 2200);
    await capture('initial');
    for (const step of scenario.steps || []) {
      if (step.phone && !phone) { await capture(step.name, null, true); continue; }
      let stepError = null;
      try { await step.run(page); } catch (error) { stepError = String(error).split('\n')[0].slice(0, 200); }
      await capture(step.name, stepError);
    }
    await context.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();
  report.unknownEndpoints = [...new Set(fixture.state.unknown)];
  // Non-GET requests the browser made; the fixture refused all of them with 405
  // except the Earn calculator's POST, a pure projection it answers itself.
  const isCalculate = (r) => r.method === 'POST' && r.path === '/api/v1/banking/calculate';
  report.writesAttempted = fixture.state.requests.filter(r => !['GET', 'HEAD'].includes(r.method) && !isCalculate(r)).length;
  report.calculatorCalls = fixture.state.requests.filter(isCalculate).length;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT, 'summary.md'), summarize(report));
  server.close();
  console.log(`captures: ${report.captures.length}; unknown endpoints: ${report.unknownEndpoints.join(', ') || 'none'}; writes attempted: ${report.writesAttempted}`);
}

function summarize(report) {
  const rows = [];
  const byKey = new Map();
  for (const c of report.captures) {
    const m = c.metrics || {};
    const flags = [];
    if (c.error) flags.push('LOAD-ERROR');
    if (m.docOverflow > 1) flags.push(`overflow+${m.docOverflow}`);
    if (m.spill?.length) flags.push(`spill:${m.spill.length}`);
    if (m.clipped?.filter(x => x.kind !== 'ellipsis').length) flags.push(`clip:${m.clipped.filter(x => x.kind !== 'ellipsis').length}`);
    if (m.overlaps?.length) flags.push(`overlap:${m.overlaps.length}`);
    if (m.occluded?.length) flags.push(`occluded:${m.occluded.length}`);
    if (c.bottom?.occluded?.length) flags.push(`occluded@bottom:${c.bottom.occluded.length}`);
    if (c.skipped) flags.push('n/a');
    if (m.tinyTargets?.length) flags.push(`tiny:${m.tinyTargets.length}`);
    if (m.smallTargets?.length) flags.push(`small:${m.smallTargets.length}`);
    if (m.tinyFonts?.length) flags.push(`font<10:${m.tinyFonts.length}`);
    if (m.text?.nan || m.text?.undefined) flags.push('NaN/undefined');
    if (c.errors?.length) flags.push(`errors:${c.errors.length}`);
    if (c.stepError) flags.push('STEP-FAILED');
    const k = `${c.scenario}|${c.state}`;
    if (!byKey.has(k)) byKey.set(k, { scenario: c.scenario, path: c.path, state: c.state, cells: {} });
    byKey.get(k).cells[c.viewport] = flags.length ? flags.join(' ') : 'ok';
  }
  rows.push(`# Mobile client audit — ${report.lang} / fonts:${report.fonts} / ${report.browser}`);
  rows.push(`Started ${report.startedAt}, finished ${report.finishedAt}. Writes attempted by the browser and refused: ${report.writesAttempted}. Unknown fixture endpoints: ${report.unknownEndpoints.join(', ') || 'none'}.`);
  rows.push('');
  rows.push(`| route | state | ${report.widths.join(' | ')} |`);
  rows.push(`|---|---|${report.widths.map(() => '---').join('|')}|`);
  for (const r of byKey.values()) rows.push(`| ${r.path} | ${r.state} | ${report.widths.map(w => r.cells[w] ?? 'not run').join(' | ')} |`);
  rows.push('');
  rows.push('Legend: overflow = page scrolls horizontally by N px; spill = boxes past the viewport edge; clip = text cut without ellipsis / pushed out of its box; overlap = text runs overlapping; occluded = control centre covered by another layer; tiny/small = tap targets <24 / <44 px (phones); font<10 = text under 10px.');
  return rows.join('\n');
}

main().catch(error => { console.error(error); process.exit(1); });
