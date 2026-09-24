'use strict';
/** Copy Trading — «Статистика по месяцам» for Nazar and Ksenia, in a browser.
 *
 * Drives the production frontend bundle in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService and requireAuth, with
 * an in-memory scenario table (no DATABASE_URL, no production secret, no
 * writes) — the same harness as qa-copy-daily-progression.cjs.
 *
 * What it proves, on desktop 1440x900 and mobile 390x844, for both traders:
 *   1  the «Статистика» tab carries the «Статистика по месяцам» button;
 *   2  the dialog names the trader whose profile is open, and every month
 *      it prints is that trader's own figure — recomputed here from the
 *      API's dailyResults (Σ daily return × 100, the served methodology) and
 *      checked against the server's canonical monthly row;
 *   3  months outside the history print «—»;
 *   4  opening the dialog, choosing months and moving between years sends
 *      ZERO requests of any kind — nothing reaches Render or Neon;
 *   5  the dialog fits the viewport, the page does not scroll sideways,
 *      Escape closes it, and the page throws nothing.
 *
 * Build first: `npx tsc -p tsconfig.json` and `npm --prefix frontend run build`.
 * Evidence: docs/qa/copy-monthly-performance/.
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
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-monthly-performance');
fs.mkdirSync(OUT, { recursive: true });
const DAY = process.env.QA_COPY_DATE || '2026-09-24';
const VIEWPORTS = [{ tag: 'desktop', width: 1440, height: 900 }, { tag: 'mobile', width: 390, height: 844 }];
const STRATEGIES = [{ key: 'nazar', id: 'VX-001', name: 'Nazar' }, { key: 'ksenia', id: 'VX-KSENIA', name: 'Ksenia' }];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const report = { startedAt: new Date().toISOString(), day: DAY,
  environment: 'LOCAL QA ONLY — real compiled router/service, in-memory persistence', views: {}, findings: [] };
const finding = text => { report.findings.push(text); console.log(`FINDING ${text}`); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const percent = value => {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded.toFixed(2)}%` : rounded < 0 ? `${rounded.toFixed(2)}%` : '0.00%';
};

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

/** The table as printed: { '2025-08': '+12.34%', …, '2025': '…' }. */
const readTable = () => {
  const dialog = document.querySelector('dialog.copy-monthly-dialog');
  if (!dialog) return null;
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const years = [...dialog.querySelectorAll('.mcp-table thead th')].slice(1).map(text);
  const cells = {};
  [...dialog.querySelectorAll('.mcp-table tbody tr')].forEach((row, index) => {
    [...row.querySelectorAll('td')].forEach((td, column) => {
      cells[`${years[column]}-${String(index + 1).padStart(2, '0')}`] = text(td).replace(/\*$/, '');
    });
  });
  [...dialog.querySelectorAll('.mcp-table tfoot td')].forEach((td, column) => { cells[years[column]] = text(td).replace(/\*$/, ''); });
  const box = dialog.getBoundingClientRect();
  return {
    open: dialog.open, traderId: dialog.getAttribute('data-trader-id'), trader: text(dialog.querySelector('.mcp-trader')),
    title: text(dialog.querySelector('h2')), subtitle: text(dialog.querySelector('.mcp-header p')),
    months: [...dialog.querySelectorAll('.mcp-table tbody th')].map(text), total: text(dialog.querySelector('.mcp-table tfoot th')),
    years, cells, detail: text(dialog.querySelector('.mcp-detail h3')),
    fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
  };
};

async function openProfile(page, strategy) {
  await page.waitForSelector(`.trader-card[data-trader-id="${strategy.id}"]`, { timeout: 25_000 });
  await page.click(`.trader-card[data-trader-id="${strategy.id}"]`);
  await page.waitForSelector('.trader-profile-page', { timeout: 20_000 });
  await page.waitForSelector('.profile-detail-loading', { state: 'detached', timeout: 25_000 }).catch(() => {});
  await page.waitForSelector('.monthly-performance-open', { timeout: 25_000 });
}

