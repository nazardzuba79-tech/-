'use strict';
/** Copy Trading last-good snapshot — browser regression.
 *
 * Drives the production frontend bundle in Chromium against the ACTUAL
 * compiled marketplace router, CopyPerformanceService and requireAuth, with
 * an in-memory database only (no DATABASE_URL, no production secret, no
 * financial writes). Every Nazar/Ksenia figure on screen comes from the
 * canonical service; nothing here invents ROI, PnL, AUM or followers.
 *
 * What it proves, in order:
 *  1-4  an authenticated visit paints both cards from the live response and
 *       persists a validated snapshot keyed by the session digest;
 *  5-9  a HARD RELOAD with the marketplace API held open paints Nazar and
 *       Ksenia — ROI, followers, AUM, drawdown, sparkline — from that
 *       snapshot at the first commit: no skeleton, no "Данные недоступны",
 *       no real → skeleton → real transition;
 * 10-11 Ksenia's profile opened BEFORE the API answers uses the same
 *       validated state (hero metrics, chart, readouts), not an empty shell;
 * 12    navigating away and back keeps the confirmed values available;
 * 13    a failed (503) and an invalid (200, malformed) refresh keep both
 *       sections' last-good values, flagged stale, never replaced by dashes;
 * 14    another token and a logout never see the first session's snapshot.
 *
 * Build first: `npx tsc -p tsconfig.json` (backend → dist) and the frontend
 * with VITE_API_URL unset or /api/v1. Evidence: docs/qa/copy-last-good-browser/.
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
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { copyPerformanceRouter } = require('../dist/api/routes/copyPerformance');
const { CopyPerformanceService } = require('../dist/services/copyTrading/CopyPerformanceService');
const { requireAuth } = require('../dist/api/middleware/auth');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const OUT = path.resolve('docs/qa/copy-last-good-browser');
fs.mkdirSync(OUT, { recursive: true });
const date = process.env.QA_COPY_DATE || new Date().toISOString().slice(0, 10);
const CACHE_PREFIX = 'voltex.copy.marketplace.v1.';
const STALE_TEXT = 'Данные требуют обновления. Показаны последние загруженные значения.';
const report = { startedAt: new Date().toISOString(), date, environment: 'LOCAL QA ONLY — actual router/service, in-memory persistence',
  firstVisit: {}, persisted: {}, reload: {}, profile: {}, navigate: {}, failedRefresh: {}, invalidRefresh: {}, otherToken: {}, logout: {},
  marketplaceRequests: [], pageErrors: [], findings: [] };
const finding = text => report.findings.push(text);
// Same digest the app keys the snapshot by (copyMarketplaceCache.ts): FNV-1a
// over the token, so each key on disk can be attributed to a session here.
const fingerprint = session => { let hash = 0x811c9dc5; for (let i = 0; i < session.length; i++) { hash ^= session.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(36); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

// What the viewer sees on a featured card. Read from the DOM the way a user
// reads it: the rendered text of each labelled figure, plus whether any
// reserved metric is still a dash and whether the sparkline is drawn.
const cardFacts = id => {
  const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
  if (!card) return null;
  const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const stat = label => text([...card.querySelectorAll('.card-stats > div')].find(div => div.textContent.includes(label))?.querySelector('strong'));
  const meta = label => text([...card.querySelectorAll('.card-meta > div')].find(div => div.textContent.includes(label))?.querySelector('b'));
  return {
    name: text(card.querySelector('h3')),
    roi: text(card.querySelector('.card-roi-copy strong')),
    followers: id === 'VX-001' ? meta('Подписчики') : text(card.querySelector('.trader-name-row p .copy-live-metric')),
    aum: meta('AUM'),
    drawdown: stat('Просадка'),
    winRate: stat('Win Rate'),
    copierProfit: id === 'VX-001' ? null : meta('Прибыль подписчиков'),
    sparkline: card.querySelector('.mini-chart-line')?.getAttribute('d') || null,
    unavailable: card.querySelectorAll('[data-unavailable]').length,
    skeleton: card.querySelectorAll('.copy-chart-skeleton, .copy-metric-skeleton').length,
    unavailableText: card.textContent.includes('Данные недоступны'),
    copyButton: text(card.querySelector('.button-copy')),
  };
};
const profileFacts = () => {
  const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const page = document.querySelector('.trader-profile-page');
  if (!page) return null;
  return {
    name: text(page.querySelector('.trader-profile-hero h1')),
    hero: [...page.querySelectorAll('.trader-hero-metrics > div')].map(div => [text(div.querySelector('span')), text(div.querySelector('strong'))]),
    readouts: text(page.querySelector('.profile-performance-chart .chart-readouts')),
    chart: !!page.querySelector('.profile-chart-line'),
    dailyBars: page.querySelectorAll('.daily-gain, .daily-loss').length,
    loading: !!page.querySelector('.profile-detail-loading'),
    skeleton: page.querySelectorAll('.copy-chart-skeleton, .copy-metric-skeleton').length,
    unavailable: page.querySelectorAll('[data-unavailable]').length,
  };
};
const PROFILE = `(${profileFacts})()`;
// Both cards in ONE evaluation: a single DOM snapshot, never two reads that a
// commit in between could make disagree.
const FACTS = `(() => ({ nazar: (${cardFacts})('VX-001'), ksenia: (${cardFacts})('VX-KSENIA') }))()`;
const facts = page => page.evaluate(FACTS);
const freshness = page => page.evaluate(() => document.querySelector('.marketplace-freshness')?.textContent.trim() ?? null);
const timeline = page => page.evaluate(() => window.__copyQa?.timeline ?? []);
const known = value => typeof value === 'string' && value.length > 0 && !value.includes('—');
const complete = f => !!f && !!f.sparkline && known(f.roi) && known(f.followers) && known(f.aum) && known(f.drawdown);
const sameFigures = (a, b) => !a || !b ? [`card missing: ${JSON.stringify(a && b)}`] : ['roi', 'followers', 'aum', 'drawdown', 'winRate', 'copierProfit', 'sparkline']
  .filter(key => a[key] !== b[key]).map(key => `${key}: ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
/** A card must never show real figures, then a skeleton, then real figures
 * again. Once its chart is drawn, every later DOM commit must still have it
 * and must not have grown a placeholder. */
