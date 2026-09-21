'use strict';
/**
 * COPY TRADING — NAZAR AND KSENIA MUST NEVER SIT IN «Загрузка…», IN A BROWSER.
 *
 * `copyTradingCriticalPath.test.ts` proves the rule against the store. This
 * proves it against the thing the owner actually looks at: the production
 * bundle, in Chromium, against the ACTUAL compiled marketplace router,
 * CopyPerformanceService, redactTradeHistory and requireAuth, with an
 * in-memory database only — no DATABASE_URL, no production secret, no writes,
 * and no relaxed auth.
 *
 * The nine situations, each checked on BOTH cards:
 *   1  cold load, empty storage
 *   2  hard reload
 *   3  leave the route and come back
 *   4  browser focus / tab return
 *   5  the token arrives after the page has painted
 *   6  a nav-hover prefetch that FAILS, then an immediate visit
 *   7  the request times out (the client abandons at 15s)
 *   8  the server answers 500
 *   9  offline, then online again
 *  10  another tab logs in as a different account, and this tab learns of it
 *      only through its next render — the production shape of the hang
 *
 * The verdict for each is the same and is not about pixels: within the
 * client's own timeout the card must show REAL FIGURES, or last-good figures
 * flagged stale, or an honest unavailable state. What it may never be is a
 * skeleton with nothing on the wire behind it.
 *
 * Build first: `npm run build` and `npm --prefix frontend run build`.
 * Evidence: docs/qa/copy-never-loading/.
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
const { requireAuth } = require('../dist/api/middleware/auth');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-never-loading');
fs.mkdirSync(OUT, { recursive: true });
const DATE = process.env.QA_COPY_DATE || new Date().toISOString().slice(0, 10);
const WIDTHS = (process.env.QA_WIDTHS || '1440,390').split(',').map(Number);
/** The client abandons at 15s. Anything still a skeleton after that plus a
 *  margin for the settle and repaint is the bug this file exists for. */
const VERDICT_BUDGET_MS = 21_000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), date: DATE,
  environment: 'LOCAL QA ONLY — real compiled router/service, in-memory persistence, real auth',
  budgetMs: VERDICT_BUDGET_MS, widths: {}, findings: [] };

