'use strict';
/** Copy Trading — cards, hidden trades and the avatar ring, in a real browser.
 *
 * Drives the production frontend bundle in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService, redactTradeHistory and
 * requireAuth, with an in-memory database only (no DATABASE_URL, no
 * production secret, no writes). Every figure on screen comes from the
 * canonical service; nothing here invents ROI, PnL, AUM or followers.
 *
 * What it proves:
 *   1  cold open, no cache: both cards paint real figures, no «Данные
 *      недоступны», and the button says «Загрузка…» rather than passing a
 *      verdict while the first request is still in flight;
 *   2  a failed prefetch followed by a mount still puts a request on the
 *      wire — the regression that put the owner's screenshot on screen;
 *   3  a refresh that fails keeps both cards' figures, flagged stale;
 *   4  Ksenia failing never blanks Nazar, and the reverse;
 *   5  hard reload repaints from the validated snapshot;
 *   6  logging out and arriving as another account shows nothing of the first;
 *   7  the profile shows «Информация о сделках скрыта» and NO trade table;
 *   8  no response to the browser contains an execution — checked on the
 *      captured wire bytes, not on the DOM;
 *   9  the aggregates survive the redaction: trade count, ROI, win rate;
 *  10  Nazar's avatar ring is pixel-identical to Ksenia's, with the photo and
 *      with initials.
 *
 * Build first: `npx tsc -p tsconfig.json` and `npm --prefix frontend run build`.
 * Evidence: docs/qa/copy-cards-trades-avatar/.
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
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/copy-cards-trades-avatar');
fs.mkdirSync(OUT, { recursive: true });
const date = process.env.QA_COPY_DATE || '2026-09-19';
const WIDTHS = (process.env.QA_WIDTHS || '1440,390').split(',').map(Number);
const report = { startedAt: new Date().toISOString(), date,
  environment: 'LOCAL QA ONLY — real compiled router/service, in-memory persistence',
  widths: {}, wire: { responses: 0, executionsFound: [] }, findings: [] };
const finding = text => { report.findings.push(text); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function localDatabase() {
  const scenarios = new Map(), sessions = new Map();
  const identities = new Map([
    ['VX-001', { publicName: 'Nazar', ownerUserId: 'qa-nazar-owner', premium: true }],
    ['VX-KSENIA', { publicName: 'Ksenia', ownerUserId: 'qa-ksenia-owner', premium: true }],
  ]);
  // Both owners carry a real decodable photo, so the ring is exercised in
  // the state that actually matters: with an image painted inside it. The
  // image is a generated gradient, not anyone's likeness.
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAABiUlEQVR4nO3RAQ3AMAzAsFY6mGEasOE9DytWGGTPfTtTat/sBNZgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxDcY1GNdgXINxP0otBNTeHNa7AAAAAElFTkSuQmCC';
  const owners = new Map([
    ['qa-nazar-owner', { avatarUrl: photo, kycStatus: 'NOT_STARTED' }],
    ['qa-ksenia-owner', { avatarUrl: photo, kycStatus: 'NOT_STARTED' }],
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

/** What a visitor reads off a featured card. */
const cardFacts = id => {
  const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
  if (!card) return null;
  const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const stat = label => text([...card.querySelectorAll('.card-stats > div')]
    .find(div => div.textContent.includes(label))?.querySelector('strong'));
  const meta = label => text([...card.querySelectorAll('.card-meta > div')]
    .find(div => div.textContent.includes(label))?.querySelector('b'));
  return {
    name: text(card.querySelector('h3')),
    roi: text(card.querySelector('.card-roi-copy strong')),
    aum: meta('AUM'),
    drawdown: stat('Просадка'),
    winRate: stat('Win Rate'),
    unavailableText: card.textContent.includes('Данные недоступны'),
    loadingText: card.textContent.includes('Загрузка…'),
    copyButton: text(card.querySelector('.button-copy')),
    sparkline: card.querySelector('.mini-chart-line')?.getAttribute('d') || null,
  };
};
/** The avatar's ring, as the browser actually computes it. */
const ringFacts = id => {
  const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
  const avatar = card && card.querySelector('.avatar');
  if (!avatar) return null;
  const style = getComputedStyle(avatar);
  const box = avatar.getBoundingClientRect();
  const photo = avatar.querySelector('img.avatar-photo');
  return {
    borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle, borderColor: style.borderTopColor,
    boxShadow: style.boxShadow, borderRadius: style.borderTopLeftRadius,
    size: `${Math.round(box.width)}x${Math.round(box.height)}`,
    hasPhoto: !!photo,
    // The photo is an absolutely positioned child; if it reached outside the
    // padding box it would paint over the ring.
    photoCoversRing: photo ? (() => {
      const p = photo.getBoundingClientRect();
      const inset = parseFloat(style.borderTopWidth) || 0;
      return p.left < box.left + inset - 0.5 || p.top < box.top + inset - 0.5;
    })() : false,
  };
};
const RING = `(() => ({ nazar: (${ringFacts})('VX-001'), ksenia: (${ringFacts})('VX-KSENIA') }))()`;
const FACTS = `(() => ({ nazar: (${cardFacts})('VX-001'), ksenia: (${cardFacts})('VX-KSENIA') }))()`;
const known = v => typeof v === 'string' && v.length > 0 && !v.includes('—');
const complete = f => !!f && known(f.roi) && known(f.aum) && known(f.drawdown) && !f.unavailableText;

