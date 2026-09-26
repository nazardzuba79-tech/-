'use strict';

/**
 * Support form → Worker → one email, end to end in a real browser.
 *
 * The production frontend bundle (built with VITE_SUPPORT_ENDPOINT pointing
 * here) posts to the REAL Worker code (workers/support-edge/src/index.js),
 * served by a tiny Node adapter, with the Email Routing binding replaced by a
 * recorder that can accept or refuse. Everything the pages themselves ask the
 * API for is a small read-only fixture; nothing here talks to Render or a DB.
 *
 * Checks: guest send (one POST on a double click, one email to the fixed
 * recipient with Reply-To = the typed address, success text, message
 * cleared), provider refusal (failure text, draft kept, no success), a
 * signed-in user's prefill, layout at 320/360/390/430/1440 (panel and
 * «Отправить» inside the viewport and above the tab bar, no page overflow,
 * scrolling textarea, a keyboard-sized viewport), no request of any kind
 * from the widget while idle, and no secret in the built bundle.
 *
 * Needs: VITE_SUPPORT_ENDPOINT=http://127.0.0.1:8799/v1/support npm run build --prefix frontend
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/support-form'));
const WORKER_PORT = Number(process.env.QA_WORKER_PORT || 8799);
const RECIPIENT = 'voltex.crypto@gmail.com';
const MEMBER_TOKEN = 'qa-member-token';

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, files); else files.push(p);
  }
  return files;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { environment: 'production frontend bundle + real Worker code (local adapter, recorded mail binding) + read-only API fixture', steps: [], widths: [] };
  const step = (name, detail = {}) => { report.steps.push({ name, ...detail }); console.log(`✓ ${name}`); };

  // ── 0. The bundle: the Worker endpoint is in it, no mail secret is ─────────
  const bundle = walk(dist).filter((f) => /\.(js|html|css)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(bundle.includes(`127.0.0.1:${WORKER_PORT}/v1/support`), 'bundle was not built with the QA Worker endpoint');
  for (const secret of ['SMTP_PASS', 'SMTP_USER', 'SUPPORT_ADMIN_EMAIL', 'SUPPORT_FROM_EMAIL', RECIPIENT, 'CLOUDFLARE_API_TOKEN']) {
    assert.ok(!bundle.includes(secret), `bundle contains ${secret}`);
  }
  assert.ok(!/\/support\/conversations/.test(bundle), 'bundle still calls the old chat API');
  step('bundle: Worker endpoint present; no SMTP settings, recipient address or tokens; no chat API');

  // ── The Worker, as shipped, behind a Node adapter ─────────────────────────
  const workerModule = await import(pathToFileURL(path.join(root, 'workers/support-edge/src/index.js')).href);
  const mail = { sent: [], refuse: false };
  const workerLog = [];
  let appOrigin = '';
  const workerEnv = () => ({
    SUPPORT_ADMIN_EMAIL: RECIPIENT,
    SUPPORT_FROM_EMAIL: 'support-form@voltextech.net',
    ALLOWED_ORIGINS: appOrigin,
    SUPPORT_EMAIL: {
      send: async (message) => {
        if (mail.refuse) throw Object.assign(new Error('refused by provider (QA)'), { code: 'E_RECIPIENT_NOT_ALLOWED' });
        mail.sent.push(message);
        return { messageId: `qa-${mail.sent.length}` };
      },
    },
  });
  const workerServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('cf-connecting-ip', '203.0.113.10');
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const request = new Request(`http://127.0.0.1:${WORKER_PORT}${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    const response = await workerModule.default.fetch(request, workerEnv());
    workerLog.push({ method: req.method, path: req.url, status: response.status, at: Date.now() });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  workerServer.listen(WORKER_PORT, '127.0.0.1');
  await once(workerServer, 'listening');

  // ── The site, with a read-only API fixture ────────────────────────────────
  const apiLog = [];
  const app = express();
  app.use('/api/v1', (req, _res, next) => { apiLog.push({ method: req.method, path: req.path, at: Date.now() }); next(); });
  app.get('/api/v1/me', (req, res) => {
    if ((req.headers.authorization || '') !== `Bearer ${MEMBER_TOKEN}`) return res.status(401).json({ error: 'Missing bearer token' });
    return res.json({ id: 'qa-member', email: 'member@example.com', displayName: 'QA Member', isAdmin: false, kycStatus: 'NOT_STARTED' });
  });
  app.get('/api/v1/market/external/tickers', (_q, res) => res.json({ tickers: [] }));
  app.get('/api/v1/futures/config', (_q, res) => res.json({ symbols: [] }));
  app.use('/api/v1', (req, res) => (req.method === 'GET' ? res.json([]) : res.status(404).json({ error: 'not in QA' })));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  appOrigin = `http://127.0.0.1:${server.address().port}`;

  const supportPosts = () => workerLog.filter((r) => r.method === 'POST').length;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    async function openPage(width, token, height) {
      const context = await browser.newContext({ viewport: { width, height: height ?? (width <= 430 ? 844 : 900) }, locale: 'ru-RU', isMobile: width <= 430, hasTouch: width <= 430 });
      await context.addInitScript(([t]) => {
        try { localStorage.setItem('exchange_lang', 'ru'); if (t && !sessionStorage.getItem('qa-token')) { localStorage.setItem('exchange_token', t); sessionStorage.setItem('qa-token', '1'); } } catch {}
      }, [token]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      return { context, page, errors };
    }
    const panelOf = (page) => page.locator('.support-panel');
    async function fill(panel, v) {
      if (v.name !== undefined) await panel.getByLabel('Имя').fill(v.name);
      if (v.email !== undefined) await panel.getByLabel('Email').fill(v.email);
      if (v.subject) await panel.getByLabel('Тема обращения').selectOption(v.subject);
      if (v.message !== undefined) await panel.getByLabel('Сообщение').fill(v.message);
    }

    // ── 1. Guest, desktop: one click → one POST → one email ─────────────────
    {
      workerModule.resetMemoryLimiter();
      const { context, page, errors } = await openPage(1440, null);
      await page.goto(`${appOrigin}/legal/terms`, { waitUntil: 'domcontentloaded' });
      await page.locator('.support-launcher').waitFor();
      const beforeOpen = workerLog.length;
      await page.locator('.support-launcher').click();
      const panel = panelOf(page);
      await panel.waitFor();
      assert.equal(workerLog.length, beforeOpen, 'opening the form must not call anything');
      await fill(panel, { name: 'VOLTEX Support QA', email: 'qa-support@example.invalid', subject: 'TECHNICAL', message: 'Production support form test.\nNo action required.' });
      const before = supportPosts();
      await panel.getByRole('button', { name: 'Отправить' }).dblclick();
      await panel.getByText('Сообщение отправлено').waitFor({ timeout: 8000 });
      await panel.getByText('Мы ответим вам на указанную электронную почту.').waitFor();
      await page.waitForTimeout(400);
      assert.equal(supportPosts() - before, 1, 'a double click must be one POST');
      assert.equal(mail.sent.length, 1);
      const m = mail.sent[0];
      assert.equal(m.to, RECIPIENT);
      assert.equal(m.replyTo, 'qa-support@example.invalid');
      assert.equal(m.html, undefined);
      for (const part of ['VOLTEX Support', 'Имя:\nVOLTEX Support QA', 'Email:\nqa-support@example.invalid', 'Тема:\nТехническая проблема', 'Сообщение:\nProduction support form test.\nNo action required.', 'Дата:']) {
        assert.ok(m.text.includes(part), `mail body lacks ${JSON.stringify(part)}`);
      }
      assert.equal(await panel.getByLabel('Сообщение').inputValue(), '', 'the message must be cleared after success');
      assert.equal(await panel.getByLabel('Email').inputValue(), 'qa-support@example.invalid');
      await page.screenshot({ path: path.join(out, 'guest-sent-1440.png') });
      step('guest: one POST on a double click, one email to the fixed recipient, Reply-To = typed address, success text, message cleared', { subject: m.subject });

      // ── 2. Provider refuses: failure text, draft kept, never success ──────
      mail.refuse = true;
      await fill(panel, { message: 'Second question.' });
      await panel.getByRole('button', { name: 'Отправить' }).click();
      await panel.getByText('Не удалось отправить сообщение. Попробуйте ещё раз позже.').waitFor({ timeout: 8000 });
      assert.equal(await panel.getByText('Сообщение отправлено').count(), 0);
      assert.equal(await panel.getByLabel('Сообщение').inputValue(), 'Second question.');
      assert.equal(mail.sent.length, 1);
      mail.refuse = false;
      await page.screenshot({ path: path.join(out, 'guest-failed-1440.png') });
      step('provider refusal: failure text, draft kept, no success shown');

      // ── 5. Idle: nothing from the widget, panel open, 25 s ────────────────
      const idleFrom = Date.now();
      const workerBefore = workerLog.length;
      await page.waitForTimeout(25_000);
      assert.equal(workerLog.length, workerBefore, 'the widget called the Worker while idle');
      const supportApi = apiLog.filter((r) => r.at >= idleFrom && /support/.test(r.path));
      assert.equal(supportApi.length, 0, 'the widget called a support API while idle');
      step('idle 25 s with the form open: 0 Worker requests, 0 support API requests');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 3. Signed-in user: prefill from one profile read ────────────────────
    {
      workerModule.resetMemoryLimiter();
      const { context, page, errors } = await openPage(390, MEMBER_TOKEN);
      await page.goto(`${appOrigin}/markets`, { waitUntil: 'domcontentloaded' });
      await page.locator('.support-launcher').waitFor();
      await page.waitForTimeout(1500);
      const meBefore = apiLog.filter((r) => r.path === '/me').length;
      await page.locator('.support-launcher').click();
      const panel = panelOf(page);
      await panel.waitFor();
      await page.waitForFunction(() => document.querySelector('.support-panel input[type="email"]')?.value === 'member@example.com', null, { timeout: 5000 });
      assert.equal(await panel.getByLabel('Имя').inputValue(), 'QA Member');
      assert.ok(apiLog.filter((r) => r.path === '/me').length - meBefore <= 1, 'prefill must be one profile read at most');
      await fill(panel, { message: 'Signed-in user question.' });
      await panel.getByRole('button', { name: 'Отправить' }).click();
      await panel.getByText('Сообщение отправлено').waitFor({ timeout: 8000 });
      assert.equal(mail.sent.at(-1).replyTo, 'member@example.com');
      await page.screenshot({ path: path.join(out, 'member-prefilled-390.png') });
      step('signed-in user: name and email prefilled, visible and editable; sent with Reply-To = profile email');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 4. Layout at five widths, plus a keyboard-sized viewport ────────────
    for (const width of [320, 360, 390, 430, 1440]) {
      const { context, page, errors } = await openPage(width, MEMBER_TOKEN);
      await page.goto(`${appOrigin}/markets`, { waitUntil: 'domcontentloaded' });
      const launcher = page.locator('.support-launcher');
      await launcher.waitFor();
      await page.waitForTimeout(1200);
      const overflowBefore = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const nav = page.locator('.bottom-nav');
      const navBox = width <= 430 && (await nav.count()) ? await nav.boundingBox() : null;
      const lb = await launcher.boundingBox();
      if (navBox) assert.ok(lb.y + lb.height <= navBox.y + 1, `@${width} launcher overlaps the tab bar`);
      await launcher.click();
      const panel = panelOf(page);
      await panel.waitFor();
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      const vh = await page.evaluate(() => window.innerHeight);
      const pb = await panel.boundingBox();
      assert.ok(pb.x >= 0 && pb.x + pb.width <= vw + 1, `@${width} panel outside the viewport horizontally`);
      assert.ok(pb.y >= 0 && pb.y + pb.height <= vh + 1, `@${width} panel outside the viewport vertically`);
      if (navBox) assert.ok(pb.y + pb.height <= navBox.y + 1, `@${width} panel under the tab bar`);
      const send = panel.getByRole('button', { name: 'Отправить' });
      const sb = await send.boundingBox();
      assert.ok(sb && sb.y >= 0 && sb.y + sb.height <= (navBox ? navBox.y : vh) + 1, `@${width} «Отправить» not visible`);
      // A long message scrolls inside the textarea; the page does not widen.
      await panel.getByLabel('Сообщение').fill(Array.from({ length: 60 }, (_, i) => `Строка ${i + 1}`).join('\n'));
      const ta = await panel.getByLabel('Сообщение').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      assert.ok(ta.sh > ta.ch, `@${width} textarea does not scroll`);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(pageOverflow <= overflowBefore + 1, `@${width} the form widened the page: ${overflowBefore} → ${pageOverflow}`);
      const panelOverflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(panelOverflow <= 1, `@${width} panel overflows by ${panelOverflow}`);
      await page.screenshot({ path: path.join(out, `form-${width}.png`) });
      let keyboard = null;
      if (width <= 430) {
        // The on-screen keyboard leaves roughly half the height.
        await page.setViewportSize({ width, height: 430 });
        await page.waitForTimeout(300);
        const kb = await panel.boundingBox();
        const ks = await send.boundingBox();
        keyboard = { panelBottom: Math.round(kb.y + kb.height), sendBottom: Math.round(ks.y + ks.height) };
        assert.ok(ks.y >= 0 && ks.y + ks.height <= 430 + 1, `@${width} «Отправить» hidden with a keyboard-sized viewport`);
        await page.screenshot({ path: path.join(out, `form-${width}-keyboard.png`) });
      }
      report.widths.push({ width, panel: { x: Math.round(pb.x), w: Math.round(pb.width), bottom: Math.round(pb.y + pb.height) }, tabBarTop: navBox ? Math.round(navBox.y) : null, sendBottom: Math.round(sb.y + sb.height), keyboard, errors });
      assert.deepEqual(errors, []);
      await context.close();
    }
    step('layout: panel and «Отправить» inside the viewport and above the tab bar at 320/360/390/430/1440, also with a keyboard-sized viewport; textarea scrolls; no page overflow');

    report.totals = { workerPosts: supportPosts(), emails: mail.sent.length, supportApiRequests: apiLog.filter((r) => /support/.test(r.path)).length };
    assert.equal(report.totals.supportApiRequests, 0, 'something still called a /support API route');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = String(error && error.stack || error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    server.close();
    workerServer.close();
  }
  console.log(JSON.stringify({ status: report.status, totals: report.totals }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
