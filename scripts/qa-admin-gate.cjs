#!/usr/bin/env node
/*
 * Browser QA for the /admin access gate and the Users page activity states.
 *
 * Runs the real production bundle (frontend/dist) against a local fixture API.
 * Nothing here talks to Render, Neon or any production service; every account,
 * email and amount is synthetic.
 *
 * Scenarios (each at 390 and 1440 px):
 *   success · 401 · 403 · 503 · network error · hung /me (timeout) · retry ·
 *   summary failing first time · summary failing after a good active read ·
 *   visible admin activity, hidden suspension and failed wake read retaining data · session revoked
 *   (401 on a privileged read) · token replaced by a non-admin account.
 *
 * Env: QA_PLAYWRIGHT_MODULE (playwright path), QA_CHROMIUM (optional browser
 * binary), QA_OUT (evidence dir; default docs/qa/admin-gate).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const dist = path.resolve(process.env.QA_FRONTEND_DIST || path.join(root, 'frontend/dist'));
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/admin-gate'));
const ADMIN_TOKEN = 'qa-admin-token';
const USER_TOKEN = 'qa-user-token';
const HOUR = 3_600_000;

// Mutable fixture state, changed between steps by the harness.
const state = {
  me: 'admin', // admin | user | 401 | 403 | 503 | network | hang | malformed
  activity: 'ok', // ok | 503 | network
  users: 'ok', // ok | 401
  calls: { me: 0, users: 0, activity: 0, alerts: 0, privilegedBeforeOk: 0 },
  meAnswered: false,
};
const hung = new Set();

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const customers = [
  { id: 'u-ready', email: 'ready@example.invalid', createdAt: iso(40 * 24 * HOUR), balances: [{ asset: 'USDT', available: '100.5', locked: '0' }] },
  { id: 'u-topup', email: 'topup@example.invalid', createdAt: iso(1 * HOUR), balances: [] },
  { id: 'u-fresh', email: 'fresh@example.invalid', createdAt: iso(2 * HOUR), balances: [] },
  { id: 'u-old', email: 'old@example.invalid', createdAt: iso(30 * 24 * HOUR), balances: [] },
].map((u) => ({ role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', registrationIp: null, lastLoginAt: iso(3 * HOUR), isBlocked: false, blockedAt: null, blockedReason: null, ...u }));
const pkg = (userId, total, st, msAgo) => ({ key: `${userId}|tron|USDT`, userId, chain: 'tron', asset: 'USDT', state: st, total, transferCount: 1, unconfirmedTotal: '0', unconfirmedCount: 0, remaining: st === 'READY' ? '0' : String(300 - Number(total)), remainingUsd: null, minimumReached: st === 'READY', latestAt: iso(msAgo) });
const activity = () => ({
  asOf: new Date().toISOString(), totalUsers: customers.length, newUsers24h: 2, pendingKyc: 0, minDepositUsd: 300,
  counts: { UNATTRIBUTED: 1, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 1, READY: 1, NEEDS_REVIEW: 0 },
  packages: [pkg('u-ready', '2500', 'READY', 3 * HOUR), pkg('u-topup', '35', 'AWAITING_TOPUP', HOUR / 2)],
  awaitingConfirmationsByUser: {},
});
const summary = () => {
  const asOf = new Date().toISOString();
  const widgets = Object.fromEntries([
    ['readyPackages', 1, 'packages', '/admin/deposits?state=READY'], ['pendingPackages', 2, 'packages', '/admin/deposits'],
    ['unlinkedTransfers', 1, 'transfers', '/admin/deposits?state=UNATTRIBUTED'], ['activeWithdrawals', 0, 'withdrawals', '/admin/withdrawals?status=active'],
    ['pendingKyc', 0, 'users', '/admin/kyc?status=PENDING'], ['openOtc', 0, 'requests', '/admin/otc?status=active'],
    ['totalUsers', customers.length, 'users', '/admin/users'], ['newUsers24h', 2, 'users', '/admin/users?status=new'],
  ].map(([key, value, unit, href]) => [key, { value, unit, href, status: 'ready', asOf }]));
  return { asOf, widgets, alerts: { depositId: null, withdrawalId: null, kycId: null } };
};

function api() {
  const r = express.Router();
  const token = (req) => (req.get('authorization') || '').replace(/^Bearer /, '');
  const fail = (res, how) => {
    if (how === 'network') return res.status(599).json({ error: 'network scenarios are aborted in the browser' });
    if (how === 'hang') { hung.add(res); res.on('close', () => hung.delete(res)); return; }
    res.status(Number(how)).json({ error: 'fixture failure' });
  };
  r.get('/me', (req, res) => {
    state.calls.me++;
    const t = token(req);
    if (state.me === 'admin' || state.me === 'user') {
      if (t !== ADMIN_TOKEN && t !== USER_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
      state.meAnswered = true;
      const isAdmin = t === ADMIN_TOKEN && state.me === 'admin';
      return res.json({ id: isAdmin ? 'a-1' : 'c-9', email: isAdmin ? 'owner@example.invalid' : 'customer@example.invalid', displayName: isAdmin ? 'QA Admin' : null, phone: null, country: null, avatarUrl: null, isAdmin, kycStatus: 'NOT_STARTED', twoFactorEnabled: false, createdAt: iso(90 * 24 * HOUR) });
    }
    if (state.me === 'malformed') return res.json({ email: 'owner@example.invalid' });
    return fail(res, state.me);
  });
  // Every admin route: count requests made before the gate confirmed ADMIN.
  r.use('/admin', (req, res, next) => {
    if (!state.meAnswered) state.calls.privilegedBeforeOk++;
    if (token(req) !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
  r.get('/admin/users', (req, res) => { state.calls.users++; if (state.users !== 'ok') return fail(res, state.users); res.json(customers); });
  r.get('/admin/users/page', (req, res) => {
    state.calls.users++; if (state.users !== 'ok') return fail(res, state.users);
    const search = String(req.query.search ?? '').toLowerCase(), page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const matches = customers.filter(user => !search || user.email.toLowerCase().includes(search) || user.id.toLowerCase().includes(search));
    res.json({ items: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize, totalPages: Math.max(1, Math.ceil(matches.length / pageSize)), asOf: new Date().toISOString() });
  });
  r.get('/admin/work-summary', (req, res) => { state.calls.activity++; if (state.activity !== 'ok') return fail(res, state.activity); res.json(summary()); });
  r.get('/admin/user-activity', (req, res) => { state.calls.activity++; if (state.activity !== 'ok') return fail(res, state.activity); res.json(activity()); });
  r.get('/admin/deposits/recent-by-user', (req, res) => res.json([]));
  r.get('/admin/alerts-summary', (req, res) => { state.calls.alerts++; res.json({ depositId: null, withdrawalId: null, kycId: null }); });
  r.use((req, res) => res.status(404).json({ error: `fixture: ${req.method} ${req.path}` }));
  return r;
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'build the frontend first (npm run build --prefix frontend)');
  fs.mkdirSync(out, { recursive: true });
  const app = express();
  app.use('/api/v1', api());
  app.use(express.static(dist, { index: false }));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = http.createServer(app);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
  const results = [];
  const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

  const reset = (patch = {}) => {
    Object.assign(state, { me: 'admin', activity: 'ok', users: 'ok', meAnswered: false, calls: { me: 0, users: 0, activity: 0, alerts: 0, privilegedBeforeOk: 0 } }, patch);
    for (const res of hung) res.socket?.destroy();
  };
  async function open(width, height, { tokenValue = ADMIN_TOKEN, clock = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    await context.addInitScript((t) => { if (t && !sessionStorage.getItem('qa-seeded')) { localStorage.setItem('exchange_token', t); sessionStorage.setItem('qa-seeded', '1'); } }, tokenValue);
    const page = await context.newPage();
    // A real network failure as the page sees it: the request never gets a response.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort('blockedbyclient');
      const failing = (url.pathname.endsWith('/me') && state.me === 'network')
        || (url.pathname.endsWith('/admin/work-summary') && state.activity === 'network');
      if (!failing) return route.continue();
      if (url.pathname.endsWith('/me')) state.calls.me++; else state.calls.activity++;
      return route.abort('failed');
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (clock) await page.clock.install();
    return { context, page, errors };
  }
  const gate = (page) => page.evaluate(() => document.querySelector('[data-admin-gate]')?.getAttribute('data-admin-gate') ?? null);
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const w = `@${width}`;
    const readySelector = width <= 767 ? '[data-user-card="u-ready"]' : '[data-user-row="u-ready"]';
    // 1. success
    reset();
    let s = await open(width, height);
    await s.page.goto(`${base}/admin/users`);
    await s.page.waitForSelector(readySelector);
    record(`success${w}`, (await gate(s.page)) === null && state.calls.privilegedBeforeOk === 0 && (await overflow(s.page)) <= 1 && s.errors.length === 0,
      `privileged-before-ok=${state.calls.privilegedBeforeOk} me=${state.calls.me} users=${state.calls.users} activity=${state.calls.activity}`);
    await shot(s.page, `success-${width}`);
    await s.context.close();

    // A brief return to an already authorized Admin page must not enter a
    // full wake at all, even when the session service would be slow/offline.
    reset();
    s = await open(width, height, { clock: true });
    await s.page.goto(`${base}/admin/users`);
    await s.page.locator('.admin-attention-grid strong').first().filter({ hasText: /^1$/ }).waitFor();
    await s.page.waitForFunction(() => !document.querySelector('[data-browser-phase]'));
    const beforeReturns = { ...state.calls };
    state.me = 'hang';
    await s.page.evaluate(() => {
      window.__adminQaHidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__adminQaHidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__adminQaHidden ? 'hidden' : 'visible' });
    });
    for (let i = 0; i < 3; i++) {
      await s.page.evaluate(() => { window.__adminQaHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      await s.page.clock.fastForward(1000);
      await s.page.evaluate(() => { window.__adminQaHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await s.page.locator('[data-browser-phase]').count(), 0, 'brief return displayed the wake notice');
      await s.page.clock.runFor(500);
      await s.page.waitForFunction(() => !document.querySelector('[data-browser-phase]'));
    }
    const unchanged = state.calls.users === beforeReturns.users && state.calls.activity === beforeReturns.activity && state.calls.alerts === beforeReturns.alerts;
    await s.page.getByRole('textbox', { name: 'Поиск пользователей' }).fill('ready');
    assert.equal(await s.page.locator(readySelector).count(), 1, 'Admin input stayed blocked');
    record(`three brief tab returns → no requests, notice or blocked input${w}`,
      unchanged && state.calls.me === beforeReturns.me && s.errors.length === 0,
      `me=${state.calls.me - beforeReturns.me} users=${state.calls.users - beforeReturns.users} activity=${state.calls.activity - beforeReturns.activity} alerts=${state.calls.alerts - beforeReturns.alerts}`);
    await s.context.close();

    // 2-3. 401 / 403 are refusals: the browser leaves /admin
    for (const code of ['401', '403']) {
      reset({ me: code });
      s = await open(width, height);
      await s.page.goto(`${base}/admin/users`);
      await s.page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 10_000 }).catch(() => {});
      const left = !new URL(s.page.url()).pathname.startsWith('/admin');
      record(`${code} refused${w}`, left && state.calls.privilegedBeforeOk === 0 && state.calls.users === 0, `at=${new URL(s.page.url()).pathname}`);
      await s.context.close();
    }

    // 4-5. 503 / network: stay, explain, retry recovers
    for (const how of ['503', 'network', 'malformed']) {
      reset({ me: how });
      s = await open(width, height);
      await s.page.goto(`${base}/admin/users`);
      await s.page.waitForSelector('[data-admin-gate="error"]', { timeout: 10_000 });
      const reason = await s.page.getAttribute('[data-admin-gate-reason]', 'data-admin-gate-reason');
      const meAtError = state.calls.me;
      await s.page.waitForTimeout(3_000);
      const noLoop = state.calls.me === meAtError && meAtError === 1;
      const stayed = new URL(s.page.url()).pathname === '/admin/users' && noLoop;
      const noPrivate = state.calls.users === 0 && state.calls.activity === 0 && !(await s.page.locator('aside').count());
      await shot(s.page, `error-${how}-${width}`);
      state.me = 'admin';
      await s.page.click('[data-admin-gate-retry]');
      await s.page.waitForSelector(readySelector, { timeout: 10_000 });
      record(`${how} → error screen → retry${w}`, stayed && noPrivate && (await overflow(s.page)) <= 1 && s.errors.length === 0, `reason=${reason} me-calls=${state.calls.me}`);
      await s.context.close();
    }

    // 6. hung /me: slow notice at 5 s, aborted and retryable at 15 s
    reset({ me: 'hang' });
    s = await open(width, height);
    const t0 = Date.now();
    await s.page.goto(`${base}/admin/users`);
    await s.page.waitForSelector('[data-admin-gate="checking"]');
    await shot(s.page, `checking-${width}`);
    await s.page.waitForSelector('[data-admin-gate-slow]', { timeout: 9_000 });
    await shot(s.page, `checking-slow-${width}`);
    await s.page.waitForSelector('[data-admin-gate="error"]', { timeout: 20_000 });
    const waited = Date.now() - t0;
    const reason = await s.page.getAttribute('[data-admin-gate-reason]', 'data-admin-gate-reason');
    await shot(s.page, `error-timeout-${width}`);
    state.me = 'admin';
    await s.page.click('[data-admin-gate-retry]');
    await s.page.waitForSelector(readySelector, { timeout: 10_000 });
    record(`hung /me → timeout → retry${w}`, reason === 'TIMEOUT' && waited >= 14_000 && waited < 25_000 && hung.size === 0 && state.calls.users > 0,
      `timeout-after=${Math.round(waited / 1000)}s open-hung-sockets=${hung.size}`);
    await s.context.close();

    // 7. Shared summary fails first time: unknown, not zero; retry is one read.
    reset({ activity: '503' });
    s = await open(width, height);
    await s.page.goto(`${base}/admin/users`);
    await s.page.locator('.admin-attention [role="alert"]').waitFor();
    const unknown = (await s.page.locator('.admin-attention-grid strong').allTextContents()).every(value => value === '—');
    await shot(s.page, `activity-failed-${width}`);
    state.activity = 'ok';
    const before = state.calls.activity;
    await s.page.locator('.admin-attention').getByRole('button', { name: 'Повторить', exact: true }).click();
    await s.page.locator('.admin-attention-grid strong').first().filter({ hasText: /^1$/ }).waitFor();
    record(`summary first read fails → unknown → retry${w}`, unknown && state.calls.activity === before + 1 && !(await s.page.locator('.admin-attention [role="alert"]').count()), `summary-calls=${state.calls.activity}`);
    await s.context.close();

    // 8. A failed shared 30-second refresh retains known values and marks them stale.
    reset();
    s = await open(width, height, { clock: true });
    await s.page.goto(`${base}/admin/users`);
    await s.page.locator('.admin-attention-grid strong').first().filter({ hasText: /^1$/ }).waitFor();
    state.activity = '503';
    const reads = state.calls.activity;
    await s.page.clock.fastForward(30_001);
    await s.page.locator('.admin-attention [role="alert"]').filter({ hasText: 'устареть' }).waitFor();
    const kept = (await s.page.locator('.admin-attention-grid strong').first().textContent()) === '1';
    await shot(s.page, `activity-stale-${width}`);
    record(`summary fails after success → data kept, marked stale${w}`, kept && state.calls.activity === reads + 1, `reads=${state.calls.activity - reads}`);
    await s.context.close();

    // 8b. Visible Admin retains its work queue while an actually hidden tab
    // suspends reads. Wake revalidates the session and keeps known values on failure.
    reset();
    s = await open(width, height, { clock: true });
    await s.page.goto(`${base}/admin/users`);
    await s.page.locator('.admin-attention-grid strong').first().filter({ hasText: /^1$/ }).waitFor();
    await s.page.clock.fastForward(5 * 60_000 + 1);
    assert.equal(await s.page.locator('[data-browser-phase="sleeping"]').count(), 0,
      'visible Admin must not suspend the operator queue due to mouse inactivity');
    await s.page.evaluate(() => {
      window.__adminQaHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__adminQaHidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__adminQaHidden ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await s.page.waitForSelector('[data-browser-phase="sleeping"]', { state: 'attached' });
    const beforeSleep = { ...state.calls };
    await s.page.clock.fastForward(HOUR);
    assert.deepEqual(state.calls, beforeSleep, 'hidden tab issued a scheduled account read');
    state.activity = '503';
    await s.page.evaluate(() => { window.__adminQaHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await s.page.clock.runFor(100);
    await s.page.locator('.admin-attention [role="alert"]').filter({ hasText: 'устареть' }).waitFor();
    const keptAfterWake = (await s.page.locator('.admin-attention-grid strong').first().textContent()) === '1';
    record(`visible admin remains active; hidden defers read → failed wake keeps data${w}`,
      keptAfterWake && state.calls.me === beforeSleep.me + 1 && state.calls.activity === beforeSleep.activity + 1,
      `wake-me=${state.calls.me - beforeSleep.me} wake-activity=${state.calls.activity - beforeSleep.activity}`);
    await shot(s.page, `activity-idle-wake-${width}`);
    await s.context.close();

    // 9. session revoked: a privileged read answers 401 → token cleared, admin left
    reset({ users: '401' });
    s = await open(width, height);
    await s.page.goto(`${base}/admin/users`);
    await s.page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 10_000 }).catch(() => {});
    const tokenLeft = await s.page.evaluate(() => localStorage.getItem('exchange_token'));
    record(`session revoked mid-page → signed out, left /admin${w}`, !new URL(s.page.url()).pathname.startsWith('/admin') && tokenLeft === null, `at=${new URL(s.page.url()).pathname}`);
    await s.context.close();

    // 10. token replaced by a non-admin account, then reload
    reset();
    s = await open(width, height);
    await s.page.goto(`${base}/admin/users`);
    await s.page.waitForSelector(readySelector);
    await s.page.evaluate((t) => localStorage.setItem('exchange_token', t), USER_TOKEN);
    const usersBefore = state.calls.users;
    state.meAnswered = false;
    await s.page.reload();
    await s.page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 10_000 }).catch(() => {});
    record(`session switched to a customer → refused${w}`, !new URL(s.page.url()).pathname.startsWith('/admin') && state.calls.users === usersBefore, `at=${new URL(s.page.url()).pathname}`);
    await s.context.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', results }, null, 2));
  console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL PASS (${results.length})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