(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('Build the frontend first: npm --prefix frontend run build');
    process.exit(2);
  }
  const { db, account } = localDatabase();
  const service = new CopyPerformanceService(db, () => new Date(`${DAY}T12:00:00Z`));
  const app = express();
  app.use((_q, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/v1', copyPerformanceRouter(db, service));
  const auth = requireAuth(db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa@example.invalid',
    displayName: 'QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: `${DAY}T00:00:00Z` }));
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
  const viewer = account();

  // The same bytes the page receives, read once here as the reference.
  const api = await (await fetch(`${origin}/api/v1/copy-trading/marketplace`, { headers: { Authorization: `Bearer ${viewer.token}` } })).json();
  const expected = {};
  for (const strategy of STRATEGIES) {
    const data = api[strategy.key];
    const sums = {};
    for (const day of data.dailyResults) {
      sums[day.date.slice(0, 7)] = (sums[day.date.slice(0, 7)] ?? 0) + day.dailyReturn;
      sums[day.date.slice(0, 4)] = (sums[day.date.slice(0, 4)] ?? 0) + day.dailyReturn;
    }
    expected[strategy.key] = Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, value * 100]));
    for (const month of data.monthly) {
      if (Math.abs(expected[strategy.key][month.period] - month.roi) > 0.001) {
        finding(`${strategy.key} ${month.period}: daily sum ${expected[strategy.key][month.period]} vs server month ${month.roi}`);
      }
    }
  }
  report.methodology = Object.fromEntries(STRATEGIES.map(s => [s.key, api[s.key].economics.methodology]));

  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
      await context.addInitScript(token => { try { localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru'); } catch {} }, viewer.token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error && error.message)));
      let counting = false;
      const requests = [];
      page.on('request', request => { if (counting) requests.push(`${request.method()} ${request.url()}`); });
      await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      await wait(2500);

      for (const strategy of STRATEGIES) {
        const tag = `${viewport.tag}/${strategy.key}`;
        await openProfile(page, strategy);
        await page.locator('.monthly-performance-entry').scrollIntoViewIfNeeded();
        await wait(400);
        await page.locator('.monthly-performance-entry').screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-entry.png`) });

        // From here on, every request of any kind is recorded.
        requests.length = 0; counting = true;
        await page.click('.monthly-performance-open');
        await page.waitForSelector('dialog.copy-monthly-dialog[open]', { timeout: 5000 });
        await wait(300);
        const view = await page.evaluate(readTable);
        await page.screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-monthly.png`) });

        // Move between months and years.
        const clicks = [];
        for (const label of ['Август 2025', 'Декабрь 2025', '2025 · Итог', 'Январь 2026', '2026 · Итог', 'Сентябрь 2026']) {
          const button = page.locator(`dialog.copy-monthly-dialog .mcp-cell[aria-label^="${label}:"]`);
          if (!(await button.count())) { finding(`${tag}: no cell for ${label}`); continue; }
          await button.scrollIntoViewIfNeeded();
          await button.click();
          clicks.push({ label, detail: await page.locator('dialog.copy-monthly-dialog .mcp-detail h3').textContent() });
        }
        await page.locator('dialog.copy-monthly-dialog .mcp-cell[aria-label^="2025 · Итог:"]').click();
        await wait(200);
        await page.screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-year-2025.png`) });
        await page.locator('dialog.copy-monthly-dialog .mcp-cell[aria-label^="Сентябрь 2026:"]').click();
        await page.locator('dialog.copy-monthly-dialog .mcp-detail').scrollIntoViewIfNeeded();
        await wait(200);
        await page.screenshot({ path: path.join(OUT, `${viewport.tag}-${strategy.key}-detail.png`) });
        const detail = await page.locator('dialog.copy-monthly-dialog .mcp-detail').evaluate(el => Object.fromEntries(
          [...el.querySelectorAll('dl > div')].map(row => [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()])));

        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog.copy-monthly-dialog', { state: 'detached', timeout: 3000 }).catch(() => finding(`${tag}: Escape did not close the dialog`));
        await wait(500);
        counting = false;
        report.views[tag] = { view, clicks, detail, requestsWhileOpen: [...requests] };

        // Judge.
        if (requests.length) finding(`${tag}: ${requests.length} request(s) while the dialog was open: ${requests.join(', ')}`);
        if (!view || !view.open) { finding(`${tag}: dialog did not open`); continue; }
        if (view.traderId !== strategy.id || view.trader !== `${strategy.name} · ${strategy.id}`) finding(`${tag}: dialog names ${view.trader} (${view.traderId})`);
        if (view.title !== 'Помесячная доходность') finding(`${tag}: title ${view.title}`);
        if (view.subtitle !== 'Результаты по месяцам с накопительным итогом') finding(`${tag}: subtitle ${view.subtitle}`);
        if (JSON.stringify(view.months) !== JSON.stringify(MONTHS) || view.total !== 'Итог') finding(`${tag}: rows ${view.months} / ${view.total}`);
        if (JSON.stringify(view.years) !== JSON.stringify(['2025', '2026'])) finding(`${tag}: years ${view.years}`);
        for (const [key, printed] of Object.entries(view.cells)) {
          const value = expected[strategy.key][key];
          const want = value === undefined ? '—' : percent(value);
          if (printed !== want) finding(`${tag}: ${key} printed ${printed}, expected ${want}`);
        }
        if (!view.fits) finding(`${tag}: dialog does not fit the viewport`);
        if (view.pageOverflow) finding(`${tag}: page scrolls sideways`);
        if (clicks.map(c => c.detail).join('|') !== 'Август 2025|Декабрь 2025|2025 · Итог|Январь 2026|2026 · Итог|Сентябрь 2026') {
          finding(`${tag}: detail titles ${clicks.map(c => c.detail).join('|')}`);
        }
        await page.click('.back-button').catch(() => {});
        await wait(800);
      }
      if (errors.length) finding(`${viewport.tag}: page errors ${errors.join(' | ')}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  report.finishedAt = new Date().toISOString();
  report.result = report.findings.length ? 'FAIL' : 'PASS';
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.result} — ${report.findings.length} finding(s); evidence in ${path.relative(root, OUT)}`);
  process.exit(report.findings.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
