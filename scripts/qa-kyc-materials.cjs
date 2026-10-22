'use strict';

/**
 * KYC additional materials, end to end in a real browser.
 *
 *   production frontend bundle (built with VITE_KYC_EDGE_URL=http://127.0.0.1:18787)
 *   → the REAL Worker logic (workers/kyc-edge/src/core.js) on a local HTTP shim,
 *     its email binding replaced by a sink that keeps the raw MIME
 *   → the REAL Render routes (dist/api/routes/kyc.js, adminPagedReads.js, admin.js)
 *   → PostgreSQL (KYC_QA_DATABASE_URL: a disposable 127.0.0.1/voltex_kyc_test only).
 *
 * The scenarios of the task: the admin asks for a new document photo, the user
 * sees it (and after a reload), uploads it; the admin sees it arrive; a selfie
 * request answered with the camera (Chromium's synthetic fake camera) and with
 * a file; the comparison screen; decisions; document + selfie together;
 * someone else's request; repeats, reloads and a lost connection; 320/360/390/
 * 430 px and desktop. Synthetic test accounts and synthetic images only — no
 * real passport or face anywhere.
 *
 * Needs: npm run build; VITE_KYC_EDGE_URL=http://127.0.0.1:18787 npm run build --prefix frontend;
 * prisma migrate deploy on the disposable database; QA_PLAYWRIGHT_MODULE (or playwright resolvable).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { webcrypto, randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const EDGE_PORT = 18787;
const JWT_SECRET = 'kyc-materials-qa-only-secret-at-least-32-chars';
process.env.JWT_SECRET = JWT_SECRET;
const dbUrl = process.env.KYC_QA_DATABASE_URL || '';
{
  if (!dbUrl) throw new Error('KYC_QA_DATABASE_URL (disposable 127.0.0.1/voltex_kyc_test) is required');
  const parsed = new URL(dbUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_kyc_test') throw new Error('disposable localhost test database required');
  process.env.DATABASE_URL = dbUrl;
}

const express = require('express');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { kycRouter } = require(path.join(root, 'dist/api/routes/kyc.js'));
const { adminRouter } = require(path.join(root, 'dist/api/routes/admin.js'));
const { adminPagedReadsRouter } = require(path.join(root, 'dist/api/routes/adminPagedReads.js'));
const { KycEdgeTrust } = require(path.join(root, 'dist/services/KycEdgeTrust.js'));

const dist = path.resolve(process.env.QA_FRONTEND_DIST || path.join(root, 'frontend/dist'));
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/kyc-materials'));
const MOBILE = [320, 360, 390, 430];
const DESKTOP = 1440;

function mailSink() {
  const mails = [];
  return {
    mails,
    send: async (from, to, raw) => {
      const messageId = `qa-${randomUUID().replace(/-/g, '')}@voltextech.net`;
      mails.push({ from, to, messageId, raw: Buffer.from(raw).toString('latin1') });
      return { messageId };
    },
  };
}
const decodeWords = (value) => value.split(/\r\n /).map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
const subjectOf = (mail) => decodeWords(mail.raw.match(/^Subject: ([\s\S]*?)\r\n(?! )/m)[1]);
const textOf = (mail) => Buffer.from(mail.raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\s+/g, ''), 'base64').toString('utf8');
function attachmentOf(mail) {
  const m = mail.raw.match(/Content-Disposition: attachment; filename="([^"]+)"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/);
  assert.ok(m, 'mail has one base64 attachment');
  return { filename: m[1], bytes: Buffer.from(m[2].replace(/\s+/g, ''), 'base64') };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.png') || f === 'report.json') fs.unlinkSync(path.join(out, f));
  const report = { environment: 'production bundle + real Worker core.js + real Render kyc/admin routers + PostgreSQL', scenarios: [], layout: [], renderMeter: null };
  const step = (name, detail = {}) => { report.scenarios.push({ name, ...detail }); console.log(`✓ ${name}`); };

  // Edge log lines are captured to prove they carry identifiers only.
  const edgeLogs = [];
  const log = console.log;
  console.log = (...args) => { const line = args.join(' '); if (line.includes('"svc":"voltex-kyc-edge"')) edgeLogs.push(line); else log(...args); };

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const stale = (await prisma.user.findMany({ where: { email: { endsWith: '@kyc-materials-qa.invalid' } }, select: { id: true } })).map((u) => u.id);
  const staleSubs = (await prisma.kycSubmission.findMany({ where: { userId: { in: stale } }, select: { id: true } })).map((s) => s.id);
  await prisma.kycMaterialRequest.deleteMany({ where: { submissionId: { in: staleSubs } } });
  await prisma.kycSubmission.deleteMany({ where: { userId: { in: stale } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: stale } } });
  await prisma.user.deleteMany({ where: { id: { in: stale } } });

  const mkUser = (tag, extra = {}) => prisma.user.create({ data: { email: `${tag}@kyc-materials-qa.invalid`, passwordHash: 'QA_ONLY', referralCode: `KMQA${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}${Math.floor(Math.random() * 1e6)}`, ...extra } });
  // A submission under review, as the edge would have recorded it (the document itself is in the mailbox).
  async function pendingUser(tag, fullName) {
    const user = await mkUser(tag, { kycStatus: 'PENDING' });
    const submission = await prisma.kycSubmission.create({ data: {
      userId: user.id, country: 'UA', fullName, dateOfBirth: new Date('1990-01-01T00:00:00Z'), documentType: 'PASSPORT',
      documentDelivery: 'EMAIL', emailMessageId: `qa-original-${tag}@voltextech.net`, emailAcceptedAt: new Date(), documentMimeType: 'image/jpeg', documentSizeBytes: 420000,
    } });
    return { user, submission, fullName };
  }
  const admin = await mkUser('admin', { role: 'ADMIN' });
  const tokenFor = (u) => jwt.sign({ sub: u.id }, JWT_SECRET);

  const core = await import(require('node:url').pathToFileURL(path.join(root, 'workers/kyc-edge/src/core.js')).href);
  const { privateKey } = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);
  process.env.KYC_EDGE_PUBLIC_KEY = jwk.x;
  const sink = mailSink();
  const idem = new Map();
  const notifications = [];

  const meter = { requests: 0, bytesIn: 0, maxBody: 0, multipart: 0, documentReads: 0, paths: [] };
  let failMaterialConfirmOnce = false;
  const app = express();
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/v1/')) {
      const len = Number(req.headers['content-length'] || 0);
      meter.requests++; meter.bytesIn += len; meter.maxBody = Math.max(meter.maxBody, len);
      if (String(req.headers['content-type'] || '').startsWith('multipart/')) meter.multipart++;
      if (/\/kyc\/[^/]+\/document$/.test(req.path)) meter.documentReads++;
      if (req.path.includes('kyc')) meter.paths.push(`${req.method} ${req.path} ${len}B`);
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1/internal/kyc/materials/confirmed', (req, res, next) => {
    if (failMaterialConfirmOnce) { failMaterialConfirmOnce = false; return res.status(503).json({ error: 'QA: render briefly down' }); }
    next();
  });
  app.use('/api/v1', kycRouter(prisma, new KycEdgeTrust()));
  app.use('/api/v1', adminPagedReadsRouter(prisma));
  app.use('/api/v1', adminRouter(prisma));
  app.get('/api/v1/me', async (req, res) => {
    try {
      const { sub } = jwt.verify(String(req.headers.authorization || '').slice(7), JWT_SECRET);
      const u = await prisma.user.findUnique({ where: { id: sub } });
      res.json({ id: u.id, email: u.email, displayName: 'QA', avatarUrl: null, role: u.role, isAdmin: u.role === 'ADMIN', kycStatus: u.kycStatus, twoFactorEnabled: false, createdAt: new Date().toISOString() });
    } catch { res.status(401).json({ error: 'Missing bearer token' }); }
  });
  app.get('/api/v1/admin/overview', (_q, res) => res.json({ totalUsers: 1, pendingKyc: 0, pendingWithdrawals: 0, creditedDepositsToday: 0, unmatchedIncoming: null, unmatchedIncomingReason: 'live_provider_feed', dayStart: new Date().toISOString(), asOf: new Date().toISOString() }));
  app.get('/api/v1/admin/work-summary', async (_q, res) => {
    const asOf = new Date().toISOString();
    res.json({ asOf, alerts: null, widgets: Object.fromEntries(['readyPackages', 'pendingPackages', 'unlinkedTransfers', 'activeWithdrawals', 'pendingKyc', 'openOtc', 'totalUsers', 'newUsers24h'].map(key => [key, { value: 0, unit: 'users', href: '/admin/kyc', status: 'ready', asOf }])) });
  });
  app.use('/api/v1', (req, res) => (req.method === 'GET' ? res.json([]) : res.status(404).json({ error: 'not in QA' })));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  const edgeEnv = {
    KYC_EDGE_SIGNING_JWK: JSON.stringify(jwk), VOLTEX_API_ORIGIN: origin, ALLOWED_ORIGINS: origin,
    // The private service binding to the notification Worker, as a recorder.
    NOTIFICATIONS: { notify: async () => ({ status: 'SENT' }), notifyMaterials: async (event) => { notifications.push(event); return { status: 'SENT' }; } },
  };
  const edge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('cf-connecting-ip', `127.0.0.${1 + Math.floor(Math.random() * 200)}`);
    const request = new Request(`http://127.0.0.1:${EDGE_PORT}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body });
    const response = await core.handle(request, edgeEnv, { waitUntil: () => {} }, {
      now: () => Date.now(),
      fetch: (u, i) => fetch(u, i),
      sendEmail: sink.send,
      cache: { match: async (r) => (idem.has(r.url) ? new Response(idem.get(r.url)) : undefined), put: async (r, v) => { idem.set(r.url, await v.text()); } },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  edge.listen(EDGE_PORT, '127.0.0.1');
  await once(edge, 'listening');
  const bundle = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8')).join('\n');
  assert.ok(bundle.includes(`http://127.0.0.1:${EDGE_PORT}`), 'frontend must be built with VITE_KYC_EDGE_URL=http://127.0.0.1:18787');

  // External hosts are refused per context (page.route), so only the two local servers answer.
  const externalAttempts = [];
  const browser = await chromium.launch({
    headless: true,
    // Chromium's built-in synthetic camera (a moving test pattern) — no real face.
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}),
  });

  const edgeMaterial = (token, fields, file) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    if (file) f.append('file', new Blob([file.bytes], { type: file.type }), 'x');
    return fetch(`http://127.0.0.1:${EDGE_PORT}/v1/materials`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin }, body: f });
  };
  const api = (token, method, p, body) => fetch(`${origin}/api/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  try {
    async function openPage(width, token, { camera = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 }, locale: 'ru-RU', ...(camera ? { permissions: ['camera'] } : {}) });
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route((url) => url.hostname !== '127.0.0.1', (route) => { externalAttempts.push(new URL(route.request().url()).host); return route.abort('blockedbyclient'); });
      await context.addInitScript(([t]) => { localStorage.setItem('exchange_lang', 'ru'); if (t) localStorage.setItem('exchange_token', t); }, [token]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      // Diagnostics only: a server failure or a console error is printed with the step that hit it.
      page.on('response', (r) => { if (r.status() >= 500 || (r.status() >= 400 && process.env.QA_VERBOSE)) log(`  [http ${r.status()}] ${r.request().method()} ${r.url()}`); });
      page.on('console', (m) => { if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED/.test(m.text())) log(`  [console] ${m.text().slice(0, 200)}`); });
      return { context, page, errors };
    }
    const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    // Synthetic images, drawn by the browser: a document-like card, a too-small
    // copy, and a cartoon "selfie" (an SVG drawing, not a person).
    const { context: gen, page: genPage } = await openPage(1440, null);
    const shot = async (html, width, height) => {
      await genPage.setViewportSize({ width, height });
      await genPage.setContent(`<body style="margin:0">${html}</body>`);
      return genPage.screenshot({ type: 'jpeg', quality: 92 });
    };
    const docHtml = '<div style="width:100vw;height:100vh;background:linear-gradient(135deg,#dfe7f5,#f7efe1);font:bold 54px sans-serif;color:#223;padding:60px;box-sizing:border-box">SYNTHETIC TEST DOCUMENT<br>NOT A REAL PERSON<br><span style="font-size:28px">QA · VOLTEX KYC MATERIALS</span></div>';
    const docJpeg = await shot(docHtml, 1600, 1000);
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x16]), Buffer.from('Exif\0\0QA-GPS-51.5N-0.1W')]);
    const docJpegExif = Buffer.concat([docJpeg.subarray(0, 2), exif, docJpeg.subarray(2)]);
    const smallJpeg = await shot(docHtml, 800, 500);
    const cartoon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" style="width:100vw;height:100vh;background:#cfe3f3"><circle cx="200" cy="150" r="95" fill="#f3d2b3"/><circle cx="165" cy="130" r="10"/><circle cx="235" cy="130" r="10"/><path d="M160 190 q40 30 80 0" stroke="#000" stroke-width="6" fill="none"/><text x="200" y="285" font-size="18" text-anchor="middle" font-family="sans-serif">SYNTHETIC QA DRAWING</text></svg>';
    const selfieJpeg = await shot(cartoon, 1024, 768);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    await gen.close();

    const A = await pendingUser('user-a-document', 'Synthetic Alpha Person');
    const B = await pendingUser('user-b-selfie', 'Synthetic Beta Person');
    const C = await pendingUser('user-c-both', 'Synthetic Gamma Person');
    const D = await mkUser('user-d-other');

    // ── 1. The admin asks A for a new document photo (desktop) ──
    {
      const { context, page, errors } = await openPage(DESKTOP, tokenFor(admin));
      await page.goto(`${origin}/admin/kyc?user=${A.user.id}`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-kyc-review="${A.submission.id}"]`);
      await card.waitFor({ timeout: 15000 });
      await card.locator('[data-kyc-stage="UNDER_REVIEW"]').waitFor();
      await card.getByRole('button', { name: 'Запросить дополнительные материалы' }).click();
      const form = card.locator('[data-kyc-request-form]');
      await form.locator('[data-kyc-request-reason]').selectOption('BLURRY');
      const preview = form.locator('[data-kyc-request-preview]');
      await preview.getByText('Причина: Фото размыто').waitFor();
      assert.ok((await preview.textContent()).includes('Необходимо повторно загрузить документ'));
      await form.screenshot({ path: path.join(out, 'admin-request-form-document-1440.png') });
      const before = meter.paths.filter((p) => p.includes('/material-requests')).length;
      await form.getByRole('button', { name: 'Отправить запрос' }).dblclick();
      await card.locator('[data-kyc-stage="DOCUMENT_REQUIRED"]').waitFor({ timeout: 15000 });
      const rows = await prisma.kycMaterialRequest.findMany({ where: { submissionId: A.submission.id } });
      assert.equal(rows.length, 1, 'double click → one request');
      assert.equal(rows[0].kind, 'DOCUMENT'); assert.equal(rows[0].documentReason, 'BLURRY');
      assert.equal((await prisma.user.findUnique({ where: { id: A.user.id } })).kycStatus, 'PENDING', 'a request does not reject');
      assert.equal((await prisma.kycSubmission.findUnique({ where: { id: A.submission.id } })).status, 'PENDING');
      assert.equal(await prisma.auditLog.count({ where: { userId: A.user.id, action: 'KYC_MATERIALS_REQUESTED' } }), 1);
      step('1. admin: «Запросить дополнительные материалы» → «Новое фото документа», reason «Фото размыто», preview of the user text, double click → 1 request, status stays PENDING, audit', {
        requestCalls: meter.paths.filter((p) => p.includes('/material-requests')).length - before,
      });
      await page.screenshot({ path: path.join(out, 'admin-after-request-1440.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 2. A sees it — in Verification, in Profile, and after a reload ──
    {
      const { context, page, errors } = await openPage(390, tokenFor(A.user));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      const part = page.locator('[data-kyc-material-part="DOCUMENT"]');
      await part.getByText('Необходимо повторно загрузить документ').waitFor({ timeout: 15000 });
      await part.getByText('Причина: Фото размыто').waitFor();
      await part.getByText('К сожалению, фотография вашего документа недостаточно чёткая для проверки.', { exact: false }).waitFor();
      await page.getByText('Требуется новое фото документа').first().waitFor();
      assert.equal(await page.locator('[data-kyc-material-part="SELFIE"]').count(), 0, 'a document request does not ask for a selfie');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await part.getByText('Причина: Фото размыто').waitFor({ timeout: 15000 });
      await page.screenshot({ path: path.join(out, 'user-document-request-390.png'), fullPage: true });
      await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('[data-profile-verification="PENDING"]');
      await row.getByText('Требуется новое фото документа').first().waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Открыть запрос' }).waitFor();
      step('2. user (390): request with its reason in Verification, stage in the badge and Profile («Открыть запрос»), persists across reload; no selfie asked');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 3. A uploads: too small refused, network loss, then one upload → email + record ──
    {
      const { context, page, errors } = await openPage(390, tokenFor(A.user));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      const part = page.locator('[data-kyc-material-part="DOCUMENT"]');
      await part.getByRole('button', { name: 'Загрузить новое фото' }).waitFor({ timeout: 15000 });
      const input = part.locator('[data-kyc-material-input="DOCUMENT"]');
      await part.locator('[data-kyc-material-start="DOCUMENT"]').evaluate((b) => { b.closest('section').querySelector('input[type=file]').click = () => {}; b.click(); });
      await input.setInputFiles({ name: 'small.jpg', mimeType: 'image/jpeg', buffer: smallJpeg });
      await part.getByText('Изображение слишком маленькое (800×500)', { exact: false }).waitFor({ timeout: 10000 });
      assert.equal(await part.locator('[data-kyc-material-submit="DOCUMENT"]').isDisabled(), true);
      await input.setInputFiles({ name: 'passport-AB7654321.jpg', mimeType: 'image/jpeg', buffer: docJpegExif });
      await part.locator('[data-kyc-material-preview] img').waitFor({ timeout: 10000 });
      await part.screenshot({ path: path.join(out, 'user-document-preview-390.png') });
      const mailsBefore = sink.mails.length;
      await context.setOffline(true);
      await part.locator('[data-kyc-material-submit="DOCUMENT"]').click();
      // PR #501: customerErrorText recognizes fetch/network failure before the
      // generic upload fallback. Keep the offline and no-duplicate checks below.
      await part.getByText('Не удалось связаться с сервисом. Проверьте подключение.', { exact: true }).waitFor({ timeout: 10000 });
      await context.setOffline(false);
      assert.equal(sink.mails.length, mailsBefore, 'offline: nothing sent');
      await part.locator('[data-kyc-material-submit="DOCUMENT"]').dblclick();
      await page.locator('[data-kyc-material-part="DOCUMENT"][data-received]').waitFor({ timeout: 15000 });
      await page.getByText('Дополнительные материалы получены').first().waitFor();
      await page.waitForTimeout(400);
      assert.equal(sink.mails.length - mailsBefore, 1, 'offline attempt + double click → one email');
      const mail = sink.mails.at(-1);
      assert.equal(mail.to, 'voltex.crypto@gmail.com');
      assert.equal(subjectOf(mail), `[KYC] Новое фото документа — ${A.fullName} — ${A.user.email}`);
      const att = attachmentOf(mail);
      assert.match(att.filename, new RegExp(`^kyc-${A.submission.id}-document-[0-9a-f]{8}\\.jpg$`));
      assert.ok(!mail.raw.includes('AB7654321'), 'browser file name never reaches the email');
      assert.ok(!att.bytes.includes(Buffer.from('QA-GPS')), 'EXIF/GPS stripped');
      const row = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: A.submission.id } });
      assert.equal(row.status, 'RECEIVED');
      assert.equal(row.documentMessageId, mail.messageId);
      assert.equal(row.documentSizeBytes, att.bytes.length);
      assert.equal(await prisma.auditLog.count({ where: { userId: A.user.id, action: 'KYC_MATERIAL_RECEIVED' } }), 1);
      assert.equal(notifications.filter((n) => n.email === A.user.email).length, 1, 'one admin Telegram event');
      await page.screenshot({ path: path.join(out, 'user-document-received-390.png'), fullPage: true });
      step('3. user: too-small photo refused with its size, offline attempt fails without sending, then double click → 1 email «[KYC] Новое фото документа», EXIF stripped, request RECEIVED, 1 audit, 1 admin notification');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 4. The admin sees it: queue filter, stage, history, «Начать повторную проверку» ──
    {
      const { context, page, errors } = await openPage(DESKTOP, tokenFor(admin));
      await page.goto(`${origin}/admin/kyc?status=MATERIALS_RECEIVED`, { waitUntil: 'domcontentloaded' });
      await page.locator(`[data-kyc-client="${A.user.id}"]`).waitFor({ timeout: 15000 });
      assert.equal(await page.locator(`[data-kyc-client="${B.user.id}"]`).count(), 0);
      await page.locator(`[data-kyc-client="${A.user.id}"]`).click();
      const card = page.locator(`[data-kyc-review="${A.submission.id}"]`);
      await card.locator('[data-kyc-stage="MATERIALS_RECEIVED"]').waitFor({ timeout: 15000 });
      const row = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: A.submission.id } });
      await card.locator('[data-kyc-material-history]').getByText(`Message-ID: ${row.documentMessageId}`).waitFor();
      await page.screenshot({ path: path.join(out, 'admin-materials-received-1440.png'), fullPage: true });
      await card.getByRole('button', { name: 'Начать повторную проверку' }).click();
      await card.locator('[data-kyc-stage="RE_REVIEW"]').waitFor({ timeout: 15000 });
      assert.ok((await prisma.kycMaterialRequest.findUnique({ where: { id: row.id } })).acknowledgedAt);
      step('4. admin: queue filter «Получены доп. материалы» lists the user; stage, Message-ID in the history; «Начать повторную проверку» → «Повторная проверка»');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 5. Selfie request for B; 6. B answers with the camera; 7. comparison; 8. decision ──
    {
      const { context, page, errors } = await openPage(DESKTOP, tokenFor(admin));
      await page.goto(`${origin}/admin/kyc?user=${B.user.id}`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-kyc-review="${B.submission.id}"]`);
      await card.waitFor({ timeout: 15000 });
      await card.getByRole('button', { name: 'Запросить дополнительные материалы' }).click();
      const form = card.locator('[data-kyc-request-form]');
      await form.locator('input[value="SELFIE"]').check();
      await form.locator('[data-kyc-request-comment]').fill('Снимите, пожалуйста, очки');
      await form.locator('[data-kyc-request-preview]').getByText('Комментарий администратора: Снимите, пожалуйста, очки').waitFor();
      await form.screenshot({ path: path.join(out, 'admin-request-form-selfie-1440.png') });
      await form.getByRole('button', { name: 'Отправить запрос' }).click();
      await card.locator('[data-kyc-stage="SELFIE_REQUIRED"]').waitFor({ timeout: 15000 });
      await context.close();
      assert.deepEqual(errors, []);
    }
    step('5. admin: selfie request with an optional comment; preview shows the generated text + comment');
    {
      const { context, page, errors } = await openPage(390, tokenFor(B.user), { camera: true });
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      const part = page.locator('[data-kyc-material-part="SELFIE"]');
      await part.getByText('Требуется дополнительное подтверждение личности').waitFor({ timeout: 15000 });
      await part.getByText('Комментарий администратора: Снимите, пожалуйста, очки').waitFor();
      assert.equal(await page.locator('[data-kyc-material-part="DOCUMENT"]').count(), 0, 'a selfie request does not ask for the document again');
      await part.getByRole('button', { name: 'Сделать селфи' }).click();
      await part.getByText('Держать документ в руках не нужно', { exact: false }).waitFor();
      // A PDF is not a selfie.
      await part.locator('[data-kyc-material-input="SELFIE"]').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf });
      await part.getByText('Для селфи подходят только JPEG или PNG.').waitFor({ timeout: 10000 });
      await part.getByRole('button', { name: 'Сделать фото камерой' }).click();
      await part.locator('[data-kyc-selfie-camera] video').waitFor();
      await page.waitForFunction(() => { const v = document.querySelector('[data-kyc-selfie-camera] video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
      await page.screenshot({ path: path.join(out, 'user-selfie-camera-390.png'), fullPage: true });
      await part.getByRole('button', { name: 'Сделать снимок' }).click();
      await part.locator('[data-kyc-material-preview] img').waitFor({ timeout: 10000 });
      const cameraTracksLive = await page.evaluate(() => !!document.querySelector('[data-kyc-selfie-camera]'));
      assert.equal(cameraTracksLive, false, 'camera view closed after capture');
      const submit = part.locator('[data-kyc-material-submit="SELFIE"]');
      assert.equal(await submit.isDisabled(), true, 'no consent → cannot send');
      await part.locator('[data-kyc-selfie-consent]').check();
      await page.screenshot({ path: path.join(out, 'user-selfie-ready-390.png'), fullPage: true });
      const mailsBefore = sink.mails.length;
      await submit.click();
      await page.locator('[data-kyc-material-part="SELFIE"][data-received]').waitFor({ timeout: 15000 });
      assert.equal(sink.mails.length - mailsBefore, 1);
      const mail = sink.mails.at(-1);
      assert.equal(subjectOf(mail), `[KYC] Селфи для подтверждения личности — ${B.fullName} — ${B.user.email}`);
      const text = textOf(mail);
      assert.match(text, /Согласие на сбор и использование селфи для проверки личности: получено .* \(версия kyc-selfie-v1\)/);
      assert.match(text, /Автоматическое распознавание лиц не используется/);
      const att = attachmentOf(mail);
      assert.match(att.filename, new RegExp(`^kyc-${B.submission.id}-selfie-[0-9a-f]{8}\\.jpg$`));
      assert.equal(att.bytes[0], 0xff); assert.equal(att.bytes[1], 0xd8);
      fs.writeFileSync(path.join(out, '.selfie-from-mail.jpg'), att.bytes);
      const row = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: B.submission.id } });
      assert.ok(row.selfieConsentAt); assert.equal(row.selfieConsentVersion, 'kyc-selfie-v1');
      assert.equal(row.status, 'RECEIVED');
      step('6. user (390): selfie via the camera (Chromium synthetic camera); PDF refused; send blocked until consent; 1 email «[KYC] Селфи…» with the consent line; consent stored');
      assert.deepEqual(errors, []);
      await context.close();
    }
    for (const width of [DESKTOP, 390]) {
      const { context, page, errors } = await openPage(width, tokenFor(admin));
      await page.goto(`${origin}/admin/kyc?user=${B.user.id}`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-kyc-review="${B.submission.id}"]`);
      await card.locator('[data-kyc-stage]').waitFor({ timeout: 15000 });
      const bytesBefore = meter.bytesIn;
      await card.getByRole('button', { name: 'Сравнить документ и селфи' }).click();
      const compare = page.locator('[data-kyc-compare]');
      await compare.waitFor();
      await compare.locator('[data-kyc-compare-input="document"]').setInputFiles({ name: 'document.jpg', mimeType: 'image/jpeg', buffer: docJpeg });
      await compare.locator('[data-kyc-compare-input="selfie"]').setInputFiles(path.join(out, '.selfie-from-mail.jpg'));
      await compare.locator('[data-kyc-compare-pane="document"] img').waitFor();
      await compare.locator('[data-kyc-compare-pane="selfie"] img').waitFor();
      const docPane = compare.locator('[data-kyc-compare-pane="document"]');
      await docPane.getByRole('button', { name: 'Увеличить' }).click();
      await docPane.getByRole('button', { name: 'Увеличить' }).click();
      await docPane.getByRole('button', { name: 'Повернуть на 90°' }).click();
      const transform = await docPane.locator('img').evaluate((img) => img.style.transform);
      assert.match(transform, /rotate\(90deg\) scale\(1\.56/);
      assert.equal(await docPane.locator('.kyc-compare-tools span').textContent(), '156%');
      const text = await compare.textContent();
      assert.ok(text.includes('Автоматическое распознавание лиц не используется'));
      assert.ok(!/\d+\s*%\s*(совпад|сходств|похож)/i.test(text), 'no similarity score');
      for (const name of ['Подтвердить', 'Запросить новое селфи', 'Запросить новый документ', 'Отклонить']) await compare.getByRole('button', { name, exact: true }).waitFor();
      const layout = await page.evaluate(() => { const d = document.querySelector('[data-kyc-compare]'); return { overflow: d.scrollWidth - d.clientWidth, panes: [...d.querySelectorAll('[data-kyc-compare-pane]')].map((p) => { const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }) }; });
      assert.ok(layout.overflow <= 1, `compare overflows at ${width}`);
      if (width === DESKTOP) assert.ok(layout.panes[0].y === layout.panes[1].y && layout.panes[0].x < layout.panes[1].x, 'desktop: document left, selfie right');
      else assert.ok(layout.panes[1].y > layout.panes[0].y, 'phone: stacked');
      await page.screenshot({ path: path.join(out, `admin-compare-${width}.png`) });
      if (width === DESKTOP) {
        await docPane.locator('[data-kyc-compare-max]').click();
        await docPane.locator('[data-kyc-compare-max]').filter({ hasText: 'Свернуть' }).waitFor();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, 'admin-compare-fullscreen-1440.png') });
        await docPane.locator('[data-kyc-compare-max]').click();
        await docPane.locator('[data-kyc-compare-max]').filter({ hasText: 'Во весь экран' }).waitFor();
        assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
      }
      assert.ok(meter.bytesIn - bytesBefore < 4096, 'opening files in the comparison sends nothing to the server');
      assert.equal(meter.multipart, 0);
      report.layout.push({ screen: 'admin-compare', width, ...layout });
      if (width === 390) {
        await compare.getByRole('button', { name: 'Подтвердить', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Подтвердить проверку личности' });
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Подтвердить решение' }).click();
        await page.waitForResponse((r) => /\/kyc\/[^/]+\/review$/.test(new URL(r.url()).pathname));
        await page.waitForTimeout(400);
        assert.equal((await prisma.user.findUnique({ where: { id: B.user.id } })).kycStatus, 'APPROVED');
        const closed = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: B.submission.id } });
        assert.equal(closed.closedOutcome, 'APPROVED'); assert.equal(closed.status, 'CLOSED');
        assert.ok(closed.selfieReceivedAt, 'received materials are kept');
      } else {
        await compare.getByRole('button', { name: 'Закрыть' }).click();
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    step('7. comparison (1440 side by side, 390 stacked): local files only (< 4 KB to the server), zoom 156 % + rotate 90°, fullscreen, no face recognition text or score; four buttons present');
    step('8. decision from the comparison: «Подтвердить» → confirmation dialog → APPROVED; the request closes as APPROVED, received data kept');
    {
      const { context, page } = await openPage(390, tokenFor(B.user));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Верифицировано').first().waitFor({ timeout: 15000 });
      assert.equal(await page.locator('[data-kyc-materials]').count(), 0);
      await context.close();
    }

    // ── 9. Document AND selfie for C: partial stage, file-chooser selfie, then rejection ──
    let requestC;
    {
      const res = await api(tokenFor(admin), 'POST', `/kyc/${C.submission.id}/material-requests`, { clientRequestId: randomUUID(), kind: 'DOCUMENT_AND_SELFIE', documentReason: 'CROPPED' });
      assert.equal(res.status, 201);
      requestC = (await res.json()).materialRequest;
      const { context, page, errors } = await openPage(360, tokenFor(C.user));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Требуются документ и селфи').first().waitFor({ timeout: 15000 });
      const doc = page.locator('[data-kyc-material-part="DOCUMENT"]');
      const selfie = page.locator('[data-kyc-material-part="SELFIE"]');
      await doc.getByText('Причина: Документ обрезан').waitFor();
      await page.screenshot({ path: path.join(out, 'user-both-request-360.png'), fullPage: true });
      await doc.locator('[data-kyc-material-input="DOCUMENT"]').setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: pdf });
      await doc.locator('[data-kyc-material-submit="DOCUMENT"]').click();
      await page.locator('[data-kyc-material-part="DOCUMENT"][data-received]').waitFor({ timeout: 15000 });
      await page.getByText('Требуется селфи').first().waitFor({ timeout: 15000 });
      await selfie.getByRole('button', { name: 'Сделать селфи' }).click();
      await selfie.locator('[data-kyc-material-input="SELFIE"]').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: selfieJpeg });
      await selfie.locator('[data-kyc-material-preview] img').waitFor({ timeout: 10000 });
      await selfie.locator('[data-kyc-selfie-consent]').check();
      // The record call fails once after the email went out: sealed receipt, retried — never a second email.
      failMaterialConfirmOnce = true;
      const mailsBefore = sink.mails.length;
      await selfie.locator('[data-kyc-material-submit="SELFIE"]').click();
      await page.locator('[data-kyc-material-part="SELFIE"][data-received]').waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !localStorage.getItem('voltex_kyc_material_receipts'), null, { timeout: 20000 });
      await page.getByText('Дополнительные материалы получены').first().waitFor({ timeout: 15000 });
      assert.equal(sink.mails.length - mailsBefore, 1, 'receipt retry never re-sends the file');
      const row = await prisma.kycMaterialRequest.findUnique({ where: { id: requestC.id } });
      assert.equal(row.status, 'RECEIVED'); assert.ok(row.documentReceivedAt && row.selfieReceivedAt);
      assert.equal(row.documentMimeType, 'application/pdf');
      assert.equal(await prisma.auditLog.count({ where: { userId: C.user.id, action: 'KYC_MATERIAL_RECEIVED' } }), 2);
      step('9. document + selfie: «Требуются документ и селфи» → after the PDF «Требуется селфи» → selfie from a file (record call failed once → sealed receipt retried, still 1 email) → «Дополнительные материалы получены»');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 10. Someone else's request, no session, not an admin, not requested, closed ──
    {
      const mailsBefore = sink.mails.length;
      const reqA = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: A.submission.id } });
      const foreign = await edgeMaterial(tokenFor(D), { requestId: randomUUID(), materialRequestId: reqA.id, part: 'DOCUMENT' }, { bytes: docJpeg, type: 'image/jpeg' });
      assert.equal(foreign.status, 404); assert.equal((await foreign.json()).code, 'kyc_material_request_not_found');
      const missing = await edgeMaterial(tokenFor(D), { requestId: randomUUID(), materialRequestId: randomUUID(), part: 'DOCUMENT' }, { bytes: docJpeg, type: 'image/jpeg' });
      assert.equal(missing.status, 404, 'foreign and missing answer the same');
      assert.equal((await edgeMaterial(null, { requestId: randomUUID(), materialRequestId: reqA.id, part: 'DOCUMENT' }, { bytes: docJpeg, type: 'image/jpeg' })).status, 401);
      const notAsked = await edgeMaterial(tokenFor(A.user), { requestId: randomUUID(), materialRequestId: reqA.id, part: 'SELFIE', selfieConsent: 'true', consentVersion: 'kyc-selfie-v1' }, { bytes: selfieJpeg, type: 'image/jpeg' });
      assert.equal(notAsked.status, 409); assert.equal((await notAsked.json()).code, 'kyc_material_not_requested');
      const again = await edgeMaterial(tokenFor(A.user), { requestId: randomUUID(), materialRequestId: reqA.id, part: 'DOCUMENT' }, { bytes: docJpeg, type: 'image/jpeg' });
      assert.equal(again.status, 409); assert.equal((await again.json()).code, 'kyc_material_already_received');
      const noConsent = await edgeMaterial(tokenFor(C.user), { requestId: randomUUID(), materialRequestId: requestC.id, part: 'SELFIE' }, { bytes: selfieJpeg, type: 'image/jpeg' });
      assert.equal(noConsent.status, 400); assert.equal((await noConsent.json()).code, 'kyc_selfie_consent_required');
      const fake = await edgeMaterial(tokenFor(C.user), { requestId: randomUUID(), materialRequestId: requestC.id, part: 'DOCUMENT' }, { bytes: Buffer.from('<svg onload=alert(1)>'), type: 'image/png' });
      assert.equal(fake.status, 415);
      assert.equal((await api(tokenFor(D), 'POST', `/kyc/${A.submission.id}/material-requests`, { clientRequestId: randomUUID(), kind: 'SELFIE' })).status, 403);
      assert.equal((await api(tokenFor(D), 'POST', `/kyc/material-requests/${reqA.id}/acknowledge`)).status, 403);
      assert.equal((await api(tokenFor(D), 'GET', '/admin/clients/page?status=MATERIALS_RECEIVED')).status, 403);
      const me = await (await api(tokenFor(D), 'GET', '/kyc/me')).json();
      assert.equal(me.materialRequest ?? null, null, "another user's request is never shown");
      // After a decision the request is closed: an upload is refused.
      const closedB = await prisma.kycMaterialRequest.findFirst({ where: { submissionId: B.submission.id } });
      const late = await edgeMaterial(tokenFor(B.user), { requestId: randomUUID(), materialRequestId: closedB.id, part: 'SELFIE', selfieConsent: 'true', consentVersion: 'kyc-selfie-v1' }, { bytes: selfieJpeg, type: 'image/jpeg' });
      assert.equal(late.status, 409); assert.equal((await late.json()).code, 'kyc_material_request_closed');
      assert.equal(sink.mails.length, mailsBefore, 'no refused probe sent an email');
      step('10. access: another user\'s request = 404 (same as missing), no session 401, non-admin 403 on request/acknowledge/queue, part not requested 409, already received 409, no consent 400, fake image 415, closed after decision 409 — 0 emails');
    }

    // ── 11. Repeats: same click key replays, a new request supersedes, rejection closes ──
    {
      const key = randomUUID();
      const first = await api(tokenFor(admin), 'POST', `/kyc/${A.submission.id}/material-requests`, { clientRequestId: key, kind: 'SELFIE' });
      const replay = await api(tokenFor(admin), 'POST', `/kyc/${A.submission.id}/material-requests`, { clientRequestId: key, kind: 'SELFIE' });
      assert.equal(first.status, 201); assert.equal(replay.status, 200);
      assert.equal((await first.json()).materialRequest.id, (await replay.json()).materialRequest.id);
      const rowsA = await prisma.kycMaterialRequest.findMany({ where: { submissionId: A.submission.id }, orderBy: { createdAt: 'asc' } });
      assert.equal(rowsA.length, 2);
      assert.equal(rowsA[0].closedOutcome, 'SUPERSEDED'); assert.ok(rowsA[0].documentReceivedAt, 'superseded request keeps what arrived');
      const { context, page, errors } = await openPage(DESKTOP, tokenFor(admin));
      await page.goto(`${origin}/admin/kyc?user=${A.user.id}`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-kyc-review="${A.submission.id}"]`);
      await card.locator('[data-kyc-material-history]').getByText('заменён новым запросом', { exact: false }).waitFor({ timeout: 15000 });
      await page.screenshot({ path: path.join(out, 'admin-history-1440.png'), fullPage: true });
      await context.close();
      assert.deepEqual(errors, []);
      // C: reject from the comparison screen with a reason.
      const r = await openPage(DESKTOP, tokenFor(admin));
      await r.page.goto(`${origin}/admin/kyc?user=${C.user.id}`, { waitUntil: 'domcontentloaded' });
      const cardC = r.page.locator(`[data-kyc-review="${C.submission.id}"]`);
      await cardC.locator('[data-kyc-stage="MATERIALS_RECEIVED"]').waitFor({ timeout: 15000 });
      await cardC.locator('input[type="text"]').first().fill('Synthetic QA: документ не совпадает с данными заявки');
      await cardC.getByRole('button', { name: 'Сравнить документ и селфи' }).click();
      await r.page.locator('[data-kyc-compare]').getByRole('button', { name: 'Отклонить', exact: true }).click();
      const dialog = r.page.getByRole('dialog', { name: 'Отклонить заявку на проверку' });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Подтвердить решение' }).click();
      await r.page.waitForResponse((x) => /\/kyc\/[^/]+\/review$/.test(new URL(x.url()).pathname));
      await r.page.waitForTimeout(300);
      assert.equal((await prisma.user.findUnique({ where: { id: C.user.id } })).kycStatus, 'REJECTED');
      assert.equal((await prisma.kycMaterialRequest.findUnique({ where: { id: requestC.id } })).closedOutcome, 'REJECTED');
      await r.context.close();
      const u = await openPage(390, tokenFor(C.user));
      await u.page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await u.page.getByText('Synthetic QA: документ не совпадает с данными заявки').waitFor({ timeout: 15000 });
      assert.equal(await u.page.locator('[data-kyc-materials]').count(), 0);
      await u.context.close();
      step('11. repeats: same click key → same request (201 then 200); a new request supersedes the old one (history keeps it and its files); «Отклонить» from the comparison → REJECTED, request closed, the user sees the reason');
    }

    // ── 12. Layout: user request panel and admin card at 320/360/390/430 + desktop ──
    {
      const E = await pendingUser('user-e-layout', 'Synthetic Epsilon Person With A Rather Long Name');
      await api(tokenFor(admin), 'POST', `/kyc/${E.submission.id}/material-requests`, { clientRequestId: randomUUID(), kind: 'DOCUMENT_AND_SELFIE', documentReason: 'OTHER', documentReasonText: 'На фото блик закрывает номер документа и дату выдачи' });
      for (const width of [...MOBILE, DESKTOP]) {
        const { context, page, errors } = await openPage(width, tokenFor(E.user));
        await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
        const selfie = page.locator('[data-kyc-material-part="SELFIE"]');
        await selfie.getByRole('button', { name: 'Сделать селфи' }).click({ timeout: 15000 });
        await page.getByText('Причина: На фото блик закрывает номер документа и дату выдачи').waitFor();
        const overflow = await overflowOf(page);
        const small = await page.evaluate(() => [...document.querySelectorAll('[data-kyc-materials] button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim()));
        report.layout.push({ screen: 'user-request', width, overflow, smallButtons: small });
        assert.ok(overflow <= 1, `user page overflows by ${overflow}px at ${width}`);
        assert.deepEqual(small, [], `touch targets ≥ 40 px at ${width}`);
        await page.screenshot({ path: path.join(out, `user-request-${width}.png`), fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
      }
      for (const width of [...MOBILE, DESKTOP]) {
        const { context, page, errors } = await openPage(width, tokenFor(admin));
        await page.goto(`${origin}/admin/kyc?user=${E.user.id}`, { waitUntil: 'domcontentloaded' });
        const card = page.locator(`[data-kyc-review="${E.submission.id}"]`);
        await card.locator('[data-kyc-stage="DOCUMENT_AND_SELFIE_REQUIRED"]').waitFor({ timeout: 15000 });
        await card.getByRole('button', { name: 'Запросить дополнительные материалы' }).click();
        await card.locator('input[value="DOCUMENT_AND_SELFIE"]').check();
        await card.locator('[data-kyc-request-reason]').selectOption('LOW_LIGHT');
        const overflow = await overflowOf(page);
        report.layout.push({ screen: 'admin-request-form', width, overflow });
        assert.ok(overflow <= 1, `admin overflows by ${overflow}px at ${width}`);
        await page.screenshot({ path: path.join(out, `admin-request-${width}.png`), fullPage: true });
        await card.getByRole('button', { name: 'Отмена', exact: true }).click();
        await card.getByRole('button', { name: 'Сравнить документ и селфи' }).click();
        const compareOverflow = await page.evaluate(() => { const d = document.querySelector('[data-kyc-compare]'); return d.scrollWidth - d.clientWidth; });
        report.layout.push({ screen: 'admin-compare-empty', width, overflow: compareOverflow });
        assert.ok(compareOverflow <= 1);
        if (width === 320) await page.screenshot({ path: path.join(out, 'admin-compare-320.png') });
        assert.deepEqual(errors, []);
        await context.close();
      }
      step(`12. layout: user request panel and admin request form/comparison at ${[...MOBILE, DESKTOP].join('/')} px — no horizontal overflow, touch targets ≥ 40 px`);
    }

    const pii = [A.fullName, B.fullName, C.fullName, A.user.email, B.user.email, C.user.email, '/9j/'];
    for (const secret of pii) assert.equal(edgeLogs.join('\n').includes(secret), false, `edge log leaked ${secret}`);
    assert.equal(meter.multipart, 0, 'no multipart body ever reached Render');
    assert.equal(meter.documentReads, 0);
    assert.ok(meter.maxBody < 4096, `largest request body to Render: ${meter.maxBody} B`);
    report.renderMeter = { requests: meter.requests, bytesIn: meter.bytesIn, maxBodyBytes: meter.maxBody, multipartBodies: meter.multipart, documentReads: meter.documentReads };
    report.emails = sink.mails.length;
    report.adminNotifications = notifications.map((n) => ({ eventType: n.eventType, part: n.part, complete: n.complete, keys: Object.keys(n).sort() }));
    report.edgeLogLines = edgeLogs.length;
    report.externalRequestsBlocked = [...new Set(externalAttempts)];
    step('files never reach Render (0 multipart, largest body < 4 KB, 0 document reads); edge logs carry identifiers only', report.renderMeter);
    report.result = 'PASS';
  } catch (err) {
    report.result = 'FAIL';
    report.error = String(err && err.stack || err);
    throw err;
  } finally {
    console.log = log;
    try { fs.unlinkSync(path.join(out, '.selfie-from-mail.jpg')); } catch { /* not created */ }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
    edge.close();
    await prisma.$disconnect();
  }
})().catch((err) => { console.error(err); process.exit(1); });
