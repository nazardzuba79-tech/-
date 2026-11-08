/**
 * Browser QA for «Обменники» (/exchangers, Issue #694). Fixture-only.
 *
 * One local Express process on 127.0.0.1 serves the built frontend
 * (frontend/dist, build with VITE_API_URL=/api/v1) and mounts the REAL
 * exchangersRouter + BestChangeService (TypeScript loaded through ts-node,
 * transpile-only) on /api/v1, twice:
 *   - "ok" mode: an obviously fake key and an injected fetch that answers
 *     from the OpenAPI-shaped TEST FIXTURE below («Тестовый обменник 1..8»);
 *   - "not_configured" mode: no key at all.
 * The injected fetch never touches the network; the browser may only reach
 * the local origin (everything else is aborted and recorded). No real
 * BestChange key, no production service, no write request.
 *
 *   node scripts/qa-exchangers.cjs
 *   (QA_PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright by default,
 *    QA_DIST=frontend/dist, QA_OUT=docs/qa/exchangers694)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const repo = path.resolve(__dirname, '..');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(repo, 'tsconfig.json'),
  compilerOptions: { module: 'commonjs' },
});
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright');
const { exchangersRouter } = require(path.join(repo, 'src/api/routes/exchangers.ts'));
const { BestChangeService } = require(path.join(repo, 'src/services/exchangers/BestChangeService.ts'));
const { RECEIVE_PAIRS } = require(path.join(repo, 'src/shared/exchangers/catalog.ts'));

const dist = path.resolve(repo, process.env.QA_DIST || 'frontend/dist');
const out = path.resolve(repo, process.env.QA_OUT || 'docs/qa/exchangers694');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the frontend first: cd frontend && VITE_API_URL=/api/v1 npm run build');
fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------
// TEST FIXTURE (OpenAPI shapes). Not real exchangers, rates or reserves.
// ---------------------------------------------------------------------------
const FAKE_KEY = 'TESTONLYfakeKeyQA00000000000694a'; // obviously fake, never a real key
const PARTNER_ID = '12345';
const AMOUNT = 15000.5;

const CUR = {
  sbp: 2001, sberbank: 2002, tinkoff: 2003, alfaclick: 2004, vtb: 2005, card: 2006, mir: 2007, ozon: 2008,
  cashRub: 2090, usd: 2091,
  USDTTRC20: 3001, USDTERC20: 3002, USDTBEP20: 3003, USDTTON: 3004, BTC: 3005, ETH: 3006, TRX: 3007,
  TON: 3008, USDCERC20: 3009, USDCSOL: 3010, LTC: 3011, SOL: 3012,
};
const fiat = (id, name, urlname, code, cash = false) => ({ id, name, urlname, viewname: name, code, crypto: false, cash, ps: 0, group: 0 });
const coin = (id, name, urlname, code) => ({ id, name, urlname, viewname: name, code, crypto: true, cash: false, ps: 0, group: 0 });
const CURRENCIES = {
  currencies: [
    fiat(CUR.sbp, 'СБП', 'sbp', 'SBPRUB'),
    fiat(CUR.sberbank, 'Сбербанк', 'sberbank', 'SBERRUB'),
    fiat(CUR.tinkoff, 'Т-Банк', 'tinkoff', 'TCSBRUB'),
    fiat(CUR.alfaclick, 'Альфа-Банк', 'alfaclick', 'ACRUB'),
    fiat(CUR.vtb, 'ВТБ', 'vtb', 'TBRUB'),
    fiat(CUR.card, 'Visa/MasterCard RUB', 'visa-mastercard-rub', 'CARDRUB'),
    fiat(CUR.mir, 'Мир', 'mir', 'MIRCRUB'),
    fiat(CUR.ozon, 'Озон Банк RUB', 'ozon-bank', 'OZONRUB'), // dynamic extra
    fiat(CUR.cashRub, 'Наличные RUB', 'cash-ruble', 'CASHRUB', true), // cash: must stay hidden
    fiat(CUR.usd, 'Тестовый USD', 'test-usd', 'USD'), // not RUB: must stay hidden
    coin(CUR.USDTTRC20, 'Tether TRC20', 'tether-trc20', 'USDTTRC20'),
    coin(CUR.USDTERC20, 'Tether ERC20', 'tether-erc20', 'USDTERC20'),
    coin(CUR.USDTBEP20, 'Tether BEP20', 'tether-bep20', 'USDTBEP20'),
    coin(CUR.USDTTON, 'Tether TON', 'tether-ton', 'USDTTON'),
    coin(CUR.BTC, 'Bitcoin', 'bitcoin', 'BTC'),
    coin(CUR.ETH, 'Ethereum', 'ethereum', 'ETH'),
    coin(CUR.TRX, 'Tron', 'tron', 'TRX'),
    coin(CUR.TON, 'Toncoin', 'toncoin', 'TON'),
    coin(CUR.USDCERC20, 'USD Coin ERC20', 'usd-coin-erc20', 'USDCERC20'),
    coin(CUR.USDCSOL, 'USD Coin SOL', 'usd-coin-sol', 'USDCSOL'),
    coin(CUR.LTC, 'Litecoin', 'litecoin', 'LTC'),
    coin(CUR.SOL, 'Solana', 'solana', 'SOL'),
  ],
};
const reviews = (positive, neutral, claim, closed) => ({ positive, neutral, claim, closed });
const click = (host, id) => `https://${host}/click.php?id=${id}`;
const CHANGERS = {
  changers: [
    { id: 9001, name: 'Тестовый обменник 1', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9001) }, pages: {}, reserve: '0', reviews: reviews(1200, 3, 0, 1), rating: '4.8', active: true },
    { id: 9002, name: 'Тестовый обменник 2', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9002) }, pages: {}, reserve: '0', reviews: reviews(40, 1, 1, 0), rating: 3, active: true },
    { id: 9003, name: 'Тестовый обменник 3', langs: ['ru'], urls: { ru: click('bestchange.ru', 9003) }, pages: {}, reserve: '0', reviews: null, rating: null, active: true },
    // Malicious urls: look-alike host and javascript: — must end up WITHOUT an exchanger link.
    { id: 9004, name: 'Тестовый обменник 4', langs: ['ru'], urls: { ru: 'https://www.bestchange.ru.evil.example/click.php?id=9004', en: 'javascript:alert(1)' }, pages: {}, reserve: '0', reviews: reviews(5, 0, 0, 0), rating: '1', active: true },
    { id: 9005, name: 'Тестовый обменник 5', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9005) }, pages: {}, reserve: '0', reviews: reviews(0, 0, 0, 0), rating: '0', active: true },
    // ru missing: falls back to en on bestchange.com.
    { id: 9006, name: 'Тестовый обменник 6', langs: ['en'], urls: { en: click('www.bestchange.com', 9006) }, pages: {}, reserve: '0', reviews: reviews(300, 2, 0, 0), rating: '2.5', active: true },
    // Inactive: never shown even with the best rate.
    { id: 9007, name: 'Тестовый обменник 7', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9007) }, pages: {}, reserve: '0', reviews: reviews(1, 0, 0, 0), rating: '1', active: false },
    { id: 9008, name: 'Тестовый обменник 8', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9008) }, pages: {}, reserve: '0', reviews: reviews(9, 0, 0, 0), rating: '1', active: true },
    // Long-content layout rows (СБП → USDT TON only): long names, 6-digit review counts, many long marks.
    { id: 9009, name: 'Тестовый обменник 9 с очень длинным названием для проверки переноса', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9009) }, pages: {}, reserve: '0', reviews: reviews(123456, 12345, 3, 1), rating: '4.5', active: true },
    { id: 9010, name: 'ТестовыйОбменник10БезПробеловОченьДлинноеНазвание', langs: ['ru'], urls: { ru: click('www.bestchange.ru', 9010) }, pages: {}, reserve: '0', reviews: reviews(987654, 1, 0, 0), rating: '4', active: true },
  ],
};
const row = (changer, rate, rankrate, reserve, inmin, inmax, marks = []) => ({ changer, rate, rankrate, reserve, inmin, inmax, marks });
const pair = (from, to) => `${from}-${to}`;
const RATES = {
  // Сбербанк → USDT TRC-20: the main scenario.
  [pair(CUR.sberbank, CUR.USDTTRC20)]: [
    row(9001, 95.1, '95.60', '250000', '1000', '500000'),
    row(9002, 0.0104712, '0.0104603', '8000', '5000', '0', ['manual']), // crypto per RUB; inmax 0 = no max
    row(9003, 96.2, null, null, null, null, ['verifying', 'cardverify']),
    row(9004, 95.3, '95.45', '50000', '20000', '1000000', ['floating']),
    row(9005, 97, '97.40', '100', '500', '300000', ['reg']),
    row(9006, 95.95, '96.10', '1000000', '100', '2000000'),
    row(9007, 90, '90.10', '999999', '1', '9999999'), // inactive changer
    row(9008, 0, '0', '1000', '1', '100000'), // non-positive rate: dropped
    row(9999, 94, '94.10', '1000', '1', '100000'), // unknown changer: dropped
  ],
  [pair(CUR.sbp, CUR.USDTTRC20)]: [row(9001, 95.2, '95.70', '250000', '1000', '500000'), row(9006, 96, '96.30', '1000000', '100', '2000000')],
  [pair(CUR.tinkoff, CUR.USDTTRC20)]: [row(9001, 95.25, '95.75', '250000', '1000', '500000')],
  [pair(CUR.vtb, CUR.USDTTRC20)]: [row(9001, 95.4, '95.80', '250000', '1000', '500000')],
  [pair(CUR.card, CUR.USDTTRC20)]: [row(9006, 96.5, '96.90', '1000000', '100', '2000000')],
  [pair(CUR.ozon, CUR.USDTTRC20)]: [row(9006, 96.4, '96.80', '1000000', '100', '2000000')],
  [pair(CUR.sberbank, CUR.TRX)]: [row(9001, 0.0833, '0.0830', '900000', '1000', '500000'), row(9002, 12.4, '12.50', '50000', '2000', '0', ['manual'])],
  [pair(CUR.sberbank, CUR.BTC)]: [row(9001, 0.00000011, '0.000000109', '3', '5000', '5000000')],
  [pair(CUR.sbp, CUR.USDTERC20)]: [row(9002, 96.8, '97.10', '20000', '5000', '0')],
  [pair(CUR.sberbank, CUR.TON)]: [row(9006, 0.0041, '0.0040', '10000', '1000', '1000000')],
  [pair(CUR.sberbank, CUR.USDTBEP20)]: [row(9008, 0, null, null, null, null)], // only a dropped row: pair stays unavailable
  [pair(CUR.sbp, CUR.USDTTON)]: [
    row(9009, 95.12, '95.40', '1234567.89', '1000', '100000000', ['otherout', 'otherin', 'cardverify', 'verifying', 'percent', 'unstable']),
    row(9010, 96.1, '96.30', '7654321', '1000', '100000000', ['card2card', 'otherout']),
  ],
};
const FIXTURE_NAMES = CHANGERS.changers.map((c) => c.name);

// ---------------------------------------------------------------------------
// Injected upstream fetch (no network)
// ---------------------------------------------------------------------------
const upstreamCalls = [];
function fixtureFetch(input) {
  const url = new URL(String(input));
  const parts = url.pathname.split('/'); // ['', 'v2', key, kind, ...]
  const keyOk = parts[2] === encodeURIComponent(FAKE_KEY);
  upstreamCalls.push({ host: url.hostname, path: ['', 'v2', '<fake-key>', ...parts.slice(3)].join('/'), keyOk });
  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (!keyOk) return json({ error: 'Invalid API key' });
  if (parts[3] === 'currencies') return json(CURRENCIES);
  if (parts[3] === 'changers') return json(CHANGERS);
  if (parts[3] === 'rates') {
    const asked = (parts[4] || '').split('+');
    const rates = {};
    for (const key of asked) if (RATES[key]) rates[key] = RATES[key];
    return json({ rates });
  }
  return Promise.resolve(new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }));
}

// ---------------------------------------------------------------------------
// Expected values, derived from the fixture by hand-written rules
// ---------------------------------------------------------------------------
const rubPer = (v) => { const n = Number(v); if (!(n > 0)) return null; return n < 1 ? 1 / n : n; };
const floor2 = (v) => Math.floor(Number((v * 100).toPrecision(15))) / 100;
const fmt2 = (v) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
/** formatRub(rate, 2): up to 2 decimals, trailing zeros dropped («95,1 ₽», «97 ₽»). */
const fmtRate = (v) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
const norm = (s) => String(s).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
function expectedOffers(fromId, toId, amount) {
  const active = new Map(CHANGERS.changers.filter((c) => c.active).map((c) => [c.id, c]));
  return (RATES[pair(fromId, toId)] || [])
    .filter((r) => active.has(r.changer) && rubPer(r.rate) !== null)
    .map((r) => ({ id: r.changer, name: active.get(r.changer).name, rub: rubPer(r.rate), receive: floor2(amount / rubPer(r.rate)) }));
}

