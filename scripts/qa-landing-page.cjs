#!/usr/bin/env node
'use strict';
/**
 * The landing page candidate (/home-preview) held to the rules of
 * .claude/skills/landing-page-design, measured in a browser on the built
 * frontend. Loopback only, with the home page's own QA fixture
 * (qa-home-v0-fixture.cjs); nothing is sent to a market or account service.
 *
 *   node scripts/qa-landing-page.cjs [--dist frontend/dist] [--out output/landing-page]
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./qa-home-v0-fixture.cjs');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend/dist')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output/landing-page')));
const LANGS = ['ru', 'en', 'es', 'zh', 'hi', 'ja', 'ko'];

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); };

/** Every style value the skill constrains, read from the rendered page. Third-party marks (the logo, the language control) are the product's own shared components and are left out by selector. */
const audit = page => page.evaluate(() => {
  const root = document.querySelector('.vxl');
  const shared = el => !!el.closest('.vxl-nav-brand, .vxl-nav-lang, .vxl-footer-brand > :first-child');
  const all = [...root.querySelectorAll('*')].filter(el => !shared(el) && !(el instanceof SVGElement && el.tagName !== 'svg'));
  const px = v => Math.round(parseFloat(v) * 100) / 100;
  const text = all.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const set = values => [...new Set(values)].sort((a, b) => (a > b ? 1 : -1));
  const spacing = [];
  for (const el of all) {
    const c = getComputedStyle(el);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'marginTop', 'marginBottom']) {
      const v = c[p]; if (!v || v === 'normal' || v === 'auto') continue;
      const n = px(v); if (n !== 0) spacing.push(n);
    }
    // Horizontal auto margins centre a box and resolve to arbitrary pixels: they are layout, not a spacing choice.
  }
  const radii = [];
  for (const el of all) for (const p of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) { const n = px(getComputedStyle(el)[p]); if (n) radii.push(n); }
  const rgb = v => v.replace(/\s+/g, '');
  const backgrounds = set(all.map(el => rgb(getComputedStyle(el).backgroundColor)).filter(v => v !== 'rgba(0,0,0,0)'));
  const gradients = all.filter(el => /gradient/.test(getComputedStyle(el).backgroundImage)).map(el => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
  const transitions = [];
  for (const el of all) {
    const c = getComputedStyle(el);
    const props = c.transitionProperty.split(',').map(s => s.trim()), durs = c.transitionDuration.split(',').map(s => parseFloat(s) * (s.includes('ms') ? 1 : 1000)), fns = c.transitionTimingFunction.split(/,(?![^(]*\))/).map(s => s.trim());
    props.forEach((prop, i) => { const d = durs[i % durs.length]; if (d > 0) transitions.push({ prop, d, fn: fns[i % fns.length] }); });
  }
  return {
    fonts: set(text.map(el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim())),
    sizes: set(text.map(el => px(getComputedStyle(el).fontSize))),
    pairs: set(text.map(el => `${px(getComputedStyle(el).fontSize)}/${px(getComputedStyle(el).lineHeight)}`)),
    weights: set(text.map(el => Number(getComputedStyle(el).fontWeight))),
    italics: text.filter(el => getComputedStyle(el).fontStyle !== 'normal').length,
    spacing: set(spacing), radii: set(radii), backgrounds, gradients,
    curves: set(transitions.map(t => t.fn)), shortest: Math.min(...transitions.map(t => t.d)), animated: set(transitions.map(t => t.prop)),
    h1: (() => { const h = root.querySelector('h1'), c = getComputedStyle(h), b = h.getBoundingClientRect(); return { count: root.querySelectorAll('h1').length, width: Math.round(b.width), maxWidth: c.maxWidth, image: c.backgroundImage, lines: h.innerText.split('\n').length }; })(),
    sub: Math.round(root.querySelector('.vxl-hero-sub').getBoundingClientRect().width),
    actions: [...root.querySelectorAll('.vxl-btn-primary')].map(a => ({ href: a.getAttribute('href'), text: a.innerText.trim(), visible: a.getBoundingClientRect().width > 0 })),
    landmarks: { nav: root.querySelectorAll('nav').length, main: root.querySelectorAll('main').length, footer: root.querySelectorAll('footer').length, skip: root.querySelector('a.vxl-skip')?.getAttribute('href') },
    deadLinks: [...root.querySelectorAll('a')].filter(a => !a.getAttribute('href') || a.getAttribute('href') === '#').length,
    legal: [...root.querySelectorAll('footer a')].map(a => a.getAttribute('href')),
    images: [...root.querySelectorAll('img')].filter(img => !img.hasAttribute('alt')).length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    robots: document.querySelector('meta[name=robots]')?.content ?? null,
    faq: root.querySelectorAll('.vxl-faq-item').length, benefits: root.querySelectorAll('.vxl-benefits > li').length, steps: root.querySelectorAll('.vxl-steps > li').length,
    rows: [...root.querySelectorAll('.vxl-board')].map(b => b.querySelectorAll('tbody tr').length),
    text: root.innerText,
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = express();
  let marketDown = false, marketDelay = 0;
  app.use('/api/v1', (req, res, next) => {
    if (marketDown && req.path.startsWith('/market/')) return res.status(503).json({ error: 'Synthetic market outage' });
    if (marketDelay && req.path === '/market/external/tickers') return setTimeout(next, marketDelay);
    next();
  }, fixture);
  app.use(express.static(DIST));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ['--no-sandbox'] });
  const report = { dist: path.relative(ROOT, DIST), views: [] };
  const session = async ({ width, height, lang = 'ru', phone = false, reduced = false, token = null }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, serviceWorkers: 'block', hasTouch: phone, isMobile: phone, locale: 'ru-RU', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.addInitScript(([l, t]) => { localStorage.setItem('exchange_lang', l); if (t) localStorage.setItem('exchange_token', t); }, [lang, token]);
    const view = { width, lang, writes: [], external: [], errors: [] };
    await context.route('**/*', route => {
      const q = route.request(), u = new URL(q.url());
      if (!['GET', 'HEAD'].includes(q.method())) view.writes.push(`${q.method()} ${u.pathname}`);
      if (u.origin === origin || /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return route.continue();
      view.external.push(u.hostname); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => view.errors.push(e.message.slice(0, 200)));
    report.views.push(view);
    return { context, page, view };
  };
  const open = async (page, wait = 'networkidle') => { await page.goto(origin + '/home-preview', { waitUntil: wait }); await page.locator('.vxl h1').waitFor(); };
  /** A full-page picture needs every section revealed (they appear on scroll), the page back at the top and no focus ring left behind. */
  const settle = page => page.evaluate(async () => {
    for (const el of document.querySelectorAll('.vxl-reveal, .vxl-tagline-text span[data-word]')) { el.scrollIntoView({ block: 'start' }); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 300));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 900));
  });
  const SCALE = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60];
  const PAIRS = ['12/16', '14/20', '16/24', '18/28', '20/28', '24/32', '30/36', '36/40', '48/48', '60/60'];
  const SPACING = [2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96];
  const RADII = [2, 4, 6, 8, 12, 16, 24, 9999];
  // #000000 #181818 #1F1F1F #272727 #313131 #131209, the two translucent forms of them, and the brand gold of the one action.
  const BACKGROUNDS = ['rgb(0,0,0)', 'rgb(24,24,24)', 'rgb(31,31,31)', 'rgb(39,39,39)', 'rgb(49,49,49)', 'rgb(19,18,9)', 'rgba(24,24,24,0.72)', 'rgba(19,18,9,0.92)', 'rgb(240,201,100)', 'rgb(0,214,143)', 'rgb(255,255,255)'];
  try {
    // ── Desktop, Russian: structure and every visual rule ──
    {
      const { context, page, view } = await session({ width: 1440, height: 900 });
      await open(page);
      await page.waitForTimeout(600);
      const a = await audit(page);
      ok('A2: one h1, the offer, in written lines, with one primary action repeated unchanged at the bottom', a.h1.count === 1 && a.h1.lines === 3 && a.actions.filter(x => x.visible).length >= 3
        && new Set(a.actions.map(x => x.href)).size === 1 && a.actions[0].href === '/register' && new Set(a.actions.map(x => x.text)).size === 1, { lines: a.h1.lines, actions: a.actions.map(x => [x.href, x.text]) });
      ok('A2: benefits (3 to 5), three steps, FAQ (6 to 12), market proof on the first screen and again below', a.benefits >= 3 && a.benefits <= 5 && a.steps === 3 && a.faq >= 6 && a.faq <= 12 && a.rows[0] === 5 && a.rows[1] === 8, { benefits: a.benefits, steps: a.steps, faq: a.faq, rows: a.rows });
      ok('B1: one typeface (Manrope), no italic, nothing heavier than bold', a.fonts.length === 1 && a.fonts[0] === 'Manrope' && a.italics === 0 && Math.max(...a.weights) <= 700, { fonts: a.fonts, weights: a.weights });
      ok('B1: every font size is a Tailwind scale step with its own line height', a.sizes.every(s => SCALE.includes(s)) && a.pairs.every(p => PAIRS.includes(p)), { pairs: a.pairs });
      ok('B2: every padding, gap and vertical margin is a spacing token', a.spacing.every(v => SPACING.includes(v)), a.spacing.filter(v => !SPACING.includes(v)));
      ok('B3: every corner radius is a Tailwind radius', a.radii.every(v => RADII.includes(v) || v > 1000), a.radii);
      ok('B4: flat backgrounds from the dark list only', a.backgrounds.every(v => BACKGROUNDS.includes(v)), a.backgrounds.filter(v => !BACKGROUNDS.includes(v)));
      ok('B5: the only gradient is on the hero heading text, white to #9B9B9B; heading and subheading stay within 680px', a.gradients.length === 1 && a.gradients[0].startsWith('h1') && /rgb\(255, 255, 255\).*rgb\(155, 155, 155\)/.test(a.h1.image)
        && a.h1.maxWidth === '680px' && a.h1.width <= 680 && a.sub <= 680, { gradients: a.gradients, h1: a.h1.width, sub: a.sub });
      ok('B7: one curve, cubic-bezier(0.22, 1, 0.36, 1); nothing faster than 200ms; only colour, opacity and transform move', a.curves.length === 1 && a.curves[0] === 'cubic-bezier(0.22, 1, 0.36, 1)' && a.shortest >= 200
        && a.animated.every(p => /^(opacity|transform|color|background-color|border-color)$/.test(p)), { curves: a.curves, shortest: a.shortest, animated: a.animated });
      const nav = await page.evaluate(() => { const n = document.querySelector('.vxl-nav'), b = n.getBoundingClientRect(), c = getComputedStyle(n); return { top: b.top, left: b.left, right: innerWidth - b.right, blur: c.backdropFilter || c.webkitBackdropFilter, current: document.querySelectorAll('.vxl-nav [aria-current=page]').length }; });
      ok('B7: the navigation is a compact bar floating off the top edge, centred, translucent over a blur; the current page is marked', nav.top === 16 && nav.left > 100 && Math.abs(nav.left - nav.right) <= 1 && /blur\(16px\)/.test(nav.blur) && nav.current === 1, nav);
      ok('B10: skip link, landmarks, legal links, alt text, no dead link; the candidate is kept out of search', a.landmarks.skip === '#vxl-main' && a.landmarks.main === 1 && a.landmarks.nav >= 2 && a.landmarks.footer === 1
        && a.legal.includes('/legal/terms') && a.legal.includes('/legal/privacy') && a.legal.includes('/legal/risk') && a.images === 0 && a.deadLinks === 0 && a.robots === 'noindex, nofollow', { landmarks: a.landmarks, robots: a.robots });
      ok('B8: no placeholder, no invented figure — the only number in the copy is the count of listed markets', !/lorem|{{|}}|undefined|NaN/i.test(a.text) && /8 спотовых рынков/.test(a.text), a.text.match(/\d+ спотовых рынков[^\n]*/)?.[0]);
      ok('no horizontal overflow, no page error, no write request, nothing but fonts left the stand', a.overflow <= 0 && view.errors.length === 0 && view.writes.length === 0 && view.external.length === 0, { overflow: a.overflow, errors: view.errors, writes: view.writes, external: [...new Set(view.external)] });
      await page.screenshot({ path: path.join(OUT, '1440-top.png'), animations: 'disabled' });

      // B11: words start muted and light up as the section is scrolled into view; sections reveal once.
      const before = await page.evaluate(() => { const spans = [...document.querySelectorAll('.vxl-tagline-text span[data-word]')]; return { words: spans.length, lit: spans.filter(s => s.classList.contains('is-lit')).length, opacity: Number(getComputedStyle(spans[0]).opacity), sentences: document.querySelector('.vxl-tagline-text').getAttribute('aria-label').split(/[.!?]\s/).length }; });
      await page.locator('.vxl-tagline').scrollIntoViewIfNeeded(); await page.mouse.wheel(0, 40); await page.waitForTimeout(250);
      const mid = await page.evaluate(() => document.querySelectorAll('.vxl-tagline-text span[data-word].is-lit').length);
      await page.evaluate(() => { const b = document.querySelector('.vxl-tagline').getBoundingClientRect(); window.scrollBy(0, b.top - 120); }); await page.waitForTimeout(1500);
      const after = await page.evaluate(() => { const spans = [...document.querySelectorAll('.vxl-tagline-text span[data-word]')]; return { lit: spans.filter(s => s.classList.contains('is-lit')).length, opacity: Number(getComputedStyle(spans[spans.length - 1]).opacity), lines: Math.round(document.querySelector('.vxl-tagline-text').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.vxl-tagline-text')).lineHeight)) }; });
      ok('B11: a tagline of two lines or more whose words start near 30% and light up in reading order as it is scrolled in', before.words >= 8 && before.lit === 0 && Math.abs(before.opacity - 0.3) < 0.02 && before.sentences >= 2
        && after.lit === before.words && after.opacity === 1 && after.lines >= 2 && mid <= after.lit, { before, mid, after });
      await page.screenshot({ path: path.join(OUT, '1440-tagline.png'), animations: 'disabled' });
      const reveal = await page.evaluate(async () => {
        const sections = [...document.querySelectorAll('.vxl-reveal')];
        for (const s of sections) { s.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 180)); }
        const shown = sections.filter(s => s.classList.contains('is-in')).length;
        window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
        return { sections: sections.length, shown, stillShown: sections.filter(s => s.classList.contains('is-in')).length };
      });
      ok('B7: sections reveal once on entering the viewport and stay revealed', reveal.sections >= 5 && reveal.shown === reveal.sections && reveal.stillShown === reveal.sections, reveal);

      // B9: the question list opens and closes; focus is visible.
      const second = page.locator('.vxl-faq-q').nth(1);
      await second.scrollIntoViewIfNeeded(); await second.click();
      const faq = await page.evaluate(() => [...document.querySelectorAll('.vxl-faq-q')].map(b => b.getAttribute('aria-expanded')).join(','));
      await second.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      const ring = await second.evaluate(el => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
      ok('B9: one answer is open at a time, and a focused control shows a ring', faq === 'false,true,false,false,false,false' && /solid 2px/.test(ring), { faq, ring });
      await settle(page);
      await page.screenshot({ path: path.join(OUT, '1440-full.png'), fullPage: true, animations: 'disabled' });
      await context.close();
    }

    // ── Signed in: the same single action becomes «open the terminal» ──
    {
      const { context, page } = await session({ width: 1440, height: 900, token: 'qa-landing' });
      await open(page);
      const actions = await page.evaluate(() => [...document.querySelectorAll('.vxl-btn-primary')].map(a => a.getAttribute('href')));
      ok('a signed-in visitor gets one action too: the terminal, and no «Вход»', actions.length >= 3 && actions.every(h => h === '/trade') && await page.locator('.vxl-nav-login').count() === 0, actions);
      await context.close();
    }

    // ── Loading and error states of the market board ──
    {
      marketDelay = 2500;
      const { context, page } = await session({ width: 1440, height: 900 });
      await open(page, 'domcontentloaded');
      const loading = await page.evaluate(() => ({ skeleton: document.querySelectorAll('.vxl-board .vxl-skeleton-row').length, busy: document.querySelector('.vxl-board tbody')?.getAttribute('aria-busy'), spinner: document.querySelectorAll('.vxl [class*=spinner]').length }));
      ok('B9 loading: skeleton rows shaped like the table, no spinner', loading.skeleton === 13 && loading.busy === 'true' && loading.spinner === 0, loading);
      await page.screenshot({ path: path.join(OUT, '1440-loading.png'), animations: 'disabled' });
      await page.waitForFunction(() => document.querySelectorAll('.vxl-board .vxl-skeleton-row').length === 0, null, { timeout: 15000 });
      await context.close(); marketDelay = 0;
      marketDown = true;
      const down = await session({ width: 1440, height: 900 });
      await open(down.page, 'networkidle'); await down.page.waitForTimeout(800);
      const state = await down.page.evaluate(() => ({ message: [...document.querySelectorAll('.vxl-board-empty')].map(e => e.innerText), proof: document.querySelectorAll('[data-landing-proof]').length, alerts: document.querySelectorAll('.vxl [role=alert]').length }));
      ok('B9 error: a plain sentence where the market cannot be read, and no market count is claimed', state.message.length === 2 && state.message.every(m => /временно недоступны/.test(m)) && state.proof === 0, state);
      await down.context.close(); marketDown = false;
    }

    // ── Phone: first screen, menu, touch sizes ──
    for (const width of [390, 320]) {
      const { context, page, view } = await session({ width, height: width === 320 ? 700 : 844, phone: true });
      await open(page); await page.waitForTimeout(500);
      const a = await audit(page);
      const first = await page.evaluate(() => { const h = innerHeight, b = document.querySelector('main .vxl-btn-primary').getBoundingClientRect(), clipped = [...document.querySelectorAll('.vxl-btn')].filter(el => el.scrollWidth > el.clientWidth + 1).length; return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), viewport: h, clipped }; });
      ok(`${width}: no overflow, the primary action is on the first screen, buttons keep their text and are at least 48px tall`, a.overflow <= 0 && first.bottom <= first.viewport && first.clipped === 0 && first.height >= 48, first);
      ok(`${width}: the phone page keeps the type scale, spacing tokens and the single typeface`, a.fonts.join() === 'Manrope' && a.pairs.every(p => PAIRS.includes(p)) && a.spacing.every(v => SPACING.includes(v)), { pairs: a.pairs, offSpacing: a.spacing.filter(v => !SPACING.includes(v)) });
      const orphan = await page.evaluate(() => {
        // The last line of the tagline must not be a single word.
        const spans = [...document.querySelectorAll('.vxl-tagline-text span[data-word]')], lastTop = spans[spans.length - 1].getBoundingClientRect().top;
        return spans.filter(s => Math.abs(s.getBoundingClientRect().top - lastTop) < 2).length;
      });
      ok(`${width}: no single word is left alone on the last line of the tagline`, orphan >= 2, orphan);
      await page.screenshot({ path: path.join(OUT, `${width}-top.png`), animations: 'disabled' });
      const toggle = page.locator('.vxl-menu-toggle');
      await toggle.click(); await page.waitForTimeout(700);
      const menu = await page.evaluate(() => { const m = document.querySelector('.vxl-menu'), b = m.getBoundingClientRect(), c = getComputedStyle(m), items = [...m.querySelectorAll('li')]; return { height: Math.round(b.height), viewport: innerHeight, width: Math.round(b.width), blur: c.backdropFilter || c.webkitBackdropFilter, delays: items.map(li => parseFloat(getComputedStyle(li).animationDelay) * 1000), expanded: document.querySelector('.vxl-menu-toggle').getAttribute('aria-expanded'), scrollLocked: document.body.style.overflow }; });
      ok(`${width}: the menu opens as a full height blurred panel; links arrive 60ms apart, capped at 400ms`, menu.height >= menu.viewport - 1 && menu.width === width && /blur\(24px\)/.test(menu.blur) && menu.expanded === 'true' && menu.scrollLocked === 'hidden'
        && menu.delays.every((d, i) => Math.abs(d - Math.min(i * 60, 400)) < 1), menu);
      if (width === 390) await page.screenshot({ path: path.join(OUT, '390-menu.png'), animations: 'disabled' });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      ok(`${width}: Escape closes the menu and gives the page back`, await page.locator('.vxl-menu').isHidden() && await toggle.getAttribute('aria-expanded') === 'false' && await page.evaluate(() => document.body.style.overflow) !== 'hidden');
      ok(`${width}: no page error, no write request`, view.errors.length === 0 && view.writes.length === 0, { errors: view.errors, writes: view.writes });
      if (width === 390) { await settle(page); await page.screenshot({ path: path.join(OUT, '390-full.png'), fullPage: true, animations: 'disabled' }); }
      await context.close();
    }

    // ── Reduced motion: the final text at once, no movement ──
    {
      const { context, page } = await session({ width: 1440, height: 900, reduced: true });
      await open(page); await page.waitForTimeout(400);
      const calm = await page.evaluate(() => ({ lit: document.querySelectorAll('.vxl-tagline-text span[data-word].is-lit').length, words: document.querySelectorAll('.vxl-tagline-text span[data-word]').length, opacity: getComputedStyle(document.querySelector('.vxl-tagline-text span[data-word]')).opacity, transform: getComputedStyle(document.querySelector('.vxl-reveal')).transform }));
      ok('B7/B11 reduced motion: the tagline is at full colour at once and reveals do not move', calm.lit === calm.words && calm.opacity === '1' && calm.transform === 'none', calm);
      await context.close();
    }

    // ── Seven languages at 390: written lines, no overflow, the same action ──
    for (const lang of LANGS) {
      const { context, page, view } = await session({ width: 390, height: 844, phone: true, lang });
      await open(page); await page.waitForTimeout(350);
      const l = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, h1: document.querySelector('h1').innerText, h1Lines: Math.round(document.querySelector('h1').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('h1')).lineHeight)), clipped: [...document.querySelectorAll('.vxl-btn, .vxl-card h3')].filter(el => el.scrollWidth > el.clientWidth + 1).length, action: document.querySelector('main .vxl-btn-primary').innerText.trim(), hyphens: (document.querySelector('.vxl main').innerText.match(/[A-Za-zА-Яа-яЁё]-[A-Za-zА-Яа-яЁё]/g) || []),
        bar: (() => { const n = document.querySelector('.vxl-nav').getBoundingClientRect(), t = document.querySelector('.vxl-menu-toggle').getBoundingClientRect(), b = document.querySelector('.vxl-nav-brand').getBoundingClientRect(); return { left: Math.round(b.left - n.left), right: Math.round(n.right - t.right), navRight: Math.round(innerWidth - n.right) }; })(),
        words: (() => { const spans = [...document.querySelectorAll('.vxl-tagline-text span[data-word]')], top = spans[spans.length - 1].getBoundingClientRect().top; return { count: spans.length, onLastLine: spans.filter(s => Math.abs(s.getBoundingClientRect().top - top) < 2).length }; })() }));
      ok(`${lang}: the heading holds its three written lines at 390px, nothing overflows or is cut`, l.overflow <= 0 && l.h1.split('\n').length === 3 && l.h1Lines === 3 && l.clipped === 0 && l.action.length > 0 && view.errors.length === 0, { h1: l.h1.replace(/\n/g, ' / '), lines: l.h1Lines, action: l.action });
      ok(`${lang}: the tagline is cut into words (also where the language has no spaces), no hyphen in the copy, no lone last word`, l.words.count >= 8 && l.words.onLastLine >= 2 && l.hyphens.length === 0, { words: l.words, hyphens: l.hyphens });
      ok(`${lang}: brand, action and menu button sit inside the floating bar with its padding on both sides`, l.bar.right >= 8 && l.bar.left >= 12 && l.bar.navRight >= 16, l.bar);
      if (lang !== 'ru') await page.screenshot({ path: path.join(OUT, `390-top-${lang}.png`), animations: 'disabled' });
      await context.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  report.checks = checks; report.passed = checks.filter(c => c.pass).length; report.failed = checks.filter(c => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
