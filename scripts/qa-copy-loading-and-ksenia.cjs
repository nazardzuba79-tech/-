'use strict';
/** Copy Trading: nothing hangs in «Загрузка…», and Ksenia shows 61.9%.
 *
 * Production-like: drives the built frontend in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService, redactTradeHistory,
 * withKseniaReportedWeek and requireAuth, on an in-memory database. No
 * DATABASE_URL, no production secret, no writes.
 *
 * Scenarios, all from the brief:
 *   cold load · hard reload · failed prefetch → mount · route leave/return ·
 *   authenticated session · timeout · failure · token arriving after mount ·
 *   both cards visible when a valid response exists.
 *
 * The rule under test is one sentence: a card is either showing confirmed
 * figures, or it is showing an honest unavailable state. It is never left
 * saying «Загрузка…» with nothing in flight.
 */
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
delete process.env.DATABASE_URL; delete process.env.DIRECT_URL;
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const { requireAuth } = require('../dist/api/middleware/auth');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-loading-ksenia');
fs.mkdirSync(OUT, { recursive: true });
const DATE = process.env.QA_COPY_DATE || '2026-09-19';
const report = { startedAt: new Date().toISOString(), date: DATE,
  environment: 'LOCAL QA ONLY — real compiled router/service, in-memory persistence',
  scenarios: {}, findings: [] };
const finding = t => report.findings.push(t);
const wait = ms => new Promise(r => setTimeout(r, ms));

function db() {
  const scenarios = new Map(), sessions = new Map();
  const identities = new Map([
    ['VX-001', { publicName: 'Nazar', ownerUserId: 'o1', premium: true }],
    ['VX-KSENIA', { publicName: 'Ksenia', ownerUserId: 'o2', premium: true }]]);
  const owners = new Map([['o1', { avatarUrl: null, kycStatus: 'NOT_STARTED' }],
    ['o2', { avatarUrl: null, kycStatus: 'NOT_STARTED' }]]);
  const handle = {
    copyPerformanceScenario: {
      async findUnique({ where }) { const r = scenarios.get(where.id); return r ? { ...r } : null; },
      async create({ data }) {
        if (scenarios.has(data.id)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const row = { ...data, revision: 0 }; scenarios.set(data.id, row); return { ...row }; },
      async updateMany({ where, data }) {
        const row = scenarios.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        scenarios.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 }; } },
    copyStrategyOwner: { async findUnique({ where }) { return identities.get(where.traderId) || null; } },
    user: { async findUnique({ where }) { return owners.get(where.id) || null; } },
    session: { async findUnique({ where }) { return sessions.get(where.id) || null; },
      async update({ where, data }) { Object.assign(sessions.get(where.id), data); return sessions.get(where.id); } },
  };
  let n = 0;
  const account = () => { const id = `u${++n}`, sid = `s${n}`;
    sessions.set(sid, { id: sid, userId: id, revokedAt: null, lastSeenAt: new Date() });
    return { id, sid, token: jwt.sign({ sub: id, sid }, process.env.JWT_SECRET, { expiresIn: '1h' }) }; };
  return { handle, account };
}

/** What the viewer actually reads off a featured card. */
const cardFacts = id => {
  const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
  if (!card) return null;
  const txt = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const stat = l => txt([...card.querySelectorAll('.card-stats > div')]
    .find(d => d.textContent.includes(l))?.querySelector('strong'));
  return {
    name: txt(card.querySelector('h3')),
    roi: txt(card.querySelector('.card-roi-copy strong')),
    winRate: stat('Win Rate'),
    button: txt(card.querySelector('.button-copy')),
    loading: card.textContent.includes('Загрузка…'),
    unavailable: card.textContent.includes('Данные недоступны'),
    skeletons: card.querySelectorAll('.copy-chart-skeleton, .copy-metric-skeleton').length,
    chart: !!card.querySelector('.mini-chart-line'),
  };
};
const FACTS = `(() => ({ nazar: (${cardFacts})('VX-001'), ksenia: (${cardFacts})('VX-KSENIA') }))()`;
const known = v => typeof v === 'string' && v.length > 0 && !v.includes('—');
/** Showing real figures. */
const live = f => !!f && known(f.roi) && f.chart && !f.loading && !f.unavailable;
/** A verdict of ANY kind — the thing that must always be reached. */
const decided = f => !!f && !f.loading;

