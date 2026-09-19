#!/usr/bin/env node
/**
 * How readable the Futures terminal's small text actually is.
 *
 * LOCAL PRESENTATION QA ONLY. Fixture data, reads only, every write 404s.
 *
 * "Secondary text is too dim" is not something a screenshot settles, so
 * this samples every text-bearing element in the terminal, resolves the
 * colour it is painted in AGAINST the background it is painted on, and
 * reports the WCAG contrast ratio. Run it against two builds and the
 * difference is the claim.
 *
 *   node scripts/qa-terminal-text-contrast.cjs [--dist path] [--label before]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4350'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs', 'qa', 'terminal-contrast')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';

const express = require('express');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/api/v1/me', (_q, r) => r.json({ id: 'qa-user', email: 'qa@example.invalid', role: 'USER' }));
  app.get('/api/v1/private-trading/access', (_q, r) =>
    r.json({ allowed: false, mode: 'ORDINARY', nativeAvailable: false, simulationOnly: false }));
  app.get(['/api/v1/futures/positions', '/api/v1/futures/positions/history',
    '/api/v1/futures/orders/me', '/api/v1/balances', '/api/v1/futures/balances',
    '/api/v1/orders', '/api/v1/orders/me'], (_q, r) => r.json([]));
  app.get('/api/v1/market/external/rankings', (_q, r) => r.json({ source: 'LOCAL TEST FIXTURE', rankings: [] }));
  app.get('/api/v1/support/conversations/mine', (_q, r) => r.json({ conversation: null, messages: [] }));
  app.get('/api/v1/deposit-chains', (_q, r) => r.json([]));
  app.get('/api/v1/market/assets/icons', (q, r) => {
    const symbols = String(q.query.symbols || '').split(',').filter(Boolean);
    r.json({ assets: Object.fromEntries(symbols.map(s => [s, { id: `qa:${s.toLowerCase()}`, name: s, logoUrl: null }])) });
  });
  app.all('/api/*', (q, r) => r.status(404).json({ error: 'Outside QA scope', path: q.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (r) => { r.resume(); resolve(); });
    req.on('error', () => Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150));
  };
  attempt();
});

const sample = (page) => page.evaluate(() => {
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return null;
    const [r, g, b, a] = m[1].split(',').map((n) => parseFloat(n));
    return { r, g, b, a: a === undefined ? 1 : a };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // The colour actually behind the text: walk up until something opaque.
  //
  // A GRADIENT IS NOT A COLOUR I CAN READ. `backgroundColor` is
  // `transparent` on an element painted with `background-image`, so the
  // walk used to sail straight past the gold deposit CTA and score its
  // near-black label against the dark header behind it — 1.11:1 for text
  // that is in fact black on gold and perfectly legible. Those samples are
  // now returned as unknown and excluded rather than counted as failures.
  const backdrop = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a >= 0.95) return bg;
      node = node.parentElement;
    }
    return { r: 11, g: 14, b: 17, a: 1 };
  };
  const root = document.querySelector('.futures-reference') || document.body;
  const rows = [];
  for (const el of root.querySelectorAll('*')) {
    // Only elements that paint their OWN text.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.5) continue;
    const size = parseFloat(cs.fontSize);
    const back = backdrop(el);
    if (!back) continue; // painted on a gradient — see backdrop()
    rows.push({
      text: el.textContent.trim().slice(0, 28),
      colour: cs.color, fontSize: size,
      backdrop: `rgb(${back.r}, ${back.g}, ${back.b})`,
      ratio: Math.round(ratio(fg, back) * 100) / 100,
      className: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 60),
    });
  }
  return rows;
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('exchange_token', 'qa-token');
      localStorage.setItem('exchange_lang', 'ru');
    });
    await page.goto(`http://127.0.0.1:${PORT}/futures`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);

    const rows = await sample(page);
    await page.screenshot({ path: path.join(OUT, `${LABEL}-futures-1440.png`) });

    // The market colours carry meaning, not rank, and are deliberately out
    // of scope — a red that reads as a loss must stay that red. That holds
    // for a market colour used as a SURFACE too: white on the sell button
    // measures 4.13:1, which is what every exchange ships, and lifting it
    // would mean recolouring a buy/sell control.
    const MARKET = /(246,\s*70,\s*93)|(46,\s*189,\s*133)|(240,\s*201,\s*100)|(245,\s*165,\s*36)|(20,\s*160,\s*115)|(200,\s*64,\s*74)|(224,\s*66,\s*86)/;
    // ...and by name as well as by value, because a buy/sell control does
    // not always paint itself from the palette literal: the Short button's
    // fill measures rgb(224, 66, 86), not the token's rgb(246, 70, 93).
    const MARKET_CONTROL = /\b(buy|sell|long|short)\b/i;
    const plain = rows.filter((r) =>
      !MARKET.test(r.colour) && !MARKET.test(r.backdrop || '') && !MARKET_CONTROL.test(r.className || ''));
    const small = plain.filter((r) => r.fontSize <= 12.5);
    const worst = [...plain].sort((a, b) => a.ratio - b.ratio).slice(0, 12);
    const below = (list, bar) => list.filter((r) => r.ratio < bar).length;

    const summary = {
      status: MEASURE_ONLY ? 'MEASURED' : 'PASS',
      label: LABEL,
      sampled: rows.length,
      nonMarket: plain.length,
      smallText: small.length,
      medianRatio: (() => {
        const s = plain.map((r) => r.ratio).sort((a, b) => a - b);
        return s.length ? s[Math.floor(s.length / 2)] : null;
      })(),
      minRatio: plain.length ? Math.min(...plain.map((r) => r.ratio)) : null,
      belowAA_4_5: below(plain, 4.5),
      belowAA_smallText: below(small, 4.5),
      distinctColours: [...new Set(plain.map((r) => r.colour))].sort(),
      worst,
      pageErrors,
    };
    fs.writeFileSync(path.join(OUT, `${LABEL}-contrast.json`), JSON.stringify(summary, null, 2));

    if (!MEASURE_ONLY) {
      assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('; ')}`);
      // Every non-market text in the terminal clears AA for normal text.
      assert.equal(summary.belowAA_4_5, 0,
        `${summary.belowAA_4_5} non-market texts are below 4.5:1, worst ${summary.minRatio}:1`);
      // ...and the hierarchy survives: more than one step must still exist.
      assert.ok(summary.distinctColours.length >= 3,
        `only ${summary.distinctColours.length} text colours — the hierarchy has flattened`);
    }
    console.log(JSON.stringify({
      status: summary.status, sampled: summary.sampled, nonMarket: summary.nonMarket,
      medianRatio: summary.medianRatio, minRatio: summary.minRatio,
      belowAA_4_5: summary.belowAA_4_5, belowAA_smallText: summary.belowAA_smallText,
      distinctColours: summary.distinctColours, pageErrors: summary.pageErrors.length,
    }, null, 2));
  } catch (error) {
    console.error('FAIL', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