/** Every key an execution would be recognised by, applied to captured bytes. */
const EXEC_KEYS = ['entryPrice', 'exitPrice', 'quantity', 'holdingTimeMinutes', 'riskR'];
function findExecutions(value, where, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, i) => findExecutions(item, where, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value);
  const looksLikeTrade = (keys.includes('side') || keys.includes('symbol')) && EXEC_KEYS.some(k => keys.includes(k));
  return [
    ...(looksLikeTrade ? [`${where} ${path}`] : []),
    ...Object.entries(value).flatMap(([k, v]) => findExecutions(v, where, `${path}.${k}`)),
  ];
}

let server, browser;
(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('frontend/dist is missing; build the frontend first');
  const fixture = localDatabase();
  const userA = fixture.account(), userB = fixture.account();
  const service = new CopyPerformanceService(fixture.db, () => new Date(`${date}T12:00:00Z`));

  const app = express();
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'Local QA is read-only' });
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use('/api/v1', copyPerformanceRouter(fixture.db, service));
  const auth = requireAuth(fixture.db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa-fixture@example.invalid',
    displayName: 'Local QA', avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED',
    twoFactorEnabled: false, createdAt: `${date}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_q, r) => r.json({ points: [{ date, totalValueUsd: '0' }] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_q, r) => r.json([]));
  app.get('/api/v1/support/conversations/mine', auth, (_q, r) => r.json({ conversation: null }));
  app.get('/api/v1/market/external/tickers', (_q, r) => r.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (req, res) => res.status(404).json({ error: 'Unrelated endpoint', path: req.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const width of WIDTHS) {
    const view = report.widths[width] = { pageErrors: [] };
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(({ token }) => {
      // Storage access throws outright in a sandboxed document, and an
      // exception from the HARNESS would be counted as a page error against
      // the product. Plant the token where it works, stay quiet where it does not.
      try {
        if (!sessionStorage.getItem('qa-token-planted')) {
          localStorage.setItem('exchange_token', token);
          sessionStorage.setItem('qa-token-planted', '1');
        }
        localStorage.setItem('exchange_lang', 'ru');
      } catch { /* not a document we can plant in */ }
    }, { token: userA.token });
    const page = await context.newPage();
    page.on('pageerror', e => view.pageErrors.push(String(e)));

    // EVERY marketplace/strategy body the browser receives is captured and
    // scanned for executions. This is the wire, not the DOM.
    page.on('response', async response => {
      if (!/\/api\/v1\/copy-trading\//.test(response.url())) return;
      let body; try { body = await response.json(); } catch { return; }
      report.wire.responses++;
      report.wire.executionsFound.push(...findExecutions(body, response.url().replace(origin, '')));
    });

    // ── 1. cold open, no cache ────────────────────────────────────────
    let marketplaceCalls = 0;
    await page.route('**/api/v1/copy-trading/marketplace', async route => { marketplaceCalls++; await route.continue(); });
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    // What the card says while the very first request is still unanswered.
    view.firstPaint = await page.evaluate(FACTS).catch(() => null);
    await page.waitForFunction(`!!document.querySelector('.trader-card[data-trader-id="VX-001"] .mini-chart-line')`,
      null, { timeout: 20_000 }).catch(() => {});
    await wait(900);
    view.coldOpen = await page.evaluate(FACTS);
    view.coldOpenCalls = marketplaceCalls;
    await page.screenshot({ path: path.join(OUT, `w${width}-01-cold-open.png`), fullPage: false });

    // ── 10. the avatar ring ───────────────────────────────────────────
    view.ring = await page.evaluate(RING);
    const nazarAvatar = await page.$('.trader-card[data-trader-id="VX-001"] .avatar');
    const kseniaAvatar = await page.$('.trader-card[data-trader-id="VX-KSENIA"] .avatar');
    if (nazarAvatar) await nazarAvatar.screenshot({ path: path.join(OUT, `w${width}-10-avatar-nazar.png`) }).catch(() => {});
    if (kseniaAvatar) await kseniaAvatar.screenshot({ path: path.join(OUT, `w${width}-10-avatar-ksenia.png`) }).catch(() => {});

    // ── 7. the profile: no trade table, a closed block instead ────────
    await page.click('.trader-card[data-trader-id="VX-KSENIA"]').catch(() => {});
    await page.waitForSelector('.trader-profile-page', { timeout: 15_000 }).catch(() => {});
    // The heavy panels are deferred past first paint, so nothing below the
    // hero exists yet. Wait for that gate to lift, then switch to the
    // «Сделки» tab — the trade history lives there, not on «Статистика».
    await page.waitForSelector('.profile-detail-loading', { state: 'detached', timeout: 20_000 }).catch(() => {});
    view.profileTabs = await page.$$eval('.profile-tabs button, .trader-profile-page button',
      nodes => nodes.map(n => n.textContent.trim()).filter(Boolean).slice(0, 12)).catch(() => []);
    // The aggregates live on «Статистика» and the history on «Сделки», so
    // each is read on the tab that actually renders it. Reading the chart
    // from the trades tab would report it missing and mean nothing.
    view.statisticsTab = await page.evaluate(() => {
      const root = document.querySelector('.trader-profile-page');
      return {
        chartDrawn: !!root?.querySelector('.profile-chart-line'),
        dailyBars: root?.querySelectorAll('.daily-gain, .daily-loss').length ?? 0,
        metrics: [...(root?.querySelectorAll('.profile-metrics-grid > div') ?? [])]
          .map(d => [d.querySelector('span')?.textContent?.trim(), d.querySelector('strong')?.textContent?.trim()]),
      };
    });
    await page.screenshot({ path: path.join(OUT, `w${width}-06-profile-statistics.png`) });
    await page.getByRole('button', { name: 'Сделки', exact: true }).click({ timeout: 10_000 }).catch(() => {});
    await page.waitForSelector('.profile-trades-panel', { timeout: 20_000 }).catch(() => {});
    await page.locator('.profile-trades-panel').scrollIntoViewIfNeeded().catch(() => {});
    await wait(800);
    view.profile = await page.evaluate(() => {
      const page = document.querySelector('.trader-profile-page');
      if (!page) return null;
      const panel = page.querySelector('.profile-trades-panel');
      const note = panel && panel.querySelector('.trades-hidden-note');
      return {
        name: page.querySelector('.trader-profile-hero h1')?.textContent?.trim() ?? null,
        hasTradesPanel: !!panel,
        tradeRows: panel ? panel.querySelectorAll('tbody tr').length : -1,
        hasTable: panel ? !!panel.querySelector('table') : null,
        hiddenNote: note ? note.textContent.replace(/\s+/g, ' ').trim() : null,
        hiddenNoteHasIcon: note ? !!note.querySelector('svg') : false,
        // The count beside the heading: hidden is not zero.
        headingCount: panel?.querySelector('.profile-panel-heading strong')?.textContent?.trim() ?? null,
        // Aggregates that must survive the redaction.
        heroMetrics: [...page.querySelectorAll('.trader-hero-metrics > div')]
          .map(d => [d.querySelector('span')?.textContent?.trim(), d.querySelector('strong')?.textContent?.trim()]),
        mentionsSubscribers: page.textContent.includes('подписчикам'),
        chartDrawn: !!page.querySelector('.profile-chart-line'),
      };
    });
    await page.screenshot({ path: path.join(OUT, `w${width}-07-profile-trades-hidden.png`), fullPage: false });
    const panel = await page.$('.profile-trades-panel');
    if (panel) await panel.screenshot({ path: path.join(OUT, `w${width}-07-trades-panel.png`) }).catch(() => {});

    if (width === WIDTHS[0]) {
      // Opening a profile is `setView('profile')`, not a navigation — going
      // BACK in history would leave /copy-trading altogether and every card
      // reading would come back null. Use the page's own control.
      await page.click('.back-button').catch(() => {});
      await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 15_000 }).catch(() => {});
      await wait(900);
      view.backToMarketplace = await page.evaluate(FACTS);

      // ── 3/4. a failing refresh keeps both, then one section fails ─────
      await page.route('**/api/v1/copy-trading/marketplace', route =>
        route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'x' }) }));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await wait(1500);
      view.afterFailedRefresh = await page.evaluate(FACTS);
      view.freshnessAfterFail = await page.evaluate(() =>
        document.querySelector('.marketplace-freshness')?.textContent.trim() ?? null);

      await page.unroute('**/api/v1/copy-trading/marketplace');
      await page.route('**/api/v1/copy-trading/marketplace', async route => {
        const response = await route.fetch();
        const body = await response.json();
        // Ksenia alone fails, exactly as the server would report it.
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ...body, ksenia: null, errors: { ksenia: 'temporarily_unavailable' } }) });
      });
      await wait(1200);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await wait(1500);
      view.kseniaOnlyFailed = await page.evaluate(FACTS);
      await page.unroute('**/api/v1/copy-trading/marketplace');

      // ── 5. hard reload repaints from the validated snapshot ──────────
      await page.reload({ waitUntil: 'domcontentloaded' });
      view.reloadFirstPaint = await page.evaluate(FACTS).catch(() => null);
      await wait(1500);
      view.afterReload = await page.evaluate(FACTS);
      await page.screenshot({ path: path.join(OUT, `w${width}-05-after-reload.png`) });

      // ── 6. another account sees nothing of the first ─────────────────
      const other = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      await other.addInitScript(({ token }) => {
        localStorage.setItem('exchange_token', token);
        localStorage.setItem('exchange_lang', 'ru');
      }, { token: userB.token });
      const otherPage = await other.newPage();
      await otherPage.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
      view.otherAccountFirstPaint = await otherPage.evaluate(FACTS).catch(() => null);
      view.otherAccountStoredKeys = await otherPage.evaluate(() =>
        Object.keys(localStorage).filter(k => k.startsWith('voltex.copy.marketplace')));
      await wait(1500);
      view.otherAccountSettled = await otherPage.evaluate(FACTS);
      await other.close();
    }
    await context.close();
  }

  // ── 2. a failed prefetch must not suppress the mount's request ──────
  // Driven through the real store in the page: fail one prefetch, then mount.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(({ token }) => {
      localStorage.setItem('exchange_token', token);
      localStorage.setItem('exchange_lang', 'ru');
    }, { token: userA.token });
    const page = await context.newPage();
    let calls = 0, failFirst = true;
    await page.route('**/api/v1/copy-trading/marketplace', async route => {
      calls++;
      if (failFirst) { failFirst = false; return route.abort('failed'); }
      return route.continue();
    });
    // Land on an unrelated page, hover the nav link to prefetch, then go.
    await page.goto(`${origin}/wallet`, { waitUntil: 'domcontentloaded' });
    await wait(1200);
    const link = await page.$('a[href="/copy-trading"]');
    if (link) { await link.hover().catch(() => {}); }
    await wait(1200);
    const callsAfterPrefetch = calls;
    if (link) await link.click().catch(() => {});
    else await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trader-card[data-trader-id="VX-001"]', { timeout: 15_000 }).catch(() => {});
    await wait(2500);
    report.failedPrefetchThenMount = {
      callsAfterPrefetch, callsAfterMount: calls,
      cards: await page.evaluate(FACTS),
    };
    await page.screenshot({ path: path.join(OUT, 'failed-prefetch-then-mount.png') });
    await context.close();
  }

  // ── 3. no session at all ────────────────────────────────────────────
  // The marketplace endpoint keeps `requireAuth`, which is correct: the data
  // is not public. What must not happen is the visitor being left on a
  // spinner forever because the store returns early when there is no token
  // and never marks itself settled. The guard is the route: /copy-trading is
  // behind RequireAuth, so a visitor with no token is sent to the login page
  // instead of mounting the cards. This asserts that outcome rather than the
  // implementation, so removing the route guard would fail here.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    // Deliberately NO token planted.
    await context.addInitScript(() => { try { localStorage.setItem('exchange_lang', 'ru'); } catch { /* sandboxed */ } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    let marketplaceCalls = 0;
    await page.route('**/api/v1/copy-trading/marketplace', async route => { marketplaceCalls++; await route.continue(); });
    await page.goto(`${origin}/copy-trading`, { waitUntil: 'domcontentloaded' });
    await wait(4000);
    report.noSession = await page.evaluate(() => {
      const body = document.body.innerText || '';
      return {
        path: location.pathname,
        cards: document.querySelectorAll('.trader-card').length,
        // Any element still announcing itself as busy after four seconds.
        busy: document.querySelectorAll('[aria-busy="true"]').length,
        loadingText: /Загрузка/i.test(body),
        bodyHead: body.replace(/\s+/g, ' ').trim().slice(0, 120),
      };
    });
    report.noSession.marketplaceCalls = marketplaceCalls;
    report.noSession.pageErrors = errors;
    await page.screenshot({ path: path.join(OUT, 'no-session.png') });
    await context.close();
  }

  // ── assertions ──────────────────────────────────────────────────────
  for (const [width, view] of Object.entries(report.widths)) {
    const tag = `${width}px`;
    if (view.pageErrors.length) finding(`${tag}: page errors — ${view.pageErrors.join(' | ')}`);
    if (!complete(view.coldOpen?.nazar)) finding(`${tag}: cold open left Nazar incomplete — ${JSON.stringify(view.coldOpen?.nazar)}`);
    if (!complete(view.coldOpen?.ksenia)) finding(`${tag}: cold open left Ksenia incomplete — ${JSON.stringify(view.coldOpen?.ksenia)}`);
    // While the first request is unanswered the card must not pass a verdict.
    if (view.firstPaint?.nazar?.unavailableText) finding(`${tag}: card said «Данные недоступны» before the first response`);

    const p = view.profile;
    if (!p) finding(`${tag}: Ksenia's profile did not open`);
    else {
      if (p.tradeRows > 0) finding(`${tag}: ${p.tradeRows} trade rows are still rendered`);
      if (p.hasTable) finding(`${tag}: the trade TABLE is still in the DOM`);
      if (p.hiddenNote !== 'Информация о сделках скрыта') finding(`${tag}: hidden note reads ${JSON.stringify(p.hiddenNote)}`);
      if (!p.hiddenNoteHasIcon) finding(`${tag}: the hidden note has no icon`);
      if (p.mentionsSubscribers) finding(`${tag}: the profile claims trades are available to subscribers`);
    }
    const stats = view.statisticsTab;
    if (!stats) finding(`${tag}: the statistics tab was never read`);
    else {
      // The aggregates must survive the redaction: a drawn curve and real
      // trade-derived metrics, computed server-side from the full history.
      if (!stats.chartDrawn) finding(`${tag}: the performance chart is missing, so aggregates did not survive`);
      if (!stats.dailyBars) finding(`${tag}: the daily series is empty`);
      const total = stats.metrics.find(([label]) => label === 'Total Trades');
      if (!total || !/[1-9]/.test(total[1] ?? '')) finding(`${tag}: Total Trades reads ${JSON.stringify(total)} — hidden must not be zero`);
      const win = stats.metrics.find(([label]) => label === 'Win Rate');
      if (!win || !/[1-9]/.test(win[1] ?? '')) finding(`${tag}: Win Rate reads ${JSON.stringify(win)}`);
      if (!p.headingCount || /^0 /.test(p.headingCount)) finding(`${tag}: the closed-trade count reads ${JSON.stringify(p.headingCount)} — hidden must not be zero`);
    }

    const ring = view.ring;
    if (!ring?.nazar || !ring?.ksenia) finding(`${tag}: an avatar was missing — ${JSON.stringify(ring)}`);
    else {
      for (const key of ['borderWidth', 'borderStyle', 'borderColor', 'boxShadow']) {
        if (ring.nazar[key] !== ring.ksenia[key]) {
          finding(`${tag}: avatar ${key} differs — Nazar ${JSON.stringify(ring.nazar[key])} vs Ksenia ${JSON.stringify(ring.ksenia[key])}`);
        }
      }
      if (ring.nazar.boxShadow === 'none') finding(`${tag}: Nazar's avatar has no glow`);
      if (ring.nazar.photoCoversRing) finding(`${tag}: Nazar's photo paints over the ring`);
      if (ring.ksenia.photoCoversRing) finding(`${tag}: Ksenia's photo paints over the ring`);
    }
  }
  const first = report.widths[WIDTHS[0]];
  if (first) {
    if (!complete(first.afterFailedRefresh?.nazar) || !complete(first.afterFailedRefresh?.ksenia)) {
      finding('a failed refresh blanked a card instead of keeping its last-good figures');
    }
    if (!complete(first.kseniaOnlyFailed?.nazar)) finding('Ksenia failing removed Nazar');
    if (!complete(first.kseniaOnlyFailed?.ksenia)) finding('Ksenia lost her last-good figures when her section failed');
    if (!complete(first.afterReload?.nazar) || !complete(first.afterReload?.ksenia)) finding('a hard reload did not repaint both cards');
    if ((first.otherAccountStoredKeys || []).length > 1) {
      finding(`another account saw ${first.otherAccountStoredKeys.length} snapshot keys`);
    }
    if (first.otherAccountFirstPaint?.nazar && complete(first.otherAccountFirstPaint.nazar)) {
      finding("another account's first paint already had the first session's figures");
    }
  }
  const prefetch = report.failedPrefetchThenMount;
  if (prefetch) {
    if (prefetch.callsAfterMount <= prefetch.callsAfterPrefetch) {
      finding(`mounting after a failed prefetch put NO request on the wire (${prefetch.callsAfterPrefetch} → ${prefetch.callsAfterMount})`);
    }
    if (!complete(prefetch.cards?.nazar) || !complete(prefetch.cards?.ksenia)) {
      finding('after a failed prefetch the cards never recovered');
    }
  }
  const guest = report.noSession;
  if (!guest) finding('the no-session case was never reached');
  else {
    // Either outcome is acceptable as long as it is DEFINITE: sent to login,
    // or shown a settled page. What fails is a permanent «Загрузка…».
    const left = guest.path !== '/copy-trading';
    if (!left && guest.loadingText) finding('a visitor with no session is left on «Загрузка…»');
    if (!left && guest.busy) finding(`a visitor with no session still has ${guest.busy} busy region(s) after 4s`);
    if (guest.pageErrors.length) finding(`the no-session visit raised ${guest.pageErrors.length} page error(s)`);
  }
  if (report.wire.executionsFound.length) {
    finding(`executions reached the browser: ${report.wire.executionsFound.slice(0, 5).join(', ')}`);
  }
  if (!report.wire.responses) finding('no copy-trading response was captured, so the wire was never checked');

  report.status = report.findings.length ? 'FAIL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, findings: report.findings,
    wire: { responses: report.wire.responses, executions: report.wire.executionsFound.length },
    prefetch: report.failedPrefetchThenMount && {
      callsAfterPrefetch: report.failedPrefetchThenMount.callsAfterPrefetch,
      callsAfterMount: report.failedPrefetchThenMount.callsAfterMount },
    ring: Object.fromEntries(Object.entries(report.widths).map(([w, v]) => [w, v.ring])),
    profile: Object.fromEntries(Object.entries(report.widths).map(([w, v]) => [w, v.profile && {
      rows: v.profile.tradeRows, note: v.profile.hiddenNote, count: v.profile.headingCount }])),
    noSession: report.noSession && { path: report.noSession.path, cards: report.noSession.cards,
      busy: report.noSession.busy, loadingText: report.noSession.loadingText,
      marketplaceCalls: report.noSession.marketplaceCalls },
  }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  server?.close();
});