function localDatabase() {
  const scenarios = new Map(), sessions = new Map();
  const identities = new Map([
    ['VX-001', { publicName: 'Nazar', ownerUserId: 'qa-nazar-owner', premium: true }],
    ['VX-KSENIA', { publicName: 'Ksenia', ownerUserId: 'qa-ksenia-owner', premium: true }],
  ]);
  const owners = new Map([
    ['qa-nazar-owner', { avatarUrl: null, kycStatus: 'NOT_STARTED' }],
    ['qa-ksenia-owner', { avatarUrl: null, kycStatus: 'NOT_STARTED' }],
  ]);
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
    copyStrategyOwner: { async findUnique({ where }) { return identities.get(where.traderId) || null; } },
    user: { async findUnique({ where }) { return owners.get(where.id) || null; } },
    session: {
      async findUnique({ where }) { return sessions.get(where.id) || null; },
      async update({ where, data }) { Object.assign(sessions.get(where.id), data); return sessions.get(where.id); },
    },
  };
  let count = 0;
  const account = () => {
    const id = `qa-viewer-${++count}`, sid = `qa-session-${count}`;
    sessions.set(sid, { id: sid, userId: id, revokedAt: null, lastSeenAt: new Date() });
    return { id, sid, token: jwt.sign({ sub: id, sid }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  };
  return { db, account };
}

/**
 * WHAT EACH CARD IS ACTUALLY SAYING.
 *
 * `busy` is the skeleton: the Copy button still reading «Загрузка…» with
 * `aria-busy`. `roi` and `chart` are the real content. `unavailable` is the
 * honest verdict. A card is ANSWERED when it shows content or a verdict; it
 * is HUNG when it shows neither.
 */
const FACTS = () => {
  const read = id => {
    const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
    if (!card) return { present: false };
    const button = card.querySelector('.button-copy');
    const label = (button?.textContent || '').trim();
    const roiNode = card.querySelector('.card-roi-copy strong');
    const roi = (roiNode?.textContent || '').replace(/\s+/g, ' ').trim();
    const text = card.textContent || '';
    return {
      present: true,
      busy: button?.getAttribute('aria-busy') === 'true' || /Загрузка/.test(label),
      unavailable: /Данные недоступны/.test(text),
      chart: !!card.querySelector('.mini-chart-line'),
      roi, buttonLabel: label,
      hasRealNumber: /[0-9]/.test(roi) && !/NaN/.test(roi),
    };
  };
  const banner = document.querySelector('.marketplace-freshness');
  return {
    nazar: read('VX-001'), ksenia: read('VX-KSENIA'),
    freshness: (banner?.textContent || '').trim(),
    demoCardCount: document.querySelectorAll('.trader-card[data-trader-id]').length,
    hasNaN: /NaN/.test(document.body.textContent || ''),
  };
};

/** The one verdict this file exists to pass or fail. */
function judge(scenario, width, facts) {
  const problems = [];
  for (const who of ['nazar', 'ksenia']) {
    const card = facts[who];
    if (!card.present) { problems.push(`${scenario} @${width}: ${who} card is not on the page at all`); continue; }
    const answered = card.hasRealNumber || card.unavailable;
    if (card.busy || !answered) {
      problems.push(`${scenario} @${width}: ${who} is still «Загрузка…» after ${VERDICT_BUDGET_MS}ms `
        + `(busy=${card.busy} roi=${JSON.stringify(card.roi)} unavailable=${card.unavailable})`);
    }
    // Invariant 8: an unknown must read as unavailable, never as a made-up 0.
    if (card.hasRealNumber && /^[+-]?0([.,]0+)?%?$/.test(card.roi) && !card.chart) {
      problems.push(`${scenario} @${width}: ${who} shows a bare zero with no data behind it — ${card.roi}`);
    }
  }
  if (facts.hasNaN) problems.push(`${scenario} @${width}: NaN is rendered somewhere on the page`);
  report.findings.push(...problems);
  return problems;
}

let server, browser, failed = false;
(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('frontend/dist is missing; build the frontend first');
  const fixture = localDatabase();
  const viewer = fixture.account();
  const service = new CopyPerformanceService(fixture.db, () => new Date(`${DATE}T12:00:00Z`));

  const app = express();
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'Local QA is read-only' });
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use('/api/v1', copyPerformanceRouter(fixture.db, service));
  const auth = requireAuth(fixture.db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa-fixture@example.invalid',
    displayName: 'Local QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: `${DATE}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_q, r) => r.json({ points: [{ date: DATE, totalValueUsd: '0' }] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_q, r) => r.json([]));
  app.get('/api/v1/support/conversations/mine', auth, (_q, r) => r.json({ conversation: null }));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (req, res) => res.status(404).json({ error: 'Unrelated endpoint', path: req.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Warm the service once, outside the measurements: the first generation of
  // a real 400-day history is a one-off cost of an empty scenario table, not
  // something a viewer meets, and it would otherwise dominate scenario 1.
  await service.get('nazar'); await service.get('ksenia');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const width of WIDTHS) {
    const view = report.widths[width] = { pageErrors: [], scenarios: {} };
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(() => { try { localStorage.setItem('exchange_lang', 'ru'); } catch {} });
    const page = await context.newPage();
    page.on('pageerror', e => view.pageErrors.push(String(e)));

    /** Fault injection that survives a reload, unlike a per-call route. */
    let mode = 'ok';
    await page.route('**/api/v1/copy-trading/marketplace**', async route => {
      if (mode === 'ok') return route.continue();
      if (mode === '500') return route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal' }) });
      if (mode === 'offline') return route.abort('internetdisconnected');
      if (mode === 'hang') { await wait(VERDICT_BUDGET_MS + 4_000); return route.abort('timedout'); }
      return route.continue();
    });
    const plant = token => context.addInitScript(t => { try { localStorage.setItem('exchange_token', t); } catch {} }, token);

    /** Settle, then read, then judge. Never judged before the budget is up:
     *  a skeleton while a request is genuinely in flight is correct. */
    const check = async (name, { budget = VERDICT_BUDGET_MS, shot = true } = {}) => {
      const started = Date.now();
      await page.waitForFunction(() => {
        const answered = id => {
          const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
          if (!card) return false;
          const button = card.querySelector('.button-copy');
          const busy = button?.getAttribute('aria-busy') === 'true' || /Загрузка/.test(button?.textContent || '');
          return !busy;
        };
        return answered('VX-001') && answered('VX-KSENIA');
      }, null, { timeout: budget }).catch(() => {});
      await wait(400);
      const facts = await page.evaluate(FACTS);
      const problems = judge(name, width, facts);
      view.scenarios[name] = { ms: Date.now() - started, ...facts, problems };
      if (problems.length) failed = true;
      if (shot) await page.screenshot({ path: path.join(OUT, `w${width}-${name}.png`) }).catch(() => {});
      return facts;
    };

    // ── 5. the token arrives AFTER the page has painted ───────────────
    // Done first, while storage is still empty, so nothing can be mistaken
    // for a cached answer.
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await wait(1_200);
    view.scenarios['05a-no-token-yet'] = await page.evaluate(FACTS);
    await page.evaluate(t => localStorage.setItem('exchange_token', t), viewer.token);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await plant(viewer.token);
    await check('05-token-arrives-late');

    // ── 1. cold load ─────────────────────────────────────────────────
    await context.clearCookies();
    await page.evaluate(() => { try { localStorage.removeItem('voltex.copy.marketplace.v1'); } catch {} });
    await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('voltex.copy'))
      .forEach(k => localStorage.removeItem(k)));
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await check('01-cold-load');

    // ── 2. hard reload ───────────────────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await check('02-hard-reload');

    // ── 3. leave the route and come back ─────────────────────────────
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await wait(700);
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await check('03-route-return');

    // ── 4. tab return / window focus ─────────────────────────────────
    const blurred = await context.newPage();
    await blurred.goto('about:blank'); await wait(600);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await blurred.close();
    await check('04-focus-refresh');

    // ── 6. a nav-hover prefetch that FAILS, then an immediate visit ───
    // The exact shape of the incident: the hover's request dies, the user
    // clicks through inside the thirty-second throttle window, and the page
    // must still put a real request on the wire.
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    mode = 'offline';
    const link = page.locator('a[href="/copy-trading"]').first();
    await link.hover({ timeout: 5_000 }).catch(() => {});
    await wait(1_200);
    mode = 'ok';
    let marketplaceCalls = 0;
    const count = () => { marketplaceCalls++; };
    page.on('request', r => { if (/copy-trading\/marketplace/.test(r.url())) count(); });
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    const afterPrefetch = await check('06-failed-prefetch-then-visit');
    view.scenarios['06-failed-prefetch-then-visit'].marketplaceRequestsAfterFailedPrefetch = marketplaceCalls;
    if (marketplaceCalls === 0) {
      report.findings.push(`06 @${width}: the visit after a failed prefetch put NO request on the wire`);
      failed = true;
    }
    if (!afterPrefetch.nazar.hasRealNumber || !afterPrefetch.ksenia.hasRealNumber) {
      report.findings.push(`06 @${width}: a failed prefetch left a card without figures`);
      failed = true;
    }

    // ── 7. the request times out ─────────────────────────────────────
    // Storage now holds a validated snapshot, so the honest outcome is
    // last-good figures flagged stale — never a skeleton, never a blank.
    mode = 'hang';
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    const timedOut = await check('07-request-timeout', { budget: VERDICT_BUDGET_MS });
    if (!timedOut.nazar.hasRealNumber && !timedOut.nazar.unavailable) {
      report.findings.push(`07 @${width}: Nazar showed neither last-good figures nor a verdict`);
      failed = true;
    }

    // ── 8. the server answers 500 ────────────────────────────────────
    mode = '500';
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await check('08-server-500');

    // ── 9. offline, then online again ────────────────────────────────
    mode = 'offline';
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await check('09a-offline');
    mode = 'ok';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await wait(2_500);
    const back = await page.evaluate(FACTS);
    view.scenarios['09b-back-online'] = back;
    if (judge('09b-back-online', width, back).length) failed = true;

    // ── 10. another tab logs in ──────────────────────────────────────
    // `onSessionChange` is an in-memory list, so it fires only in the tab
    // that called setToken. THIS tab shares the same localStorage and learns
    // of the change from `checkSession()` inside `getState()` — the function
    // React calls as its snapshot getter. Until that path settled or asked,
    // both cards fell back to «Загрузка…» and stayed there, while every demo
    // trader beside them, needing no request at all, rendered normally.
    mode = 'ok';
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await check('10a-before-other-tab', { shot: false });
    const otherTab = await context.newPage();          // same origin, same storage
    await otherTab.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await otherTab.evaluate(t => localStorage.setItem('exchange_token', t), fixture.account().token);
    await otherTab.close();
    // Nothing told this tab. A render is all it gets — a keystroke in the
    // marketplace search box is the most ordinary one there is.
    // Nothing told this tab. All it gets is a render of the PAGE — and
    // opening a trader's profile and coming back is the most ordinary way a
    // viewer causes one, because `view` state lives on CopyTradingPage.
    await page.locator('.trader-card[data-trader-id="VX-001"] .card-view-button')
      .first().click({ timeout: 8_000 }).catch(() => {});
    await wait(700);
    await page.locator('.profile-back, .trader-profile-page button').first()
      .click({ timeout: 8_000 }).catch(() => {});
    await wait(900);
    await check('10-other-tab-logged-in');

    if (view.pageErrors.length) {
      report.findings.push(`@${width}: ${view.pageErrors.length} uncaught page error(s): `
        + view.pageErrors.slice(0, 3).join(' | '));
      failed = true;
    }
    await context.close();
  }

  report.status = failed ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings: report.findings,
    perWidth: Object.fromEntries(Object.entries(report.widths).map(([w, v]) =>
      [w, Object.fromEntries(Object.entries(v.scenarios).map(([k, s]) =>
        [k, { nazar: s.nazar?.roi ?? s.nazar?.buttonLabel, ksenia: s.ksenia?.roi ?? s.ksenia?.buttonLabel,
          busy: [s.nazar?.busy, s.ksenia?.busy], ms: s.ms }]))])) }, null, 2));
})().catch(error => { console.error(error); failed = true; })
  .finally(async () => {
    await browser?.close().catch(() => {});
    server?.close();
    process.exit(failed ? 1 : 0);
  });
