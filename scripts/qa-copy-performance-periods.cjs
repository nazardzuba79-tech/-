'use strict';
/** Copy Trading — first paint on a slow new day, and «Эффективность» per period.
 *
 * Drives the production frontend bundle in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService, MarketplaceSnapshots
 * and requireAuth, with an in-memory scenario table (no DATABASE_URL, no
 * production secret, no writes anywhere else). LOCAL QA ONLY.
 *
 * What it proves, on desktop 1440x900 and mobile 390x844:
 *   A  both featured cards hydrate with real figures; each profile's
 *      «Эффективность» shows the SELECTED period's own figures for 7Д, 30Д,
 *      90Д and Всё время, with Russian labels (ROI, P&L and USDT kept) and
 *      numbers that do not change when the language does;
 *   B  a new UTC day whose append takes 45 s — production logged 42.29 s on
 *      2026-09-28 — still paints both cards within seconds, with the last
 *      confirmed day, and the next refresh after the append carries the new
 *      day;
 *   C  a marketplace that answers 503, and D one that never answers: once
 *      the attempt is over, no skeleton remains — an honest «—» and
 *      «Данные недоступны», never an eternal «Загрузка…».
 *
 * Build first: `npm run build` and `npm --prefix frontend run build`.
 * Evidence: docs/qa/copy-performance-periods/.
 */
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const { MarketplaceSnapshots } = require('../dist/services/copyTrading/marketplaceSnapshot');
const { requireAuth } = require('../dist/api/middleware/auth');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-performance-periods');
fs.mkdirSync(OUT, { recursive: true });
const DAY_N = process.env.QA_COPY_DATE || '2026-09-28';
const DAY_N1 = new Date(Date.parse(`${DAY_N}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const SLOW_APPEND_MS = Number(process.env.QA_SLOW_APPEND_MS || 45_000);
const VIEWPORTS = [{ tag: 'desktop', width: 1440, height: 900 }, { tag: 'mobile', width: 390, height: 844 }];
const STRATEGIES = [{ key: 'nazar', id: 'VX-001', name: 'Nazar' }, { key: 'ksenia', id: 'VX-KSENIA', name: 'Ksenia' }];
const PERIODS = ['7D', '30D', '90D', 'ALL'];
const RU_LABELS = ['ROI', 'P&L мастера', 'P&L подписчиков', '% успешных сделок', 'Макс. просадка', 'Сред. P&L',
  'Коэффициент P/L', 'Сред. сделок в неделю', 'Сред. время удержания', 'Волатильность ROI', 'Коэффициент Шарпа',
  'Коэффициент Сортино', 'Посл. сделка', 'Всего сделок', 'С прибылью', 'С убытком'];
const ENGLISH = /\b(Win|Rate|Drawdown|Average|Avg|Profit|Factor|Weekly|Trades?|Holding|Volatility|Sharpe|Sortino|Total|Winning|Losing|Performance|Rolling|Window|Since|Inception|Last|Units|Master|Followers)\b/;

const report = { startedAt: new Date().toISOString(), days: { n: DAY_N, n1: DAY_N1 }, slowAppendMs: SLOW_APPEND_MS,
  environment: 'LOCAL QA ONLY — real compiled router/service/snapshots, in-memory persistence',
  marketplace: {}, profiles: {}, language: {}, slowDay: {}, failure: {}, timeout: {}, findings: [] };
const finding = text => { report.findings.push(text); console.error('FINDING', text); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function localDatabase() {
  const scenarios = new Map(), sessions = new Map();
  const db = {
    copyPerformanceScenario: {
      async findUnique({ where }) { const row = scenarios.get(where.id); return row ? { ...row } : null; },
      async create({ data }) {
        if (scenarios.has(data.id)) throw Object.assign(new Error('Unique scenario'), { code: 'P2002' });
        const row = { ...data, revision: 0 }; scenarios.set(data.id, row); return { ...row };
      },
      async updateMany({ where, data }) {
        const row = scenarios.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        scenarios.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 };
      },
    },
    copyStrategyOwner: { async findUnique({ where }) {
      return { traderId: where.traderId, publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia', ownerUserId: null, premium: true };
    } },
    user: { async findUnique() { return null; } },
    session: {
      async findUnique({ where }) { return sessions.get(where.id) || null; },
      async update({ where, data }) { Object.assign(sessions.get(where.id), data); return sessions.get(where.id); },
    },
  };
  let count = 0;
  const account = () => {
    const id = `qa-viewer-${++count}`, sid = `qa-session-${count}`;
    sessions.set(sid, { id: sid, userId: id, revokedAt: null, lastSeenAt: new Date() });
    return jwt.sign({ sub: id, sid }, process.env.JWT_SECRET, { expiresIn: '2h' });
  };
  return { db, account };
}

/** One API process. `mode` replaces the marketplace for the failure cases. */
async function startServer(db, day, { slowFromDay = null, mode = 'normal' } = {}) {
  const clock = { day };
  const now = () => new Date(`${clock.day}T12:00:00Z`);
  const service = new CopyPerformanceService(db, now);
  if (slowFromDay) {
    const real = service.get.bind(service);
    service.get = async strategy => { if (clock.day >= slowFromDay) await wait(SLOW_APPEND_MS); return real(strategy); };
  }
  const snapshots = new MarketplaceSnapshots(db, service, { now, build: null });
  const app = express();
  app.use((_q, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  if (mode === 'error') app.get('/api/v1/copy-trading/marketplace', (_q, res) => res.status(503).json({ error: 'unavailable' }));
  if (mode === 'hang') app.get('/api/v1/copy-trading/marketplace', () => {});
  app.use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const auth = requireAuth(db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa@example.invalid', displayName: 'QA',
    avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: `${DAY_N}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_q, res) => res.json({ points: [] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_q, res) => res.json([]));
  app.get('/api/v1/market/external/tickers', (_q, res) => res.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (req, res) => res.status(404).json({ error: 'unrelated', path: req.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { clock, service, snapshots, server, origin: `http://127.0.0.1:${server.address().port}` };
}

const readCard = id => {
  const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
  if (!card) return null;
  const roi = card.querySelector('.card-roi-copy strong');
  return {
    roi: roi ? roi.textContent.replace(/\s+/g, ' ').trim() : null,
    hydrated: !!roi && !roi.querySelector('[data-unavailable]'),
    skeletons: card.querySelectorAll('.copy-metric-skeleton').length,
    unavailable: card.querySelectorAll('[data-unavailable]').length,
    loadingText: card.textContent.includes('Загрузка…'),
    unavailableText: card.textContent.includes('Данные недоступны'),
    dash: card.textContent.includes('—'),
  };
};
const readPanel = () => {
  const node = document.querySelector('.profile-metrics-panel');
  if (!node) return null;
  const rows = [...node.querySelectorAll('[data-metric]')].map(row => ({ id: row.getAttribute('data-metric'),
    label: row.querySelector('span').textContent.trim(), value: row.querySelector('strong').textContent.replace(/\s+/g, ' ').trim() }));
  return { period: node.getAttribute('data-period'), heading: node.querySelector('h2')?.textContent.trim(),
    window: node.querySelector('.profile-panel-heading span')?.textContent.trim(),
    units: node.querySelector('.profile-metrics-units')?.textContent.trim(), rows,
    skeletons: node.querySelectorAll('.copy-metric-skeleton').length,
    buttons: [...document.querySelectorAll('.profile-periods button')].map(b => b.textContent.trim()),
    range: document.querySelector('.profile-period-range')?.textContent.replace(/\s+/g, ' ').trim() ?? null };
};

async function newPage(browser, viewport, token, lang = 'ru') {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  await context.addInitScript(([t, l]) => { try { localStorage.setItem('exchange_token', t); localStorage.setItem('exchange_lang', l); } catch {} }, [token, lang]);
  const page = await context.newPage();
  page.qaErrors = [];
  page.on('pageerror', error => page.qaErrors.push(String(error && error.message)));
  return { context, page };
}
async function waitHydrated(page, timeout = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const both = await page.evaluate(readCard => ['VX-001', 'VX-KSENIA'].map(id => eval(`(${readCard})`)(id)), readCard.toString());
    if (both.every(card => card && card.hydrated)) return Date.now() - started;
    await wait(100);
  }
  return null;
}
/** Bring the two featured cards into the frame before a screenshot. */
const showCards = page => page.evaluate(() => document.querySelector('.trader-card[data-trader-id="VX-001"]')
  ?.scrollIntoView({ block: 'start' })).then(() => wait(300));
const cards = page => page.evaluate(source => Object.fromEntries(['VX-001', 'VX-KSENIA']
  .map(id => [id, eval(`(${source})`)(id)])), readCard.toString());
const panel = page => page.evaluate(source => eval(`(${source})`)(), readPanel.toString());
async function openProfile(page, strategy) {
  await page.click(`.trader-card[data-trader-id="${strategy.id}"] .card-view-button`);
  await page.waitForSelector('.profile-metrics-panel', { timeout: 20_000 });
}
async function choose(page, period) {
  await page.click(`.profile-periods [data-period="${period}"]`);
  await page.waitForFunction(p => document.querySelector('.profile-metrics-panel')?.getAttribute('data-period') === p, period, { timeout: 5_000 });
  await wait(250);
}

function judgePanel(tag, view, period) {
  if (!view) return finding(`${tag}: no «Эффективность» panel`);
  if (view.period !== period) finding(`${tag}: panel shows ${view.period}, not ${period}`);
  if (view.heading !== 'Эффективность') finding(`${tag}: heading reads ${JSON.stringify(view.heading)}`);
  if (JSON.stringify(view.rows.map(r => r.label)) !== JSON.stringify(RU_LABELS)) finding(`${tag}: labels ${JSON.stringify(view.rows.map(r => r.label))}`);
  if (view.units !== 'Единицы измерения: USDT') finding(`${tag}: units ${JSON.stringify(view.units)}`);
  const words = [view.heading, view.window, view.units, ...view.rows.map(r => r.label)].join(' ').replace(/ROI|P&L|P\/L|USDT/g, '');
  if (ENGLISH.test(words)) finding(`${tag}: English wording in the Russian block — ${words.match(ENGLISH)[0]}`);
  if (view.skeletons) finding(`${tag}: ${view.skeletons} skeleton(s) in a hydrated panel`);
  if (view.rows.some(r => /NaN|undefined/.test(r.value))) finding(`${tag}: NaN/undefined in a value`);
  if (JSON.stringify(view.buttons) !== JSON.stringify(['7 д.', '30 д.', '90 д.', 'Всё время'])) finding(`${tag}: period buttons ${JSON.stringify(view.buttons)}`);
}

(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('Build the frontend first'); process.exit(2); }
  const { db, account } = localDatabase();
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const token = account();
  const servers = [];
  try {
    // ── A. Day N: hydrated cards, every period of both profiles ─────────
    const dayN = await startServer(db, DAY_N); servers.push(dayN);
    for (const viewport of VIEWPORTS) {
      const { context, page } = await newPage(browser, viewport, token);
      await page.goto(`${dayN.origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      const ms = await waitHydrated(page);
      report.marketplace[viewport.tag] = { hydratedMs: ms, cards: await cards(page) };
      if (ms === null) finding(`${viewport.tag}: featured cards never hydrated`);
      await showCards(page);
      await page.screenshot({ path: path.join(OUT, `${viewport.tag}-01-marketplace-hydrated.png`) });
      for (const strategy of STRATEGIES) {
        await openProfile(page, strategy);
        report.profiles[`${viewport.tag}/${strategy.key}`] = {};
        for (const period of PERIODS) {
          await choose(page, period);
          const view = await panel(page);
          report.profiles[`${viewport.tag}/${strategy.key}`][period] = view;
          judgePanel(`${viewport.tag} ${strategy.name} ${period}`, view, period);
          await page.locator('.profile-metrics-panel').screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-${period}-effectiveness.png`) });
          if (viewport.tag === 'desktop') await page.screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-${period}-profile.png`) });
        }
        const byPeriod = report.profiles[`${viewport.tag}/${strategy.key}`];
        for (const metric of ['roi', 'masterPnl', 'followersPnl', 'totalTrades']) {
          const values = PERIODS.map(p => byPeriod[p].rows.find(r => r.id === metric)?.value);
          if (new Set(values).size !== 4) finding(`${viewport.tag} ${strategy.name}: ${metric} does not differ across periods — ${JSON.stringify(values)}`);
        }
        await page.click('.back-button');
        await page.waitForSelector('.trader-card', { timeout: 10_000 });
      }
      if (page.qaErrors.length) finding(`${viewport.tag}: page errors ${page.qaErrors.join(' | ')}`);
      await context.close();
    }

    // Language: English words, identical figures, no extra request.
    {
      const { context, page } = await newPage(browser, VIEWPORTS[0], token, 'en');
      let marketplaceRequests = 0;
      page.on('request', r => { if (r.url().includes('/copy-trading/marketplace')) marketplaceRequests++; });
      await page.goto(`${dayN.origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await waitHydrated(page);
      await openProfile(page, STRATEGIES[0]);
      await choose(page, '30D');
      const english = await panel(page);
      await page.locator('.profile-metrics-panel').screenshot({ path: path.join(OUT, 'desktop-nazar-30D-effectiveness-en.png') });
      const russian = report.profiles['desktop/nazar']['30D'];
      const figures = v => v.replace(/[^\d,.+\-−∞—%]/g, '');
      const same = english.rows.every((row, i) => figures(row.value) === figures(russian.rows[i].value));
      report.language = { english: english.rows.map(r => [r.label, r.value]), figuresIdentical: same, marketplaceRequests };
      if (!same) finding('switching to English changed a figure');
      if (english.heading !== 'Performance') finding(`English heading ${english.heading}`);
      await context.close();
    }

    // ── B. A new UTC day whose append takes SLOW_APPEND_MS ──────────────
    // A fresh process (a deploy, a restart) over the same table: no
    // measurement yet, so the confirmed day answers at once.
    dayN.server.close();
    const dayN1 = await startServer(db, DAY_N1, { slowFromDay: DAY_N1 }); servers.push(dayN1);
    {
      const { context, page } = await newPage(browser, VIEWPORTS[0], token);
      const started = Date.now();
      await page.goto(`${dayN1.origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      const ms = await waitHydrated(page, 14_000);
      const timing = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(e => e.name.includes('/copy-trading/marketplace')).map(e => Math.round(e.duration)));
      report.slowDay.firstPaint = { hydratedMs: ms, marketplaceRequestMs: timing, cards: await cards(page), pageLoadToHydratedMs: Date.now() - started };
      if (ms === null || ms > 5_000) finding(`slow day: cards hydrated after ${ms} ms (must be a few seconds, not the ${SLOW_APPEND_MS} ms append)`);
      await showCards(page);
      await page.screenshot({ path: path.join(OUT, 'desktop-02-slow-new-day-first-paint.png') });
      await openProfile(page, STRATEGIES[0]);
      await choose(page, '7D');
      report.slowDay.firstPaint.nazarRange = (await panel(page)).range;
      await page.click('.back-button');
      // The append finishes behind the answer; the next refresh carries it.
      await wait(SLOW_APPEND_MS * 2 + 15_000);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await wait(3_000);
      await openProfile(page, STRATEGIES[0]);
      await choose(page, '7D');
      const after = await panel(page);
      report.slowDay.afterRefresh = { nazarRange: after.range, cards: await cards(page) };
      if (!after.range || !after.range.includes(DAY_N1.split('-').reverse().join('.'))) finding(`slow day: the new day never arrived — range ${after.range}`);
      await page.screenshot({ path: path.join(OUT, 'desktop-03-slow-new-day-after-refresh.png') });
      await context.close();
    }
    dayN1.server.close();

    // ── C. The marketplace answers 503 ──────────────────────────────────
    const failing = await startServer(db, DAY_N, { mode: 'error' }); servers.push(failing);
    for (const viewport of VIEWPORTS) {
      const { context, page } = await newPage(browser, viewport, token);
      await page.goto(`${failing.origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await wait(3_500);
      const state = await cards(page);
      report.failure[viewport.tag] = state;
      for (const [id, card] of Object.entries(state)) {
        if (!card) { finding(`503 ${viewport.tag}: ${id} card missing`); continue; }
        if (card.skeletons) finding(`503 ${viewport.tag}: ${id} still shows ${card.skeletons} skeleton(s) after the attempt ended`);
        if (card.loadingText) finding(`503 ${viewport.tag}: ${id} still reads «Загрузка…»`);
        if (!card.unavailableText || !card.dash) finding(`503 ${viewport.tag}: ${id} is not an honest «—» / «Данные недоступны»`);
      }
      await showCards(page);
      await page.screenshot({ path: path.join(OUT, `${viewport.tag}-04-server-error-honest-unavailable.png`) });
      await context.close();
    }
    failing.server.close();

    // ── D. The marketplace never answers: the client's 15 s abort ───────
    const hanging = await startServer(db, DAY_N, { mode: 'hang' }); servers.push(hanging);
    {
      const { context, page } = await newPage(browser, VIEWPORTS[0], token);
      await page.goto(`${hanging.origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await wait(2_000);
      report.timeout.inFlight = await cards(page);
      await wait(16_000);
      const state = await cards(page);
      report.timeout.afterAbort = state;
      for (const [id, card] of Object.entries(state)) {
        if (!card || card.skeletons || card.loadingText || !card.unavailableText) finding(`timeout: ${id} after the 15 s abort — ${JSON.stringify(card)}`);
      }
      for (const [id, card] of Object.entries(report.timeout.inFlight)) {
        if (!card || !card.skeletons || !card.loadingText) finding(`timeout: ${id} in flight should reserve skeletons and read «Загрузка…» — ${JSON.stringify(card)}`);
      }
      await showCards(page);
      await page.screenshot({ path: path.join(OUT, 'desktop-05-timeout-honest-unavailable.png') });
      await context.close();
    }
  } catch (error) {
    finding(`harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    await browser.close();
    for (const s of servers) { try { s.server.close(); } catch {} }
  }
  report.status = report.findings.length ? 'FAIL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings: report.findings, marketplace: report.marketplace,
    slowDay: report.slowDay, language: report.language.figuresIdentical }, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 1);
})();
