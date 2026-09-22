'use strict';
/** Copy Trading — one new trade a day, hidden trades, and a 7D that moves.
 *
 * Drives the production frontend bundle in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService and requireAuth, with
 * an in-memory scenario table (no DATABASE_URL, no production secret, no
 * writes). The clock is the only thing this harness controls, because the
 * clock is the whole subject: the rule under test is a calendar.
 *
 * What it proves, on desktop 1440x900 and mobile 390x844, for Nazar and Ksenia:
 *   1  the profile's current 7D window ENDS on today, every day;
 *   2  the «Сделки» tab is a locked state — one icon, one sentence, no table,
 *      no rows, no count, and nothing about subscribers;
 *   3  no service vocabulary («по данным управляющего», «за отчётную
 *      неделю») appears anywhere on the card or the profile;
 *   4  Ksenia's current 7D is NOT frozen on 61.9% once the reported week has
 *      passed;
 *   5  reloading on the same day creates no extra trade;
 *   6  moving the clock one day forward creates EXACTLY one, per strategy,
 *      and the profile's window moves with it.
 *
 * The trade counts are read from the service's own ledger server-side, not
 * from the page: the page is never sent an execution, which is (2).
 *
 * Build first: `npx tsc -p tsconfig.json` and `npm --prefix frontend run build`.
 * Evidence: docs/qa/copy-daily-progression/.
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
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-daily-progression');
fs.mkdirSync(OUT, { recursive: true });
const DAY_ONE = process.env.QA_COPY_DATE || '2026-09-25';
const NEXT_DAY = new Date(Date.parse(`${DAY_ONE}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const VIEWPORTS = [{ tag: 'desktop', width: 1440, height: 900 }, { tag: 'mobile', width: 390, height: 844 }];
const STRATEGIES = [{ key: 'nazar', id: 'VX-001', name: 'Nazar' }, { key: 'ksenia', id: 'VX-KSENIA', name: 'Ksenia' }];
const LOCKED = 'Торговая информация этого трейдера скрыта';
const BANNED = ['по данным управляющего', 'за отчётную неделю', 'за отчетную неделю',
  'OWNER_REPORTED', 'synthetic', 'modeled', 'доступна только подписчикам', 'подписчикам'];

const report = { startedAt: new Date().toISOString(), days: { first: DAY_ONE, second: NEXT_DAY },
  environment: 'LOCAL QA ONLY — real compiled router/service, in-memory persistence',
  ledger: {}, views: {}, findings: [] };
const finding = text => { report.findings.push(text); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/** The UI prints dates as dd.MM.yyyy in ru-RU. */
const shown = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU',
  { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

function localDatabase() {
  const scenarios = new Map(), sessions = new Map();
  const identities = new Map([
    ['VX-001', { traderId: 'VX-001', publicName: 'Nazar', ownerUserId: 'qa-nazar-owner', premium: true }],
    ['VX-KSENIA', { traderId: 'VX-KSENIA', publicName: 'Ksenia', ownerUserId: 'qa-ksenia-owner', premium: true }],
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

/** Everything the page shows about a strategy, read off the DOM. */
const profileFacts = () => {
  const page = document.querySelector('.trader-profile-page');
  if (!page) return null;
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const panel = page.querySelector('.profile-trades-panel');
  const note = panel && panel.querySelector('.trades-hidden-note');
  return {
    name: text(page.querySelector('.trader-profile-hero h1')),
    range: text(page.querySelector('.profile-period-range')),
    roiReadout: text(page.querySelector('.profile-performance-chart .chart-readouts')),
    tabs: [...page.querySelectorAll('.profile-primary-tabs button')].map(b => b.textContent.trim()),
    panelText: panel ? panel.textContent.replace(/\s+/g, ' ').trim() : null,
    noteText: note ? note.textContent.replace(/\s+/g, ' ').trim() : null,
    noteHasIcon: note ? !!note.querySelector('svg') : false,
    hasTable: panel ? !!panel.querySelector('table') : null,
    rows: panel ? panel.querySelectorAll('tbody tr').length : -1,
    hasHeading: panel ? !!panel.querySelector('.profile-panel-heading') : null,
    body: page.textContent.replace(/\s+/g, ' '),
  };
};

/** Open one strategy's profile, put it on 7D, read it, then open «Сделки». */
async function readProfile(page, strategy) {
  await page.waitForSelector(`.trader-card[data-trader-id="${strategy.id}"]`, { timeout: 25_000 });
  await page.click(`.trader-card[data-trader-id="${strategy.id}"]`);
  await page.waitForSelector('.trader-profile-page', { timeout: 20_000 });
  await page.waitForSelector('.profile-detail-loading', { state: 'detached', timeout: 25_000 }).catch(() => {});
  await page.getByRole('button', { name: '7D', exact: true }).click({ timeout: 15_000 }).catch(() => {});
  await wait(1200);
  const statistics = await page.evaluate(profileFacts);
  await page.getByRole('button', { name: 'Сделки', exact: true }).click({ timeout: 15_000 }).catch(() => {});
  await wait(900);
  const trades = await page.evaluate(profileFacts);
  return { statistics, trades };
}

function judge(tag, strategy, view, today) {
  const { statistics, trades } = view;
  if (!statistics || !trades) { finding(`${tag}: ${strategy.name}'s profile did not open`); return; }

  // 1 — the rolling window ends on today.
  if (!statistics.range || !statistics.range.includes(shown(today))) {
    finding(`${tag}: ${strategy.name} 7D range does not end on ${today} — ${JSON.stringify(statistics.range)}`);
  }
  if (!/Скользящий период/.test(statistics.range ?? '')) {
    finding(`${tag}: ${strategy.name} 7D is not presented as a rolling period — ${JSON.stringify(statistics.range)}`);
  }

  // 2 — the locked «Сделки» tab.
  if (!trades.tabs.includes('Сделки')) finding(`${tag}: ${strategy.name} has no «Сделки» tab at all`);
  if (trades.noteText !== LOCKED) finding(`${tag}: ${strategy.name} locked note reads ${JSON.stringify(trades.noteText)}`);
  if (!trades.noteHasIcon) finding(`${tag}: ${strategy.name} locked note has no icon`);
  if (trades.hasTable) finding(`${tag}: ${strategy.name} still renders a trade table`);
  if (trades.rows > 0) finding(`${tag}: ${strategy.name} renders ${trades.rows} trade rows`);
  if (trades.hasHeading) finding(`${tag}: ${strategy.name} locked tab still carries a heading row`);
  if (trades.panelText !== LOCKED) finding(`${tag}: ${strategy.name} locked tab shows more than the sentence — ${JSON.stringify(trades.panelText)}`);

  // 3 — no service vocabulary anywhere on the profile.
  for (const phrase of BANNED) {
    if ((statistics.body ?? '').includes(phrase) || (trades.body ?? '').includes(phrase)) {
      finding(`${tag}: ${strategy.name} profile shows «${phrase}»`);
    }
  }

  // 4 — Ksenia is not frozen on the reported week.
  if (strategy.key === 'ksenia' && /61[.,]9/.test(statistics.roiReadout ?? '')) {
    finding(`${tag}: Ksenia's current 7D is still 61.9% — ${JSON.stringify(statistics.roiReadout)}`);
  }
}

(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('Build the frontend first: npm --prefix frontend run build');
    process.exit(2);
  }
  const { db, account } = localDatabase();
  const clock = { now: `${DAY_ONE}T12:00:00Z` };
  const service = new CopyPerformanceService(db, () => new Date(clock.now));

  const app = express();
  app.use((_q, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/v1', copyPerformanceRouter(db, service));
  const auth = requireAuth(db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa@example.invalid',
    displayName: 'QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: `${DAY_ONE}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_q, res) => res.json({ points: [] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_q, res) => res.json([]));
  app.get('/api/v1/support/conversations/mine', auth, (_q, res) => res.json({ conversation: null }));
  app.get('/api/v1/market/external/tickers', (_q, res) => res.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (req, res) => res.status(404).json({ error: 'unrelated', path: req.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  /** The ledger behind the page: the one place an execution still exists. */
  const ledger = async () => Object.fromEntries(await Promise.all(STRATEGIES.map(async strategy => {
    const data = await service.get(strategy.key);
    const latest = data.trades.map(trade => trade.closedAt.slice(0, 10)).sort().slice(-1)[0];
    return [strategy.key, { total: data.trades.length, latestTradeDate: latest,
      latestDailyDate: data.dailyResults[data.dailyResults.length - 1].date,
      simulatedAt: data.simulation.simulatedAt.slice(0, 10),
      onToday: data.trades.filter(trade => trade.closedAt.slice(0, 10) === clock.now.slice(0, 10)).length }];
  })));

  // A sandbox may ship its own Chromium build rather than the one this
  // Playwright expects; QA_CHROMIUM_PATH points at it when so. CI leaves it
  // unset and uses the browser it installed.
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH
    ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const viewer = account();
  try {
    report.ledger.dayOne = await ledger();

    // ── Day one, at both widths ──────────────────────────────────────
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: 'block' });
      await context.addInitScript(token => { try { localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru'); } catch {} }, viewer.token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error && error.message)));
      await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await wait(3500);
      await page.screenshot({ path: path.join(OUT, `${viewport.tag}-01-marketplace.png`), fullPage: false });

      for (const strategy of STRATEGIES) {
        const view = await readProfile(page, strategy);
        await page.screenshot({ path: path.join(OUT, `${viewport.tag}-02-${strategy.key}-trades-locked.png`) });
        const panel = await page.$('.profile-trades-panel');
        if (panel) await panel.screenshot({ path: path.join(OUT, `${viewport.tag}-03-${strategy.key}-locked-panel.png`) }).catch(() => {});
        report.views[`${viewport.tag}/${strategy.key}/day1`] = view;
        judge(`${viewport.tag} day1`, strategy, view, DAY_ONE);
        await page.click('.back-button').catch(() => {});
        await wait(900);
      }
      if (errors.length) finding(`${viewport.tag}: page errors — ${errors.join(' | ')}`);
      await context.close();
    }

    // ── Same day, reloaded: nothing may be appended ──────────────────
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(token => { try { localStorage.setItem('exchange_token', token); } catch {} }, viewer.token);
      const page = await context.newPage();
      for (let reload = 0; reload < 3; reload++) {
        await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
        await wait(2500);
      }
      await context.close();
    }
    report.ledger.afterSameDayReloads = await ledger();
    for (const strategy of STRATEGIES) {
      const before = report.ledger.dayOne[strategy.key], after = report.ledger.afterSameDayReloads[strategy.key];
      if (after.total !== before.total) {
        finding(`same-day reloads added ${after.total - before.total} ${strategy.name} trades — must be 0`);
      }
      if (after.onToday !== 1) finding(`${strategy.name} has ${after.onToday} trades on ${DAY_ONE} — must be exactly 1`);
      if (after.latestTradeDate !== DAY_ONE) finding(`${strategy.name}'s newest trade is ${after.latestTradeDate}, not ${DAY_ONE}`);
      if (after.latestDailyDate !== DAY_ONE) finding(`${strategy.name}'s newest daily result is ${after.latestDailyDate}`);
    }

    // ── The next calendar day: exactly one more, and the window moves ─
    clock.now = `${NEXT_DAY}T09:00:00Z`;
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await context.addInitScript(token => { try { localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru'); } catch {} }, viewer.token);
      const page = await context.newPage();
      await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await wait(3500);
      for (const strategy of STRATEGIES) {
        const view = await readProfile(page, strategy);
        await page.screenshot({ path: path.join(OUT, `nextday-${strategy.key}-trades-locked.png`) });
        report.views[`nextday/${strategy.key}`] = view;
        judge(`next day`, strategy, view, NEXT_DAY);
        await page.click('.back-button').catch(() => {});
        await wait(900);
      }
      await context.close();
    }
    report.ledger.nextDay = await ledger();
    for (const strategy of STRATEGIES) {
      const before = report.ledger.afterSameDayReloads[strategy.key], after = report.ledger.nextDay[strategy.key];
      if (after.total - before.total !== 1) {
        finding(`${strategy.name} gained ${after.total - before.total} trades on ${NEXT_DAY} — must be exactly 1`);
      }
      if (after.onToday !== 1) finding(`${strategy.name} has ${after.onToday} trades on ${NEXT_DAY} — must be exactly 1`);
      if (after.latestTradeDate !== NEXT_DAY) finding(`${strategy.name}'s newest trade is ${after.latestTradeDate}, not ${NEXT_DAY}`);
      if (after.latestDailyDate !== NEXT_DAY) finding(`${strategy.name}'s newest daily result is ${after.latestDailyDate}`);
    }
  } catch (error) {
    finding(`harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    await browser.close();
    server.close();
  }

  report.status = report.findings.length ? 'FAIL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings: report.findings, ledger: report.ledger }, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 1);
})();