// ---------------------------------------------------------------------------
// Local servers
// ---------------------------------------------------------------------------
function freePort(from, to, taken) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > to) return reject(new Error(`no free port in ${from}-${to}`));
      if (taken.includes(p)) return tryPort(p + 1);
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(from);
  });
}

function buildApp(service) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/v1', exchangersRouter(service, { perClientLimit: 10_000 }));
  // Minimal session reads the shared Nav may make for a signed-in visitor (fixture user, read-only).
  app.get('/api/v1/me', (_req, res) => res.json({ id: 'qa-exchangers', email: 'qa@example.invalid', displayName: 'Тестовый пользователь', role: 'USER', isAdmin: false, avatarUrl: null, emailVerified: true, kycStatus: 'NONE', createdAt: '2025-01-01T00:00:00.000Z' }));
  app.use('/api', (req, res) => { apiMisses.push(`${req.method} ${req.originalUrl.split('?')[0]}`); res.status(404).json({ error: 'not in fixture' }); });
  app.use(express.static(dist, { extensions: ['html'], redirect: false }));
  app.use((req, res) => (/\.[a-z0-9]+$/i.test(req.path) ? res.status(404).end() : res.sendFile(path.join(dist, 'index.html'))));
  return app;
}
const apiMisses = [];

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------
const report = {
  issue: 694, fixtureOnly: true, productionCalls: 0, startedAt: new Date().toISOString(),
  servers: {}, checks: [], screenshots: [], upstreamCalls, apiMisses, denied: [], consoleErrors: [], pageErrors: [], keyLeaks: [], result: 'FAIL',
};
function check(name, ok, detail) {
  report.checks.push({ name, result: ok ? 'PASS' : 'FAIL', ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ` :: ${JSON.stringify(detail)}` : ''}`);
  return ok;
}
async function step(name, fn) {
  try { await fn(); } catch (error) { check(`${name} (completed without exception)`, false, String(error && error.stack || error).split('\n').slice(0, 4).join(' | ')); }
}
async function shot(page, file, fullPage = false) {
  const p = path.join(out, file);
  await page.screenshot({ path: p, fullPage });
  report.screenshots.push(path.relative(repo, p));
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
const TOKEN = 'qa-exchangers-dummy-token';
async function newPage(browser, origin, { width, height, mobile = false, signedIn = false, label }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { deviceScaleFactor: 1 }),
    colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  });
  await ctx.addInitScript(([signed, token]) => {
    try {
      localStorage.setItem('exchange_lang', 'ru');
      if (signed) localStorage.setItem('exchange_token', token); else localStorage.removeItem('exchange_token');
    } catch { /* ignore */ }
  }, [signedIn, TOKEN]);
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) {
      report.denied.push({ label, url: `${url.protocol}//${url.host}${url.pathname}` });
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline QA */' });
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(req.method())) { report.denied.push({ label, method: req.method(), url: url.pathname }); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await ctx.routeWebSocket('**/*', (ws) => ws.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); report.pageErrors.push({ label, message: e.message }); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); report.consoleErrors.push({ label, text: m.text() }); } });
  page.on('response', async (res) => {
    if (!res.url().includes('/api/v1/exchangers/')) return;
    try { const body = await res.text(); if (body.includes(FAKE_KEY) || body.includes('/v2/')) report.keyLeaks.push({ label, url: res.url() }); } catch { /* ignore */ }
  });
  return { ctx, page, errors };
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => ({ scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
}

/** Rows of the visible list (table on desktop, cards on phones). */
async function readOffers(page) {
  return page.evaluate(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const table = document.querySelector('.vx-ex-table');
    const cards = document.querySelector('.vx-ex-cards');
    const useTable = visible(table);
    const items = useTable ? [...document.querySelectorAll('.vx-ex-table tbody tr')] : [...document.querySelectorAll('.vx-ex-cards > li')];
    return {
      layout: useTable ? 'table' : visible(cards) ? 'cards' : 'none',
      rows: items.filter(visible).map((el) => {
        const receiveEl = useTable ? el.querySelector('td:nth-child(3) .vx-ex-strong') : el.querySelector('.vx-ex-offer-main > div:nth-child(1) .vx-ex-strong');
        const rateEl = useTable ? el.querySelector('td:nth-child(2) .vx-ex-strong') : el.querySelector('.vx-ex-offer-main > div:nth-child(2) .vx-ex-strong');
        const a = el.querySelector('.vx-ex-action a');
        return {
          name: el.querySelector('.vx-ex-name-title')?.textContent ?? null,
          receive: receiveEl?.textContent ?? null,
          rate: rateEl?.textContent ?? null,
          best: !!el.querySelector('.vx-ex-best'),
          link: a ? { text: a.childNodes[0]?.textContent ?? a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), referrerpolicy: a.getAttribute('referrerpolicy') } : null,
        };
      }),
    };
  });
}