let server, browser;
(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('build the frontend first');
  const fixture = db();
  const userA = fixture.account(), userB = fixture.account();
  const service = new CopyPerformanceService(fixture.handle, () => new Date(`${DATE}T12:00:00Z`));
  const app = express();
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'read-only' });
    res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/v1', copyPerformanceRouter(fixture.handle, service));
  const auth = requireAuth(fixture.handle);
  app.get('/api/v1/me', auth, (q, r) => r.json({ id: q.userId, email: 'qa@example.invalid',
    displayName: 'QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: `${DATE}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_q, r) => r.json({ points: [{ date: DATE, totalValueUsd: '0' }] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_q, r) => r.json([]));
  app.get('/api/v1/support/conversations/mine', auth, (_q, r) => r.json({ conversation: null }));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (q, r) => r.status(404).json({ error: 'unrelated', path: q.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const context = async (token, width = 1440) => {
    const c = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    if (token) await c.addInitScript(t => { try { localStorage.setItem('exchange_token', t); } catch {} ;
      try { localStorage.setItem('exchange_lang', 'ru'); } catch {} }, token);
    else await c.addInitScript(() => { try { localStorage.setItem('exchange_lang', 'ru'); } catch {} });
    return c;
  };
  const errorsOf = page => { const e = []; page.on('pageerror', x => e.push(String(x))); return e; };

  // ── 1. cold load, authenticated ───────────────────────────────────────
  {
    const c = await context(userA.token); const page = await c.newPage(); const errs = errorsOf(page);
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 20_000 }).catch(() => {});
    await wait(3500);
    const s = report.scenarios.coldLoad = { cards: await page.evaluate(FACTS), errors: errs };
    await page.screenshot({ path: path.join(OUT, '01-cold-load.png') });
    if (!live(s.cards.nazar)) finding(`cold load: Nazar not live — ${JSON.stringify(s.cards.nazar)}`);
    if (!live(s.cards.ksenia)) finding(`cold load: Ksenia not live — ${JSON.stringify(s.cards.ksenia)}`);

    // ── 2. Ksenia's visible weekly ROI ────────────────────────────────
    await page.click('.trader-card[data-trader-id="VX-KSENIA"]').catch(() => {});
    await page.waitForSelector('.trader-profile-page', { timeout: 15_000 }).catch(() => {});
    await page.waitForSelector('.profile-detail-loading', { state: 'detached', timeout: 20_000 }).catch(() => {});
    await page.getByRole('button', { name: '7D', exact: true }).click({ timeout: 10_000 }).catch(() => {});
    await wait(1500);
    report.scenarios.kseniaWeekly = await page.evaluate(() => {
      const p = document.querySelector('.trader-profile-page');
      const txt = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
      const metric = l => txt([...(p?.querySelectorAll('.profile-metrics-grid > div') ?? [])]
        .find(d => d.querySelector('span')?.textContent?.trim() === l)?.querySelector('strong'));
      return {
        hero: [...(p?.querySelectorAll('.trader-hero-metrics > div') ?? [])]
          .map(d => [txt(d.querySelector('span')), txt(d.querySelector('strong'))]),
        roi: metric('ROI'), pnl: metric('PnL') ?? metric('Net PnL'),
        readouts: txt(p?.querySelector('.profile-performance-chart .chart-readouts')),
        body: p ? p.textContent.replace(/\s+/g, ' ') : '',
      };
    });
    await page.screenshot({ path: path.join(OUT, '02-ksenia-profile-7d.png') });
    const weekly = report.scenarios.kseniaWeekly;
    // The 7D readout itself, not merely the string somewhere on the page.
    if (!/ROI\s*·\s*7D\s*\+?61[.,]9%/.test(weekly.readouts ?? weekly.body)) {
      finding(`Ksenia profile 7D readout is not 61.9% — ${JSON.stringify(weekly.readouts)}`);
    }
    // And the PnL beside it is still the engine's, not derived from 61.9%.
    weekly.pnlBesideRoi = (weekly.readouts ?? '').match(/PnL[^+\-]*([+\-][^A-Za-z]*USDT)/)?.[1] ?? null;

    // The card's own headline follows the marketplace period chips, so put
    // them on 7D and read Ksenia's card the way the owner would.
    await page.click('.back-button').catch(() => {});
    await page.waitForSelector('.trader-card[data-trader-id="VX-KSENIA"]', { timeout: 15_000 }).catch(() => {});
    // The marketplace's period chips carry Russian labels («7Д»), unlike the
    // profile's («7D») — clicking the wrong one silently left the card on 90Д.
    await page.click('.period-group button:has-text("7Д")', { timeout: 10_000 }).catch(() => {});
    await wait(1500);
    const weekCards = report.scenarios.kseniaCardWeekly = await page.evaluate(FACTS);
    // The cards sit below the fold; bring them up so the figure is legible
    // in the evidence rather than cropped off the bottom of the viewport.
    await page.locator('.trader-card[data-trader-id="VX-001"]').scrollIntoViewIfNeeded().catch(() => {});
    await wait(500);
    await page.screenshot({ path: path.join(OUT, '02b-cards-7d.png') });
    for (const [file, id] of [['02c-card-nazar-7d.png', 'VX-001'], ['02d-card-ksenia-7d.png', 'VX-KSENIA']]) {
      const el = await page.$(`.trader-card[data-trader-id="${id}"]`);
      if (el) await el.screenshot({ path: path.join(OUT, file) }).catch(() => {});
    }
    if (!/61[.,]9/.test(weekCards.ksenia?.roi ?? '')) {
      finding(`Ksenia CARD at 7D does not read 61.9% — ${JSON.stringify(weekCards.ksenia?.roi)}`);
    }

    // ── 3. route leave / return ───────────────────────────────────────
    await page.click('.back-button').catch(() => {});
    await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 15_000 }).catch(() => {});
    await page.goto(`${origin}/wallet`, { waitUntil: 'domcontentloaded' });
    await wait(1500);
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const back = report.scenarios.routeReturn = { cards: await page.evaluate(FACTS) };
    await page.screenshot({ path: path.join(OUT, '03-route-return.png') });
    if (!live(back.cards.nazar) || !live(back.cards.ksenia)) {
      finding(`route return: a card is not live — ${JSON.stringify(back.cards)}`);
    }

    // ── 4. hard reload ────────────────────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(3000);
    const reload = report.scenarios.hardReload = { cards: await page.evaluate(FACTS) };
    await page.screenshot({ path: path.join(OUT, '04-hard-reload.png') });
    if (!live(reload.cards.nazar) || !live(reload.cards.ksenia)) {
      finding(`hard reload: a card is not live — ${JSON.stringify(reload.cards)}`);
    }
    report.scenarios.coldLoad.errors = errs;
    await c.close();
  }

  // ── 5. failed prefetch → mount ────────────────────────────────────────
  {
    const c = await context(userA.token); const page = await c.newPage(); const errs = errorsOf(page);
    let calls = 0, failFirst = true;
    await page.route('**/api/v1/copy-trading/marketplace', async route => {
      calls++; if (failFirst) { failFirst = false; return route.abort('failed'); } return route.continue(); });
    await page.goto(`${origin}/wallet`, { waitUntil: 'domcontentloaded' });
    await wait(1200);
    const link = await page.$('a[href="/copy-trading"]');
    if (link) await link.hover().catch(() => {});
    await wait(1200);
    const afterPrefetch = calls;
    if (link) await link.click().catch(() => {});
    else await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 20_000 }).catch(() => {});
    await wait(3500);
    const s = report.scenarios.failedPrefetch = {
      callsAfterPrefetch: afterPrefetch, callsAfterMount: calls,
      cards: await page.evaluate(FACTS), errors: errs };
    await page.screenshot({ path: path.join(OUT, '05-failed-prefetch-then-mount.png') });
    if (s.callsAfterMount <= s.callsAfterPrefetch) finding('failed prefetch: mounting put no request on the wire');
    if (!live(s.cards.nazar) || !live(s.cards.ksenia)) {
      finding(`failed prefetch: cards did not recover — ${JSON.stringify(s.cards)}`);
    }
    await c.close();
  }

  // ── 6. the token arrives AFTER mount ─────────────────────────────────
  {
    const c = await context(null); const page = await c.newPage(); const errs = errorsOf(page);
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    const beforeToken = await page.evaluate(FACTS);
    // Unauthenticated, this route does not render the featured cards at all,
    // so there is nothing on screen to hang — `null` is absence, not a
    // skeleton. What must never happen is a card that EXISTS and is still
    // saying «Загрузка…» with nothing in flight behind it.
    for (const [who, card] of Object.entries(beforeToken)) {
      if (card && !decided(card)) finding(`no session: ${who} is still «Загрузка…» — ${JSON.stringify(card)}`);
    }
    await page.evaluate(t => {
      localStorage.setItem('exchange_token', t);
      window.dispatchEvent(new StorageEvent('storage', { key: 'exchange_token', newValue: t }));
    }, userA.token);
    await wait(3500);
    const s = report.scenarios.lateToken = { beforeToken, afterToken: await page.evaluate(FACTS), errors: errs };
    await page.screenshot({ path: path.join(OUT, '06-token-after-mount.png') });
    // If the route renders the cards once authenticated, they must be live
    // rather than stuck — this is the "auth resolved late" path.
    for (const [who, card] of Object.entries(s.afterToken)) {
      if (card && !decided(card)) finding(`late token: ${who} is still «Загрузка…» — ${JSON.stringify(card)}`);
    }
    await c.close();
  }

  // ── 7. a failing refresh, and a timeout ──────────────────────────────
  {
    const c = await context(userA.token); const page = await c.newPage(); const errs = errorsOf(page);
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await wait(3500);
    const before = await page.evaluate(FACTS);
    await page.route('**/api/v1/copy-trading/marketplace', r =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await wait(2000);
    const s = report.scenarios.failingRefresh = { before, after: await page.evaluate(FACTS), errors: errs };
    await page.screenshot({ path: path.join(OUT, '07-failing-refresh.png') });
    // Last-good must survive a failure.
    if (!live(s.after.nazar) || !live(s.after.ksenia)) {
      finding(`failing refresh: last-good was cleared — ${JSON.stringify(s.after)}`);
    }
    await c.close();
  }

  // ── 8. a cold load that never answers: verdict, not a skeleton ───────
  {
    const c = await context(userB.token); const page = await c.newPage(); const errs = errorsOf(page);
    // Held open, never answered. The client's own 15s abort must convert
    // this into an honest unavailable state.
    await page.route('**/api/v1/copy-trading/marketplace', () => {});
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 20_000 }).catch(() => {});
    await wait(19_000);
    const s = report.scenarios.timeout = { cards: await page.evaluate(FACTS), errors: errs };
    await page.screenshot({ path: path.join(OUT, '08-timeout.png') });
    if (!decided(s.cards.nazar) || !decided(s.cards.ksenia)) {
      finding(`timeout: a card is still «Загрузка…» after 19s — ${JSON.stringify(s.cards)}`);
    }
    if (!s.cards.nazar.unavailable || !s.cards.ksenia.unavailable) {
      finding(`timeout: no honest unavailable state — ${JSON.stringify(s.cards)}`);
    }
    await c.close();
  }

  for (const [name, s] of Object.entries(report.scenarios)) {
    if (s && Array.isArray(s.errors) && s.errors.length) finding(`${name}: page errors — ${s.errors.join(' | ')}`);
  }
  report.status = report.findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings: report.findings,
    coldLoad: report.scenarios.coldLoad?.cards,
    kseniaCardRoi: report.scenarios.coldLoad?.cards?.ksenia?.roi,
    kseniaProfileRoi: report.scenarios.kseniaWeekly?.roi,
    kseniaHero: report.scenarios.kseniaWeekly?.hero,
    failedPrefetch: { before: report.scenarios.failedPrefetch?.callsAfterPrefetch,
      after: report.scenarios.failedPrefetch?.callsAfterMount },
    lateToken: report.scenarios.lateToken && {
      before: report.scenarios.lateToken.beforeToken?.nazar,
      after: report.scenarios.lateToken.afterToken?.nazar },
    timeout: report.scenarios.timeout?.cards?.nazar,
  }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await browser?.close().catch(() => {}); server?.close(); });