const noRegression = (events, id) => {
  const own = events.filter(event => event.id === id && event.state);
  const firstDrawn = own.findIndex(event => event.state.chart);
  if (firstDrawn < 0) return `${id}: chart never drawn`;
  const baseline = own[firstDrawn].state.unavailable;
  const regressed = own.slice(firstDrawn + 1).find(event => !event.state.chart || event.state.skeleton > 0 || event.state.unavailable > baseline);
  return regressed ? `${id}: regressed at ${regressed.t}ms to ${JSON.stringify(regressed.state)}` : null;
};
const paintedFromCache = (events, id) => {
  const first = events.find(event => event.id === id && event.state);
  return first && first.state.chart && first.state.skeleton === 0 ? null : `${id}: first commit was ${JSON.stringify(first?.state ?? null)}`;
};

let server, browser;
(async () => {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('frontend/dist is missing; build the frontend first');
  const fixture = localDatabase();
  const userA = fixture.account(), userB = fixture.account(), userC = fixture.account();
  report.sessions = { A: fingerprint(userA.token), B: fingerprint(userB.token), C: fingerprint(userC.token) };
  const owner = key => Object.entries(report.sessions).find(([, digest]) => key.endsWith('.' + digest))?.[0] ?? 'unknown';
  const keysOwned = async page => {
    const current = await page.evaluate(() => localStorage.getItem('exchange_token'));
    return { token: current === null ? 'none' : owner('.' + fingerprint(current)), keys: (await storedKeys(page)).map(key => `${owner(key)}:${key}`) };
  };
  report.keysByPhase = {};
  const service = new CopyPerformanceService(fixture.db, () => new Date(`${date}T12:00:00Z`));
  const app = express();
  const writes = [];
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) { writes.push(`${req.method} ${req.path}`); return res.status(405).json({ error: 'Local QA is read-only' }); }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use('/api/v1', copyPerformanceRouter(fixture.db, service));
  const auth = requireAuth(fixture.db);
  app.get('/api/v1/me', auth, (req, res) => res.json({ id: req.userId, email: 'qa-fixture@example.invalid', displayName: 'Local QA',
    avatarUrl: null, isAdmin: false, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: `${date}T00:00:00Z` }));
  app.get('/api/v1/wallet/portfolio-history', auth, (_req, res) => res.json({ points: [{ date, totalValueUsd: '0' }] }));
  app.get(['/api/v1/balances', '/api/v1/futures/balances'], auth, (_req, res) => res.json([]));
  app.get('/api/v1/support/conversations/mine', auth, (_req, res) => res.json({ conversation: null }));
  // Unrelated market universe: explicitly empty, never invented.
  app.get('/api/v1/market/external/tickers', (_req, res) => res.json({ source: 'qa', tickers: [] }));
  app.use('/api/v1', (req, res) => res.status(404).json({ error: 'Unrelated endpoint, not part of this QA', path: req.path }));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  // The marketplace API is intercepted at the browser edge, so the server
  // stays the real one: "hold" keeps a reload's request unanswered, "fail"
  // answers 503, "invalid" answers 200 with sections that cannot validate.
  let mode = 'live', phase = 'firstVisit';
  const held = [];
  const release = async () => { mode = 'live'; for (const route of held.splice(0)) await route.continue().catch(() => {}); };
  async function contextFor(token) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    // The session token is planted once per tab; a later logout must be
    // able to clear it without this script putting it back on reload.
    await context.addInitScript(({ token }) => {
      if (!sessionStorage.getItem('qa-token-planted')) { localStorage.setItem('exchange_token', token); sessionStorage.setItem('qa-token-planted', '1'); }
      localStorage.setItem('exchange_lang', 'ru');
    }, { token });
    // Observe every DOM commit of the two featured cards from document start.
    await context.addInitScript(() => {
      const qa = window.__copyQa = { timeline: [] };
      const last = {};
      const sample = () => {
        for (const id of ['VX-001', 'VX-KSENIA']) {
          const card = document.querySelector(`.trader-card[data-trader-id="${id}"]`);
          const state = card ? { chart: !!card.querySelector('.mini-chart-line'),
            skeleton: card.querySelectorAll('.copy-chart-skeleton, .copy-metric-skeleton').length,
            unavailable: card.querySelectorAll('[data-unavailable]').length } : null;
          const key = JSON.stringify(state);
          if (last[id] !== key) { last[id] = key; qa.timeline.push({ id, t: Math.round(performance.now()), state }); }
        }
      };
      const start = () => { new MutationObserver(sample).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); sample(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/v1/copy-trading/marketplace') {
        report.marketplaceRequests.push({ phase, mode, at: new Date().toISOString() });
        if (mode === 'hold') { held.push(route); return; }
        if (mode === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'QA forced failure' }) });
        if (mode === 'invalid') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          nazar: { trader: { id: 'VX-001', name: 'Nazar' }, analytics: 'corrupt' }, ksenia: { trader: { id: 'VX-KSENIA' } },
          identities: [], generatedAt: new Date().toISOString(), errors: {} }) });
      }
      return route.continue();
    });
    return context;
  }
  const openPage = async context => { const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message)); return page; };
  const cardsDrawn = async page => {
    await page.locator('.trader-card[data-trader-id="VX-001"] .mini-chart-line').waitFor({ timeout: 90000 });
    await page.locator('.trader-card[data-trader-id="VX-KSENIA"] .mini-chart-line').waitFor({ timeout: 90000 });
  };
  const settled = page => page.waitForFunction(() => { const text = document.querySelector('.marketplace-freshness')?.textContent.trim(); return text !== undefined && !text.includes('Загрузка'); }, null, { timeout: 30000 });
  const storedKeys = page => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).sort(), CACHE_PREFIX);

  // 1-3. Authenticated visit: real-shaped Nazar + Ksenia, cards really drawn.
  const contextA = await contextFor(userA.token);
  const page = await openPage(contextA);
  let start = Date.now();
  await page.goto(origin + '/copy-trading', { waitUntil: 'domcontentloaded' });
  await cardsDrawn(page); await settled(page);
  const live = await facts(page);
  report.firstVisit = { readyMs: Date.now() - start, facts: live, freshness: await freshness(page), marketplaceRequests: report.marketplaceRequests.length };
  if (!complete(live.nazar) || !complete(live.ksenia)) finding('Live cards are not complete: ' + JSON.stringify(live));
  if (live.nazar.name !== 'Nazar' || live.ksenia.name !== 'Ksenia') finding('Featured cards are not Nazar and Ksenia: ' + JSON.stringify([live.nazar.name, live.ksenia.name]));
  // Reference profile from the live state, for the cached profile to match.
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"] .card-view-button').click();
  await page.getByRole('heading', { name: 'Ksenia', exact: true }).waitFor();
  await page.locator('.profile-analytics-workspace .profile-chart-line').waitFor({ timeout: 15000 });
  const profileLive = await page.evaluate(PROFILE);
  report.firstVisit.profile = profileLive;
  await page.locator('.back-button').click();
  await cardsDrawn(page);

  // 4. The snapshot is persisted for this session only, without the token.
  const keys = await storedKeys(page);
  report.keysByPhase.firstVisit = await keysOwned(page);
  if (keys.length === 1 && owner(keys[0]) !== 'A') finding(`The persisted key belongs to ${owner(keys[0])}, not to session A`);
  const raw = keys.length === 1 ? await page.evaluate(key => localStorage.getItem(key), keys[0]) : null;
  const record = raw ? JSON.parse(raw) : null;
  report.persisted = { keys, bytes: raw?.length ?? 0, nazar: record?.nazar?.trader?.id ?? null, ksenia: record?.ksenia?.trader?.id ?? null,
    fetchedAt: record?.fetchedAt ?? null, carriesToken: !!raw && raw.includes(userA.token), carriesRequestState: !!raw && /"(refreshing|settled)"/.test(raw) };
  if (keys.length !== 1) finding('Expected exactly one persisted marketplace snapshot, found ' + JSON.stringify(keys));
  if (report.persisted.nazar !== 'VX-001' || report.persisted.ksenia !== 'VX-KSENIA') finding('Persisted snapshot is missing a section: ' + JSON.stringify(report.persisted));
  if (report.persisted.carriesToken) finding('The session token was written into the snapshot');
  if (report.persisted.carriesRequestState) finding('Request state was written into the snapshot');

  // 5-9. HARD RELOAD with the marketplace API held open: painted from cache.
  phase = 'reload'; mode = 'hold';
  start = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor({ timeout: 30000 });
  const painted = await facts(page);
  const paintMs = Date.now() - start;
  await wait(500); // give a wrong implementation the chance to swap in a skeleton
  const events = await timeline(page);
  report.reload = { paintMs, facts: painted, freshness: await freshness(page), heldRequests: held.length, timeline: events,
    marketplaceResponsesDelivered: 0 };
  for (const id of ['nazar', 'ksenia']) {
    const diff = sameFigures(live[id], painted[id]);
    if (diff.length) finding(`${id} painted from cache differs from the live figures: ${diff.join('; ')}`);
    if (!complete(painted[id])) finding(`${id} is not complete before the API answered: ${JSON.stringify(painted[id])}`);
    if (painted[id].skeleton || painted[id].unavailable > live[id].unavailable) finding(`${id} shows a placeholder before the API answered: ${JSON.stringify(painted[id])}`);
    if (painted[id].unavailableText) finding(`${id} shows "Данные недоступны" despite a valid last-good snapshot`);
  }
  for (const id of ['VX-001', 'VX-KSENIA']) {
    const first = paintedFromCache(events, id); if (first) finding('Reload did not paint from cache at the first commit — ' + first);
    const regressed = noRegression(events, id); if (regressed) finding('real → skeleton → real transition on reload — ' + regressed);
  }
  // Capture with the featured cards in view: what a reviewer needs to see is
  // Nazar and Ksenia carrying figures while the status line still says the
  // live data is loading.
  await page.evaluate(() => document.querySelector('.market-controls')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(OUT, 'reload-before-api-1440.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  report.keysByPhase.reload = await keysOwned(page);

  // 10-11. Ksenia's profile BEFORE the API answers: same validated state.
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"] .card-view-button').click();
  await page.getByRole('heading', { name: 'Ksenia', exact: true }).waitFor();
  await page.locator('.profile-analytics-workspace').waitFor({ timeout: 10000 });
  const profileCached = await page.evaluate(PROFILE);
  report.profile = { facts: profileCached, heldRequests: held.length, freshness: await freshness(page) };
  if (!profileCached.chart) finding('Ksenia profile opened before the API answered has no performance chart');
  if (JSON.stringify(profileCached.hero) !== JSON.stringify(profileLive.hero)) finding(`Profile hero metrics differ from the live state: ${JSON.stringify(profileLive.hero)} → ${JSON.stringify(profileCached.hero)}`);
  if (profileCached.readouts !== profileLive.readouts) finding(`Profile readouts differ from the live state: ${profileLive.readouts} → ${profileCached.readouts}`);
  if (profileCached.dailyBars !== profileLive.dailyBars) finding(`Profile daily bars differ: ${profileLive.dailyBars} → ${profileCached.dailyBars}`);
  // A figure the live profile itself shows as unknown (the owner-reported
  // trade has no holding time) stays unknown; only a NEW placeholder counts.
  if (profileCached.skeleton > profileLive.skeleton || profileCached.unavailable > profileLive.unavailable) finding('Profile shows placeholders the live state did not: ' + JSON.stringify(profileCached));
  if (held.length < 1) finding('The reload never asked the marketplace API (nothing was held), so "before the API answered" is unproven');
  await page.screenshot({ path: path.join(OUT, 'profile-before-api-1440.png') });

  // 12. Navigate away and back: confirmed values are still there.
  await page.locator('.back-button').click();
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor();
  const navigateFrom = await page.evaluate(() => window.__copyQa.timeline.length);
  const away = page.locator('a[href="/card"]').first();
  if (await away.count()) await away.click(); else await page.goto(origin + '/card', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/card');
  // URL can change before the lazy route has actually unmounted. Wait for
  // the old Copy Trading cards to leave before navigating back, otherwise
  // return locators can match stale DOM and make this regression flaky.
  await page.locator('.trader-card[data-trader-id="VX-001"]').waitFor({ state: 'detached', timeout: 30000 });
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor({ state: 'detached', timeout: 30000 });
  const backLink = page.locator('a[href="/copy-trading"]').first();
  if (await backLink.count()) await backLink.click(); else await page.goto(origin + '/copy-trading', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/copy-trading');
  await page.locator('.trader-card[data-trader-id="VX-001"]').waitFor({ timeout: 30000 });
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor({ timeout: 30000 });
  await page.locator('.marketplace-freshness').waitFor();
  const back = await facts(page);
  // Every DOM commit of both cards since leaving: after the page came back,
  // a card that is drawn must stay drawn — no blank commit in between.
  const sinceLeaving = (await timeline(page)).slice(navigateFrom);
  report.navigate = { url: page.url(), cards: await page.evaluate(() => [...document.querySelectorAll('.trader-card[data-trader-id]')].map(el => el.dataset.traderId)),
    facts: back, freshness: await freshness(page), heldRequests: held.length, timeline: sinceLeaving };
  for (const id of ['VX-001', 'VX-KSENIA']) {
    const own = sinceLeaving.filter(event => event.id === id);
    const returned = own.findIndex(event => event.state && event.state.chart);
    if (returned < 0) finding(`${id} was never drawn again after navigating back`);
    else if (own.slice(returned + 1).some(event => !event.state || !event.state.chart || event.state.skeleton > 0)) finding(`${id} flashed away after navigating back: ${JSON.stringify(own.slice(returned))}`);
  }
  for (const id of ['nazar', 'ksenia']) {
    const diff = sameFigures(live[id], back[id]);
    if (diff.length) finding(`${id} after navigating away and back differs: ${diff.join('; ')}`);
    if (!back[id] || back[id].skeleton || !complete(back[id])) finding(`${id} lost its confirmed values after navigating away and back: ${JSON.stringify(back[id])}`);
  }

  // Let the held request through so the store is settled and live again.
  await release(); await settled(page);
  report.reload.marketplaceResponsesDelivered = 1;

  // 13a. A failed live refresh (503) keeps every last-good figure.
  const refresh = async next => {
    mode = next; await wait(1100); // the store collapses attempts closer than 1s
    const before = report.marketplaceRequests.length;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(count => window.__copyQa && performance.now() > 0 && count >= 0, before, { timeout: 1000 }).catch(() => {});
    await page.waitForFunction(text => document.querySelector('.marketplace-freshness')?.textContent.trim() === text, STALE_TEXT, { timeout: 20000 });
    return { requests: report.marketplaceRequests.length - before, facts: await facts(page), freshness: await freshness(page), timeline: await timeline(page) };
  };
  phase = 'failedRefresh';
  report.failedRefresh = await refresh('fail');
  for (const id of ['nazar', 'ksenia']) {
    const diff = sameFigures(live[id], report.failedRefresh.facts[id]);
    if (diff.length) finding(`${id} changed after a failed refresh: ${diff.join('; ')}`);
    if (report.failedRefresh.facts[id].skeleton || !complete(report.failedRefresh.facts[id])) finding(`${id} was blanked by a failed refresh: ${JSON.stringify(report.failedRefresh.facts[id])}`);
  }
  if (report.failedRefresh.requests < 1) finding('The failed-refresh phase issued no marketplace request');
  // Back to live, then an invalid (200 but malformed) refresh.
  await release(); await wait(1100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('.marketplace-freshness')?.textContent.trim() === '', null, { timeout: 20000 });
  phase = 'invalidRefresh';
  report.invalidRefresh = await refresh('invalid');
  for (const id of ['nazar', 'ksenia']) {
    const diff = sameFigures(live[id], report.invalidRefresh.facts[id]);
    if (diff.length) finding(`${id} changed after an invalid refresh: ${diff.join('; ')}`);
    if (report.invalidRefresh.facts[id].skeleton || !complete(report.invalidRefresh.facts[id])) finding(`${id} was blanked by an invalid refresh: ${JSON.stringify(report.invalidRefresh.facts[id])}`);
  }
  for (const id of ['VX-001', 'VX-KSENIA']) {
    const regressed = noRegression(report.invalidRefresh.timeline, id);
    if (regressed) finding('A refresh swapped a card for a skeleton — ' + regressed);
  }
  mode = 'live';
  report.keysByPhase.afterRefreshes = await keysOwned(page);

  // 14a. Another token in a fresh tab sees nothing of the first session.
  phase = 'otherToken'; mode = 'hold';
  const contextB = await contextFor(userB.token);
  const pageB = await openPage(contextB);
  await pageB.goto(origin + '/copy-trading', { waitUntil: 'domcontentloaded' });
  await pageB.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor({ timeout: 30000 });
  await wait(500);
  const other = await facts(pageB);
  report.otherToken = { facts: other, keysVisible: await storedKeys(pageB), heldRequests: held.length };
  for (const id of ['nazar', 'ksenia']) {
    if (complete(other[id]) || other[id].sparkline) finding(`Another session was shown the first session's ${id} snapshot: ${JSON.stringify(other[id])}`);
  }
  if (report.otherToken.keysVisible.length !== 0) finding('A snapshot key exists before the second session ever received data: ' + JSON.stringify(report.otherToken.keysVisible));
  await release(); await cardsDrawn(pageB); await settled(pageB);
  report.otherToken.afterOwnResponse = await facts(pageB);
  report.otherToken.keysAfterOwnResponse = await storedKeys(pageB);
  if (!complete(report.otherToken.afterOwnResponse.ksenia)) finding('The second session did not paint from its own response');
  await contextB.close();

  // 14b. Logout in the first tab, then a third token: nothing of A is shown.
  phase = 'logout'; mode = 'live';
  await page.locator('.top-nav-profile-btn').click();
  await page.locator('.top-nav-profile-menu button').click();
  await page.waitForURL(url => new URL(url).pathname === '/');
  report.logout = { tokenCleared: await page.evaluate(() => localStorage.getItem('exchange_token') === null), keysAfterLogout: (await keysOwned(page)).keys };
  report.keysByPhase.afterLogout = { token: 'none', keys: report.logout.keysAfterLogout };
  // Leaving a session takes its snapshot with it, at once — not on the next
  // visit to the marketplace.
  if (report.logout.keysAfterLogout.some(key => key.startsWith('A:'))) finding('The logged-out session\'s snapshot is still on disk after logout: ' + JSON.stringify(report.logout.keysAfterLogout));
  if (!report.logout.tokenCleared) finding('Logout did not clear the session token');
  mode = 'hold';
  await page.evaluate(token => localStorage.setItem('exchange_token', token), userC.token);
  await page.goto(origin + '/copy-trading', { waitUntil: 'domcontentloaded' });
  await page.locator('.trader-card[data-trader-id="VX-KSENIA"]').waitFor({ timeout: 30000 });
  await wait(500);
  const third = await facts(page);
  report.logout.thirdSession = { facts: third, heldRequests: held.length };
  for (const id of ['nazar', 'ksenia']) {
    if (complete(third[id]) || third[id].sparkline) finding(`After logout a new session was shown the old ${id} snapshot: ${JSON.stringify(third[id])}`);
  }
  await release(); await cardsDrawn(page); await settled(page);
  report.logout.thirdSession.afterOwnResponse = await facts(page);
  report.keysByPhase.afterThirdSession = await keysOwned(page);
  if (Object.values(report.keysByPhase).some(entry => entry.keys.some(key => key.startsWith('unknown:')))) finding('A snapshot key belongs to no session this QA created: ' + JSON.stringify(report.keysByPhase));
  await contextA.close();

  report.readOnly = writes.length === 0; report.writes = writes;
  if (writes.length) finding('The QA server received write requests: ' + writes.join(', '));
  if (report.pageErrors.length) finding(`Page errors: ${report.pageErrors.join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const summary = { firstVisitMs: report.firstVisit.readyMs, reloadPaintMs: report.reload.paintMs, reloadHeld: report.reload.heldRequests,
    reloadFacts: { nazar: painted.nazar.roi, ksenia: painted.ksenia.roi, kseniaAum: painted.ksenia.aum, kseniaFollowers: painted.ksenia.followers, kseniaDrawdown: painted.ksenia.drawdown },
    profileBeforeApi: { chart: profileCached.chart, hero: profileCached.hero }, failedRefresh: report.failedRefresh.freshness,
    otherToken: { kseniaShown: complete(other.ksenia) }, logout: { thirdSessionKseniaShown: complete(third.ksenia), keysAfterLogout: report.logout.keysAfterLogout },
    keysByPhase: Object.fromEntries(Object.entries(report.keysByPhase).map(([phase, entry]) => [phase, `${entry.token} → ${entry.keys.map(key => key.split(':')[0]).join(',') || 'none'}`])),
    pageErrors: report.pageErrors.length, findings: report.findings };
  console.log('COPY_LAST_GOOD_BROWSER ' + JSON.stringify(summary));
  if (report.findings.length) process.exitCode = 1;
})().catch(error => {
  report.findings.push(error instanceof Error ? error.stack : String(error));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