async function waitOffers(page, predicate) {
  return page.waitForResponse((r) => r.url().includes('/api/v1/exchangers/offers') && predicate(new URL(r.url()).searchParams), { timeout: 15_000 });
}

async function runCalculatorScenario(browser, origin, vp) {
  const tag = `${vp.name}`;
  const { ctx, page, errors } = await newPage(browser, origin, { ...vp, label: `${tag}-${vp.signedIn ? 'signed-in' : 'guest'}` });
  const who = vp.signedIn ? 'signed-in' : 'guest';
  try {
    const firstOffers = waitOffers(page, () => true);
    await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Параметры обмена' }).waitFor();
    const initial = await firstOffers;
    check(`${tag} ${who}: page loads and runs the default search (HTTP ${initial.status()})`, initial.status() === 200);
    check(`${tag} ${who}: content root is lang="ru"`, (await page.locator('main.vx-ex').getAttribute('lang')) === 'ru');
    check(`${tag} ${who}: ${vp.signedIn ? 'shared Nav' : 'guest header'} rendered`, vp.signedIn
      ? (await page.locator('header .nav-burger, header .main-nav').count()) > 0 && (await page.locator('.vx-ex-guest-header').count()) === 0
      : (await page.locator('.vx-ex-guest-header').count()) === 1);

    // Directory → options
    const methodOptions = await page.locator('#vx-ex-method option').evaluateAll((o) => o.map((x) => ({ value: x.value, text: x.textContent, disabled: x.disabled })));
    const ids = methodOptions.map((o) => o.value);
    check(`${tag} ${who}: fixed RUB methods + dynamic «Озон Банк RUB» listed; cash/non-RUB hidden`,
      ['sbp', 'sberbank', 'tbank', 'alfabank', 'vtb', 'card', 'mir', 'bc-ozon-bank'].every((id) => ids.includes(id)) && ids.length === 8
        && methodOptions.find((o) => o.value === 'bc-ozon-bank')?.text === 'Озон Банк RUB · банк', methodOptions);
    check(`${tag} ${who}: methods without rate rows are disabled (Альфа-Банк, Карта Мир)`,
      methodOptions.filter((o) => o.disabled).map((o) => o.value).sort().join(',') === 'alfabank,mir', methodOptions.filter((o) => o.disabled));

    if (vp.mobile) await shot(page, 'mobile-390-calculator.png');

    // Сбербанк + USDT + TRON (TRC-20)
    await page.selectOption('#vx-ex-method', { label: 'Сбербанк · банк' });
    await page.selectOption('#vx-ex-asset', 'USDT');
    await page.selectOption('#vx-ex-network', 'tron');
    const netLabel = await page.locator('#vx-ex-network option:checked').textContent();
    check(`${tag} ${who}: USDT network label is «TRON (TRC-20)»`, netLabel === 'TRON (TRC-20)', netLabel);
    const usdtNetworks = await page.locator('#vx-ex-network option').evaluateAll((o) => o.map((x) => x.textContent));
    check(`${tag} ${who}: USDT networks are the 4 catalogue networks`, usdtNetworks.length === 4, usdtNetworks);

    const expected = expectedOffers(CUR.sberbank, CUR.USDTTRC20, AMOUNT);
    for (const typed of ['15 000,50', '15000.5']) {
      await page.fill('#vx-ex-amount', typed);
      const resp = waitOffers(page, (q) => q.get('method') === 'sberbank' && q.get('asset') === 'USDT' && q.get('network') === 'tron');
      await page.getByRole('button', { name: 'Найти обменники' }).click();
      const r = await resp;
      const sentAmount = new URL(r.url()).searchParams.get('amount');
      check(`${tag} ${who}: amount «${typed}» is sent as ${AMOUNT}`, sentAmount === String(AMOUNT) && r.status() === 200, { sentAmount, status: r.status() });
      await page.locator('.vx-ex-list').waitFor();
      const { layout, rows } = await readOffers(page);
      check(`${tag} ${who} «${typed}»: layout is ${vp.mobile ? 'cards' : 'table'}`, layout === (vp.mobile ? 'cards' : 'table'), layout);
      const names = rows.map((x) => x.name).sort();
      check(`${tag} ${who} «${typed}»: exactly the active, positive-rate fixture exchangers render (inactive #7, zero-rate #8, unknown changer dropped)`,
        JSON.stringify(names) === JSON.stringify(expected.map((e) => e.name).sort()), names);
      const mismatches = [];
      for (const e of expected) {
        const got = rows.find((x) => x.name === e.name);
        const want = `${fmt2(e.receive)} USDT`;
        if (!got || norm(got.receive) !== norm(want)) mismatches.push({ name: e.name, want, got: got && got.receive });
        const wantRate = `${fmtRate(e.rub)} ₽`;
        if (!got || norm(got.rate) !== norm(wantRate)) mismatches.push({ name: e.name, wantRate, gotRate: got && got.rate });
      }
      check(`${tag} ${who} «${typed}»: receive = floor(amount / RUB-per-unit, 2) and rate per row match the fixture (incl. crypto-per-RUB row inverted)`, mismatches.length === 0, mismatches);
      const shown = norm(await page.locator('.vx-ex-list-head .vx-ex-muted').textContent());
      check(`${tag} ${who} «${typed}»: «Показано ${expected.length} из ${expected.length}»`, shown === `Показано ${expected.length} из ${expected.length}`, shown);
      const live = await page.locator('.vx-ex-results [aria-live]').evaluateAll((els) => els.map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), text: el.textContent })));
      check(`${tag} ${who} «${typed}»: the only live region is the short status line (count + update time)`,
        live.length === 1 && live[0].tag === 'P' && live[0].role === 'status' && new RegExp(`^Показано ${expected.length} из ${expected.length} предложений\\. Обновлено в \\d\\d:\\d\\d\\.`).test(norm(live[0].text)), live);

      // Links
      const exch = rows.filter((x) => x.link && norm(x.link.text) === 'Перейти к обменнику');
      const bad = exch.filter((x) => {
        const id = CHANGERS.changers.find((c) => c.name === x.name).id;
        let u; try { u = new URL(x.link.href); } catch { return true; }
        return !['www.bestchange.ru', 'bestchange.ru', 'www.bestchange.com', 'bestchange.com'].includes(u.hostname) || u.protocol !== 'https:'
          || u.pathname !== '/click.php' || u.search !== `?id=${id}` || u.hash !== '' || x.link.href !== `https://${u.hostname}/click.php?id=${id}`;
      });
      check(`${tag} ${who} «${typed}»: every «Перейти к обменнику» href is exactly https://<BestChange host>/click.php?id=<that exchanger id>`, exch.length === expected.length - 1 && bad.length === 0, { count: exch.length, bad });
      const allLinks = await page.locator('.vx-ex-results a[href^="http"]:visible').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), referrerpolicy: a.getAttribute('referrerpolicy') })));
      const badAttrs = allLinks.filter((l) => l.target !== '_blank' || !/(^|\s)noopener(\s|$)/.test(l.rel || '') || l.referrerpolicy !== 'origin');
      check(`${tag} ${who} «${typed}»: all ${allLinks.length} outbound links have target=_blank, rel⊇noopener, referrerpolicy=origin`, allLinks.length > 0 && badAttrs.length === 0, badAttrs);
      const leaky = allLinks.filter((l) => l.href.includes(TOKEN) || l.href.includes('voltex') || l.href.includes(FAKE_KEY));
      check(`${tag} ${who} «${typed}»: no token/key/VOLTEX data in any outbound link`, leaky.length === 0, leaky);
      const evil = rows.find((x) => x.name === 'Тестовый обменник 4');
      check(`${tag} ${who} «${typed}»: malicious-urls offer shows «Выбрать на BestChange» to the direction page (with partner id)`,
        !!evil && !!evil.link && norm(evil.link.text) === 'Выбрать на BestChange' && evil.link.href === `https://www.bestchange.ru/sberbank-to-tether-trc20.html?p=${PARTNER_ID}`, evil && evil.link);
      const en = rows.find((x) => x.name === 'Тестовый обменник 6');
      check(`${tag} ${who} «${typed}»: ru-less exchanger falls back to its en click link`, en && en.link && en.link.href === click('www.bestchange.com', 9006), en && en.link);

      // Estimate = best eligible offer (fits amount, receive known, lowest rank rate)
      const bestRow = rows.find((x) => x.best);
      const estimate = norm(await page.locator('.vx-ex-estimate-value').textContent());
      check(`${tag} ${who} «${typed}»: estimate equals the «Лучший курс» offer (Тестовый обменник 2) receive`,
        !!bestRow && bestRow.name === 'Тестовый обменник 2' && estimate === `≈ ${norm(bestRow.receive)}`, { estimate, best: bestRow && bestRow.name });
      const head = norm(await page.locator('.vx-ex-results-head .vx-ex-muted').first().textContent());
      check(`${tag} ${who} «${typed}»: results heading names the query`, head === norm(`Сбербанк → USDT TRON (TRC-20) · ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(AMOUNT)} ₽`), head);
    }

    // Limits / null rendering on the details
    const listText = norm(await page.locator(vp.mobile ? '.vx-ex-cards' : '.vx-ex-table').textContent());
    check(`${tag} ${who}: unknown values render as «Нет данных», inmax 0 as «… – ?», out-of-limit amount flagged`,
      listText.includes('Нет данных') && listText.includes('5 000 ₽ – ?') && listText.includes('сумма вне лимитов') && listText.includes('меньше суммы обмена'));

    if (!vp.signedIn) {
      await page.locator('#vx-ex-results-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -96));
      await shot(page, vp.mobile ? 'mobile-390-results.png' : 'desktop-1440-results.png');
    }

    // Native selects clip their label silently: measure the selected text against the content box.
    const clipped = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      return ['#vx-ex-sort', '#vx-ex-method', '#vx-ex-asset', '#vx-ex-network'].map((sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = el.options[el.selectedIndex]?.text ?? '';
        const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { sel, text, textWidth: Math.ceil(ctx.measureText(text).width), room: Math.floor(room) };
      }).filter((x) => x.textWidth > x.room);
    });
    check(`${tag} ${who}: selected labels of sort/method/asset/network selects are not clipped`, clipped.length === 0, clipped);

    // Sort
    const order = async () => (await readOffers(page)).rows.map((x) => x.name.replace('Тестовый обменник ', ''));
    const expectedSort = {
      // Offers that can serve 15 000,5 ₽ first (#4: below its 20 000 ₽ minimum, #5: reserve 100 USDT < ~154 USDT go last).
      best: ['2', '1', '6', '3', '4', '5'],
      rate: ['1', '4', '2', '6', '3', '5'],
      reserve: ['6', '1', '4', '2', '5', '3'],
      min: ['6', '5', '1', '2', '4', '3'],
      reviews: ['1', '6', '2', '4', '5', '3'],
    };
    for (const [key, want] of Object.entries(expectedSort)) {
      await page.selectOption('#vx-ex-sort', key);
      const got = await order();
      check(`${tag} ${who}: sort «${key}» gives ${want.join(',')}`, got.join(',') === want.join(','), got);
      if (key === 'best') {
        const first = (await readOffers(page)).rows[0];
        check(`${tag} ${who}: the first row of the default sort carries the crown`, !!first && first.best === true, first && first.name);
      }
    }
    await page.selectOption('#vx-ex-sort', 'best');

    // Filters
    const count = async () => (await readOffers(page)).rows.length;
    const filters = [['Подходит под сумму', 3], ['Есть отзывы', 4], ['Без ручной проверки и верификации', 4]];
    for (const [label, want] of filters) {
      const btn = page.locator('.vx-ex-filters button', { hasText: label });
      await btn.click();
      const n = await count();
      check(`${tag} ${who}: filter «${label}» narrows 6 → ${want}`, n === want && (await btn.getAttribute('aria-pressed')) === 'true', n);
      await btn.click();
      check(`${tag} ${who}: filter «${label}» off restores 6`, (await count()) === 6);
    }
    await page.fill('#vx-ex-search', 'обменник 3');
    check(`${tag} ${who}: search «обменник 3» leaves one row`, (await count()) === 1);
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await page.locator('.vx-ex-filters button', { hasText: 'Подходит под сумму' }).click();
    await page.locator('.vx-ex-filters button', { hasText: 'Есть отзывы' }).click();
    await page.locator('.vx-ex-filters button', { hasText: 'Без ручной проверки и верификации' }).click();
    const combined = await count();
    check(`${tag} ${who}: all three filters together leave 2 (1 and 6)`, combined === 2, combined);
    await page.fill('#vx-ex-search', 'нет такого');
    const empty = await page.getByText('Нет предложений под выбранные фильтры').isVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    check(`${tag} ${who}: empty filtered state + «Сбросить фильтры» restores the list`, empty && (await count()) === 6 && (await page.locator('#vx-ex-search').inputValue()) === '');

    // TRX: native network, never USDT TRC-20
    await page.selectOption('#vx-ex-asset', 'TRX');
    const trxNetworks = await page.locator('#vx-ex-network option').evaluateAll((o) => o.map((x) => x.textContent));
    check(`${tag} ${who}: TRX network label is «TRON (Native)» and TRC-20 is not offered`, trxNetworks.length === 1 && trxNetworks[0] === 'TRON (Native)' && !trxNetworks.some((t) => /TRC-20/.test(t)), trxNetworks);
    const hint = norm(await page.locator('.vx-ex-network-hint').textContent());
    check(`${tag} ${who}: TRX hint says it is not USDT TRC-20`, hint.includes('TRX — нативная монета сети TRON') && hint.includes('Это не USDT TRC-20'), hint);
    check(`${tag} ${who}: «Параметры изменены» shown after switching the asset`, await page.getByText('Параметры изменены — нажмите «Найти обменники»').isVisible());
    const trxResp = waitOffers(page, (q) => q.get('asset') === 'TRX' && q.get('network') === 'tron');
    await page.getByRole('button', { name: 'Найти обменники' }).click();
    await trxResp;
    await page.locator('.vx-ex-results-head .vx-ex-muted', { hasText: 'TRX' }).waitFor();
    const trxRows = (await readOffers(page)).rows;
    const trxExpected = expectedOffers(CUR.sberbank, CUR.TRX, AMOUNT);
    const trxBad = trxExpected.filter((e) => { const g = trxRows.find((x) => x.name === e.name); return !g || norm(g.receive) !== norm(`${fmt2(e.receive)} TRX`); });
    check(`${tag} ${who}: TRX offers render with fixture math`, trxRows.length === trxExpected.length && trxBad.length === 0, { trxRows, trxBad });
    const trxHead = norm(await page.locator('.vx-ex-results-head .vx-ex-muted').first().textContent());
    check(`${tag} ${who}: TRX results heading says «TRX TRON (Native)»`, trxHead.includes('TRX TRON (Native)'), trxHead);

    // Tutorial + FAQ
    const faqButtons = page.locator('.vx-ex-accordion button[aria-expanded]');
    const nFaq = await faqButtons.count();
    for (let i = 0; i < nFaq; i++) await faqButtons.nth(i).click();
    const expandedAll = await faqButtons.evaluateAll((b) => b.every((x) => x.getAttribute('aria-expanded') === 'true'));
    const regionsVisible = await page.locator('.vx-ex-accordion [role="region"]').evaluateAll((r) => r.every((x) => !x.hidden && x.getClientRects().length > 0));
    check(`${tag} ${who}: all ${nFaq} FAQ answers expand (aria-expanded + visible region)`, nFaq > 0 && expandedAll && regionsVisible);
    await faqButtons.first().click();
    check(`${tag} ${who}: FAQ answer collapses again`, (await faqButtons.first().getAttribute('aria-expanded')) === 'false' && await page.locator('#vx-ex-faq-a0').isHidden());
    await page.locator('#vx-ex-tutorial-title').scrollIntoViewIfNeeded();
    const steps = await page.locator('.vx-ex-steps > li').count();
    check(`${tag} ${who}: tutorial shows 6 steps and the safety rules`, steps === 6 && await page.getByRole('heading', { name: 'Правила безопасности' }).isVisible(), steps);
    if (!vp.signedIn && !vp.mobile) {
      await page.locator('#vx-ex-tutorial-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -80));
      await shot(page, 'desktop-1440-tutorial.png');
    }

    const sw = await noHorizontalScroll(page);
    check(`${tag} ${who}: no horizontal scroll (scrollWidth ${sw.scrollWidth} ≤ innerWidth ${sw.innerWidth})`, sw.scrollWidth <= sw.innerWidth, sw);
    check(`${tag} ${who}: no page errors / console errors`, errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

/** Long real-shaped content (long names, long marks, 6-digit reviews) must stay inside its own cell/card. */
async function runLongContent(browser, origin) {
  for (const vp of [{ width: 1024, height: 900 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }, { width: 390, height: 844, mobile: true }]) {
    const tag = `long-content-${vp.width}`;
    const { ctx, page, errors } = await newPage(browser, origin, { ...vp, label: tag });
    try {
      const first = waitOffers(page, () => true);
      await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Параметры обмена' }).waitFor();
      await first;
      await page.selectOption('#vx-ex-method', 'sbp');
      await page.selectOption('#vx-ex-asset', 'USDT');
      await page.selectOption('#vx-ex-network', 'ton');
      await page.fill('#vx-ex-amount', '10000');
      const resp = waitOffers(page, (q) => q.get('method') === 'sbp' && q.get('network') === 'ton');
      await page.getByRole('button', { name: 'Найти обменники' }).click();
      check(`${tag}: СБП → USDT TON offers answered 200`, (await resp).status() === 200);
      await page.locator('.vx-ex-list').waitFor();
      const { layout, rows } = await readOffers(page);
      check(`${tag}: layout is ${vp.mobile ? 'cards' : 'table'} with both long-content rows`, layout === (vp.mobile ? 'cards' : 'table') && rows.length === 2, { layout, rows: rows.length });
      const r = await page.evaluate(() => {
        const visible = (el) => el.getClientRects().length > 0;
        const boxes = [...document.querySelectorAll('.vx-ex-table td, .vx-ex-offer')].filter(visible);
        const overflow = [];
        for (const box of boxes) {
          const cb = box.getBoundingClientRect();
          for (const el of box.querySelectorAll('*')) {
            if (!visible(el) || el.closest('.vx-ex-sr')) continue;
            const b = el.getBoundingClientRect();
            if (b.width && b.right > cb.right + 1) overflow.push({ cell: box.cellIndex ?? 'card', cls: String(el.className), text: el.textContent.slice(0, 40), over: Math.round(b.right - cb.right) });
          }
        }
        const names = [...document.querySelectorAll('.vx-ex-name-title')].filter(visible);
        return {
          overflow: overflow.slice(0, 10),
          namesFull: names.every((n) => n.scrollWidth <= n.clientWidth + 1 && n.getAttribute('title') === n.textContent),
          scrollWidth: document.scrollingElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      check(`${tag}: no tag, review count or name spills past its ${vp.mobile ? 'card' : 'table cell'}`, r.overflow.length === 0, r.overflow);
      check(`${tag}: exchanger names are shown in full (wrapped, not ellipsised) and carry a title`, r.namesFull, r);
      check(`${tag}: no horizontal page scroll`, r.scrollWidth <= r.innerWidth, { scrollWidth: r.scrollWidth, innerWidth: r.innerWidth });
      check(`${tag}: no page errors / console errors`, errors.length === 0, errors);
      if (!vp.mobile) {
        await page.locator('.vx-ex-table-wrap').scrollIntoViewIfNeeded();
        const p = path.join(out, `desktop-${vp.width}-long-content.png`);
        await page.locator('.vx-ex-table-wrap').screenshot({ path: p });
        report.screenshots.push(path.relative(repo, p));
      }
    } finally { await ctx.close(); }
  }
}

async function runNotConfigured(browser, origin, vp) {
  const tag = vp.name;
  const { ctx, page, errors } = await newPage(browser, origin, { ...vp, label: `${tag}-not-configured` });
  try {
    const dir = page.waitForResponse((r) => r.url().includes('/api/v1/exchangers/directory'));
    await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
    const res = await dir;
    const body = await res.json();
    check(`${tag} not_configured: directory answers 200 {status:"not_configured"}`, res.status() === 200 && JSON.stringify(body) === '{"status":"not_configured"}', body);
    const notice = page.getByText('Сравнение курсов сейчас недоступно: подключение к BestChange не настроено');
    await notice.waitFor();
    check(`${tag} not_configured: honest notice shown`, await notice.isVisible() && await page.getByText('Мы не показываем вымышленные курсы и резервы.', { exact: false }).isVisible());
    const resultsBody = page.locator('.vx-ex-results > div[aria-busy]');
    const results = norm(await page.locator('.vx-ex-results').innerText());
    check(`${tag} not_configured: results section contains no numbers`, !/\d/.test(results), results);
    check(`${tag} not_configured: no offer rows or cards`, (await page.locator('.vx-ex-table tbody tr, .vx-ex-cards > li').count()) === 0);
    check(`${tag} not_configured: estimate is «—» and says rates are not loaded`, norm(await page.locator('.vx-ex-estimate-value').textContent()) === '—' && await page.getByText('курсы не загружены').isVisible());
    check(`${tag} not_configured: no «Обновить» button, no toolbar`, (await page.getByRole('button', { name: 'Обновить' }).count()) === 0 && (await page.locator('.vx-ex-toolbar').count()) === 0);
    const dirLink = page.locator('.vx-ex-results a', { hasText: 'Выбрать на BestChange' });
    const href = await dirLink.getAttribute('href');
    check(`${tag} not_configured: «Выбрать на BestChange» to the direction page`, href === 'https://www.bestchange.ru/sbp-to-tether-trc20.html'
      && (await dirLink.getAttribute('target')) === '_blank' && /noopener/.test(await dirLink.getAttribute('rel')) && (await dirLink.getAttribute('referrerpolicy')) === 'origin', href);
    await page.selectOption('#vx-ex-method', 'sberbank');
    await page.fill('#vx-ex-amount', '15 000,50');
    let offersCalls = 0;
    page.on('request', (r) => { if (r.url().includes('/exchangers/offers')) offersCalls += 1; });
    await page.getByRole('button', { name: 'Найти обменники' }).click();
    await page.waitForTimeout(400);
    const href2 = await dirLink.getAttribute('href');
    // The heading now echoes the visitor's own query («… TRON (TRC-20) · 15 000,5 ₽»); the result body must still carry no number.
    const results2 = norm(await resultsBody.innerText());
    const estimate2 = norm(await page.locator('.vx-ex-estimate-value').textContent());
    check(`${tag} not_configured: search only re-targets the BestChange link (no offers request, still no rate/receive numbers)`,
      offersCalls === 0 && href2 === 'https://www.bestchange.ru/sberbank-to-tether-trc20.html' && !/\d/.test(results2) && estimate2 === '—', { offersCalls, href2, results2, estimate2 });
    if (vp.mobile) {
      await page.locator('#vx-ex-results-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -420)); // estimate «—» + search button + notice in one phone screen
    } else {
      await page.locator('#vx-ex-calc-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -24));
    }
    await shot(page, vp.mobile ? 'mobile-390-not-configured.png' : 'desktop-1440-not-configured.png');
    const sw = await noHorizontalScroll(page);
    check(`${tag} not_configured: no horizontal scroll`, sw.scrollWidth <= sw.innerWidth, sw);
    check(`${tag} not_configured: no page errors / console errors`, errors.length === 0, errors);
  } finally {
    await ctx.close();
  }
}

async function runNav(browser, origin) {
  for (const width of [1531, 1600, 1920]) {
    const { ctx, page, errors } = await newPage(browser, origin, { width, height: 900, signedIn: true, label: `nav-${width}` });
    try {
      await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
      const link = page.locator('header .main-nav a[href="/exchangers"]');
      await link.waitFor({ state: 'visible' });
      check(`nav ${width}: signed-in desktop row shows «Обменники» (active)`, norm(await link.textContent()) === 'Обменники' && /nav-active/.test(await link.getAttribute('class')));
      const geometry = await page.locator('header').first().evaluate((h) => {
        const nav = h.querySelector('.main-nav');
        const right = h.querySelector('.header-actions') || nav.nextElementSibling;
        const end = Math.max(...[...nav.children].map((n) => n.getBoundingClientRect().right));
        return { end, right: right ? right.getBoundingClientRect().left : null };
      });
      check(`nav ${width}: desktop row does not overlap the account controls`, geometry.right === null || geometry.end <= geometry.right + 1, geometry);
      const items = await page.locator('header .main-nav').first().evaluate((nav) => [...nav.children].map((n) => {
        const r = n.getBoundingClientRect();
        const t = n.matches('a,button') ? n : n.querySelector('a,button');
        return { text: (n.textContent || '').trim(), left: r.left, right: r.right, clipped: t ? t.scrollWidth > t.clientWidth + 1 : false };
      }));
      const overlaps = items.slice(1).filter((it, i) => it.left < items[i].right - 0.5).map((it) => it.text);
      const clippedItems = items.filter((it) => it.clipped).map((it) => it.text);
      check(`nav ${width}: no two desktop row items overlap and no label is clipped`, overlaps.length === 0 && clippedItems.length === 0, { overlaps, clippedItems });
      if (width === 1600) await shot(page, 'nav-1600.png');
      const sw = await noHorizontalScroll(page);
      check(`nav ${width}: no horizontal scroll`, sw.scrollWidth <= sw.innerWidth, sw);
      check(`nav ${width}: no page errors / console errors`, errors.length === 0, errors);
    } finally { await ctx.close(); }
  }
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, mobile: true }]) {
    const { ctx, page, errors } = await newPage(browser, origin, { ...vp, signedIn: true, label: `drawer-${vp.width}` });
    try {
      await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
      const rowLink = page.locator('header .main-nav a[href="/exchangers"]');
      check(`drawer ${vp.width}: desktop row hidden below 1531 px`, !(await rowLink.isVisible().catch(() => false)));
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      const link = page.locator('.nav-mobile-menu.open a[href="/exchangers"]');
      await link.waitFor({ state: 'visible' });
      check(`drawer ${vp.width}: drawer shows «Обменники»`, norm(await link.textContent()) === 'Обменники');
      if (vp.width === 390) await shot(page, 'drawer-390.png');
      // Shared Nav closes the drawer on a pathname change (Nav.tsx useEffect on location.pathname), so the
      // navigation is checked from another public page that renders the same signed-in Nav (Academy).
      await page.goto(`${origin}/academy`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      const fromAcademy = page.locator('.nav-mobile-menu.open a[href="/exchangers"]');
      await fromAcademy.waitFor({ state: 'visible' });
      const dirLoaded = page.waitForResponse((r) => r.url().includes('/api/v1/exchangers/directory'));
      await fromAcademy.click();
      await dirLoaded;
      await page.getByRole('heading', { name: 'Параметры обмена' }).waitFor();
      check(`drawer ${vp.width}: drawer link from /academy opens /exchangers (client-side) and the drawer closes`, new URL(page.url()).pathname === '/exchangers' && (await page.locator('.nav-mobile-menu.open').count()) === 0);
      check(`drawer ${vp.width}: no page errors / console errors`, errors.length === 0, errors);
    } finally { await ctx.close(); }
  }
  // Guest: product row ≥1531, tabs row below.
  for (const vp of [{ width: 1600, height: 900 }, { width: 390, height: 844, mobile: true }]) {
    const { ctx, page, errors } = await newPage(browser, origin, { ...vp, label: `guest-nav-${vp.width}` });
    try {
      await page.goto(`${origin}/exchangers`, { waitUntil: 'domcontentloaded' });
      const sel = vp.width >= 1531 ? '.vx-ex-guest-header .main-nav a[href="/exchangers"]' : '.vx-ex-guest-tabs a[href="/exchangers"]';
      const link = page.locator(sel);
      await link.waitFor({ state: 'visible' });
      check(`guest ${vp.width}: «Обменники» visible with aria-current=page`, norm(await link.textContent()) === 'Обменники' && (await link.getAttribute('aria-current')) === 'page');
      check(`guest ${vp.width}: no page errors / console errors`, errors.length === 0, errors);
    } finally { await ctx.close(); }
  }
}

async function main() {
  // Fixture sanity: every catalogue pair has exactly one crypto currency in the fixture.
  const codes = new Set(CURRENCIES.currencies.filter((c) => c.crypto).map((c) => c.code));
  check(`fixture: crypto codes cover all ${RECEIVE_PAIRS.length} catalogue asset/network pairs`, RECEIVE_PAIRS.every((p) => p.match.codes.some((c) => codes.has(c))), RECEIVE_PAIRS.map((p) => p.key));

  const okService = new BestChangeService({ apiKey: FAKE_KEY, partnerId: PARTNER_ID, fetchFn: fixtureFetch });
  let offUpstreamCalls = 0;
  const offService = new BestChangeService({ apiKey: undefined, fetchFn: () => { offUpstreamCalls += 1; throw new Error('not_configured must not call upstream'); } });
  const portOk = await freePort(4460, 4469, []);
  const portOff = await freePort(4460, 4469, [portOk]);
  const servers = [];
  const listen = (app, port) => new Promise((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); servers.push(s); });
  await listen(buildApp(okService), portOk);
  await listen(buildApp(offService), portOff);
  const originOk = `http://127.0.0.1:${portOk}`;
  const originOff = `http://127.0.0.1:${portOff}`;
  report.servers = { ok: originOk, notConfigured: originOff };
  console.log(`ok mode ${originOk}, not_configured mode ${originOff}`);

  // API-level checks (same process, real router).
  await step('api', async () => {
    const dir = await (await fetch(`${originOk}/api/v1/exchangers/directory`)).json();
    const avail = Object.fromEntries(dir.assets.map((a) => [`${a.assetId}:${a.networkId}`, a.available]));
    check('api: directory lists every catalogue pair; only pairs with usable rows are available',
      dir.status === 'ok' && dir.assets.length === RECEIVE_PAIRS.length && avail['USDT:tron'] && avail['TRX:tron'] && avail['BTC:bitcoin'] && avail['TON:ton'] && avail['USDT:ethereum'] && !avail['USDT:bsc'] && !avail['SOL:solana'], dir.assets);
    const bad = await fetch(`${originOk}/api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=0`);
    check('api: amount 0 → 400 {status:"invalid"}', bad.status === 400 && (await bad.json()).status === 'invalid');
    const trc = await fetch(`${originOk}/api/v1/exchangers/offers?method=sberbank&asset=TRX&network=bsc&amount=100`);
    check('api: TRX on bsc (not a catalogue pair) → 400', trc.status === 400);
    const off = await fetch(`${originOff}/api/v1/exchangers/offers?method=sbp&asset=USDT&network=tron&amount=100`);
    check('api: not_configured offers → 200 {status:"not_configured"}', off.status === 200 && JSON.stringify(await off.json()) === '{"status":"not_configured"}');
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = { name: 'desktop-1440', width: 1440, height: 900 };
    const mobile = { name: 'mobile-390', width: 390, height: 844, mobile: true };
    for (const vp of [desktop, mobile]) {
      for (const signedIn of [false, true]) await step(`${vp.name} ${signedIn ? 'signed-in' : 'guest'}`, () => runCalculatorScenario(browser, originOk, { ...vp, signedIn }));
    }
    for (const vp of [desktop, mobile]) await step(`${vp.name} not_configured`, () => runNotConfigured(browser, originOff, vp));
    await step('nav', () => runNav(browser, originOk));
    await step('long content', () => runLongContent(browser, originOk));
    check('not_configured mode made no upstream call', offUpstreamCalls === 0, offUpstreamCalls);
  } finally {
    await browser.close();
    for (const s of servers) s.close();
  }

  check('upstream: every call went to an official BestChange API host with the fake key (injected fetch, no network)',
    upstreamCalls.length > 0 && upstreamCalls.every((c) => c.keyOk && /^(mirror[1-4]\.)?bestchange\.app$/.test(c.host)), upstreamCalls.length);
  const ratesCalls = upstreamCalls.filter((c) => c.path.includes('/rates/'));
  const pairsPerCall = ratesCalls.map((c) => c.path.split('/rates/')[1].split('+').length);
  // 8 RUB methods (7 fixed + «Озон Банк RUB») × all catalogue pairs in ONE batched request per snapshot.
  check(`upstream: each rates request is one batch of 8 × ${RECEIVE_PAIRS.length} pairs`, ratesCalls.length >= 1 && pairsPerCall.every((n) => n === 8 * RECEIVE_PAIRS.length), { ratesCalls: ratesCalls.length, pairsPerCall });
  check('no API response body carried the key or an upstream URL', report.keyLeaks.length === 0, report.keyLeaks);
  const external = report.denied.filter((d) => d.url && !d.url.startsWith('https://fonts.'));
  check('browser made no request outside 127.0.0.1 (except the fixture-served Google Fonts CSS)', external.length === 0, external);
  check('no unexpected /api read hit the fixture server', apiMisses.length === 0, apiMisses);

  report.finishedAt = new Date().toISOString();
  report.summary = { pass: report.checks.filter((c) => c.result === 'PASS').length, fail: report.checks.filter((c) => c.result === 'FAIL').length };
  report.result = report.summary.fail === 0 ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.result}: ${report.summary.pass} passed, ${report.summary.fail} failed → ${path.relative(repo, path.join(out, 'report.json'))}`);
  if (report.result !== 'PASS') process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
