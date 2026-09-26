'use strict';

/**
 * KYC edge, end to end in a real browser.
 *
 *   production frontend bundle (built with VITE_KYC_EDGE_URL=http://127.0.0.1:18787)
 *   → the REAL Worker logic (workers/kyc-edge/src/core.js) on a local HTTP shim,
 *     its email binding replaced by a sink that keeps the raw MIME
 *   → the REAL Render routes (dist/api/routes/kyc.js + admin.js)
 *   → PostgreSQL (KYC_QA_DATABASE_URL, CI) or an in-memory stand-in (local).
 *
 * Every request that reaches the "Render" server is metered, so the report
 * states how many document bytes it saw (must be 0) and whether a multipart
 * body or /kyc/:id/document read ever reached it (must not).
 *
 * Synthetic documents only (rendered in the browser from a QA template).
 *
 * Needs: npm run build; VITE_KYC_EDGE_URL=http://127.0.0.1:18787 npm run build --prefix frontend;
 * QA_PLAYWRIGHT_MODULE (or playwright resolvable).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { webcrypto, randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const EDGE_PORT = 18787;
const JWT_SECRET = 'kyc-edge-qa-only-secret-at-least-32-chars';
process.env.JWT_SECRET = JWT_SECRET;
const dbUrl = process.env.KYC_QA_DATABASE_URL || '';
if (dbUrl) {
  const parsed = new URL(dbUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_kyc_test') throw new Error('disposable localhost test database required');
  process.env.DATABASE_URL = dbUrl;
}

const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { kycRouter } = require(path.join(root, 'dist/api/routes/kyc.js'));
const { adminRouter } = require(path.join(root, 'dist/api/routes/admin.js'));
const { KycEdgeTrust } = require(path.join(root, 'dist/services/KycEdgeTrust.js'));

const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/kyc-edge'));
const WIDTHS = [320, 360, 390, 430, 1440];

// ───────────────────────────── in-memory Prisma stand-in (local runs only)
function memoryPrisma() {
  const users = new Map();
  const subs = new Map();
  const audit = [];
  let chain = Promise.resolve();
  const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  const sortDesc = (rows) => rows.sort((a, b) => b.createdAt - a.createdAt);
  const api = {
    user: {
      findUnique: async ({ where, select }) => { const u = users.get(where.id) || [...users.values()].find((x) => x.email === where.email); return u ? pick(u, select) : null; },
      findUniqueOrThrow: async (a) => { const r = await api.user.findUnique(a); if (!r) throw new Error('not found'); return r; },
      findMany: async () => sortDesc([...users.values()].map((u) => ({ ...u }))),
      update: async ({ where, data }) => { const u = users.get(where.id); Object.assign(u, data); return { ...u }; },
      create: async ({ data }) => { const u = { id: randomUUID(), role: 'USER', kycStatus: 'NOT_STARTED', createdAt: new Date(), ...data }; users.set(u.id, u); return { ...u }; },
    },
    kycSubmission: {
      findUnique: async ({ where, select }) => { const s = subs.get(where.id); return s ? pick(s, select) : null; },
      findFirst: async ({ where, select } = {}) => { const s = sortDesc([...subs.values()].filter((r) => matches(r, where)))[0]; return s ? pick(s, select) : null; },
      findMany: async ({ where } = {}) => sortDesc([...subs.values()].filter((r) => matches(r, where))).map((s) => ({ ...s })),
      count: async ({ where } = {}) => [...subs.values()].filter((r) => matches(r, where)).length,
      create: async ({ data }) => {
        if (subs.has(data.id)) { const e = new Error('Unique constraint failed'); e.code = 'P2002'; throw e; }
        const s = { status: 'PENDING', rejectionReason: null, reviewedBy: null, reviewedAt: null, createdAt: new Date(), ...data }; subs.set(s.id, s); return { ...s };
      },
      update: async ({ where, data }) => { const s = subs.get(where.id); Object.assign(s, data); return { ...s }; },
    },
    auditLog: { create: async ({ data }) => { audit.push(data); return data; } },
    // FOR UPDATE: callers are serialized, like row locks on one user.
    $transaction: (fn) => { const run = chain.then(() => fn(api)); chain = run.catch(() => {}); return run; },
    $queryRaw: async (strings, ...values) => { const u = users.get(values[0]); return u ? [{ id: u.id, kycStatus: u.kycStatus }] : []; },
    $disconnect: async () => {},
  };
  return api;
}

// ───────────────────────────── mail sink standing in for Email Routing
function mailSink() {
  const mails = [];
  let mode = 'accept';
  return {
    mails,
    setMode: (m) => { mode = m; },
    send: async (from, to, raw) => {
      if (mode === 'reject') throw Object.assign(new Error('sink refused'), { code: 'E_QA_REJECT' });
      // Like the platform: it assigns its own Message-ID and reports it back.
      const messageId = `qa-${randomUUID().replace(/-/g, '')}@voltextech.net`;
      mails.push({ from, to, messageId, raw: Buffer.from(raw).toString('latin1') });
      return { messageId };
    },
  };
}

function attachmentOf(mail) {
  const m = mail.raw.match(/Content-Disposition: attachment; filename="([^"]+)"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/);
  assert.ok(m, 'mail has one base64 attachment');
  return { filename: m[1], bytes: Buffer.from(m[2].replace(/\s+/g, ''), 'base64') };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { environment: '', steps: [], widths: [], renderMeter: null };
  const step = (name, detail = {}) => { report.steps.push({ name, ...detail }); console.log(`✓ ${name}`); };

  let prisma;
  if (dbUrl) {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const stale = (await prisma.user.findMany({ where: { email: { endsWith: '@kyc-qa.invalid' } }, select: { id: true } })).map((u) => u.id);
    await prisma.kycSubmission.deleteMany({ where: { userId: { in: stale } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: stale } } });
    await prisma.user.deleteMany({ where: { id: { in: stale } } });
    report.environment = 'production bundle + real Worker core.js + real Render kyc/admin routers + PostgreSQL';
  } else {
    prisma = memoryPrisma();
    report.environment = 'production bundle + real Worker core.js + real Render kyc/admin routers + in-memory DB stand-in';
  }
  const mkUser = (tag, extra = {}) => prisma.user.create({ data: { email: `${tag}@kyc-qa.invalid`, passwordHash: 'QA_ONLY', referralCode: `KYCQA${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}${Math.floor(Math.random() * 1e6)}`, ...extra } });
  const admin = await mkUser('admin', { role: 'ADMIN' });
  const tokenFor = (u) => jwt.sign({ sub: u.id }, JWT_SECRET);

  // ── the edge (real core.js) ──
  const core = await import(require('node:url').pathToFileURL(path.join(root, 'workers/kyc-edge/src/core.js')).href);
  const { privateKey } = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);
  process.env.KYC_EDGE_PUBLIC_KEY = jwk.x;
  const sink = mailSink();
  const idem = new Map();

  // ── "Render": real routers, metered ──
  const meter = { requests: 0, bytesIn: 0, maxBody: 0, multipart: 0, documentReads: 0, paths: [] };
  let failConfirmOnce = false;
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
  app.use('/api/v1/internal/kyc/submission-confirmed', (req, res, next) => {
    if (failConfirmOnce) { failConfirmOnce = false; return res.status(503).json({ error: 'QA: render briefly down' }); }
    next();
  });
  app.use('/api/v1', kycRouter(prisma, new KycEdgeTrust()));
  app.use('/api/v1', adminRouter(prisma));
  app.get('/api/v1/me', async (req, res) => {
    try {
      const { sub } = jwt.verify(String(req.headers.authorization || '').slice(7), JWT_SECRET);
      const u = await prisma.user.findUnique({ where: { id: sub } });
      res.json({ id: u.id, email: u.email, displayName: 'QA', avatarUrl: null, role: u.role, isAdmin: u.role === 'ADMIN', kycStatus: u.kycStatus, twoFactorEnabled: false, createdAt: new Date().toISOString() });
    } catch { res.status(401).json({ error: 'Missing bearer token' }); }
  });
  app.get('/api/v1/admin/overview', (_q, res) => res.json({ totalUsers: 1, pendingKyc: 0, pendingWithdrawals: 0, creditedDepositsToday: 0, unmatchedIncoming: null, unmatchedIncomingReason: 'live_provider_feed', dayStart: new Date().toISOString(), asOf: new Date().toISOString() }));
  app.use('/api/v1', (req, res) => (req.method === 'GET' ? res.json([]) : res.status(404).json({ error: 'not in QA' })));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  const edgeEnv = { KYC_EDGE_SIGNING_JWK: JSON.stringify(jwk), VOLTEX_API_ORIGIN: origin, ALLOWED_ORIGINS: origin };
  const edge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('cf-connecting-ip', '127.0.0.1');
    const request = new Request(`http://127.0.0.1:${EDGE_PORT}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body });
    const waits = [];
    const response = await core.handle(request, edgeEnv, { waitUntil: (p) => waits.push(p) }, {
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

  const uploadsDir = path.join(root, 'uploads', 'kyc');
  const uploadsBefore = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    async function openPage(width, token) {
      const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 }, locale: 'ru-RU' });
      await context.addInitScript(([t]) => { localStorage.setItem('exchange_lang', 'ru'); if (t) localStorage.setItem('exchange_token', t); }, [token]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      return { context, page, errors };
    }

    // Synthetic documents, rendered by the browser itself: a large photo-like JPEG (with a
    // fake EXIF block spliced in, to prove it is stripped), a PNG and a PDF.
    const { context: gen, page: genPage } = await openPage(1440, null);
    await genPage.setViewportSize({ width: 1600, height: 1000 });
    await genPage.setContent('<body style="margin:0;background:linear-gradient(135deg,#dfe7f5,#f7efe1)"><div style="font:bold 64px sans-serif;padding:80px;color:#223">SYNTHETIC TEST DOCUMENT<br>NOT A REAL PERSON<br><span style="font-size:32px">QA · VOLTEX KYC EDGE</span></div></body>');
    const jpegPlain = await genPage.screenshot({ type: 'jpeg', quality: 98, scale: 'device', fullPage: false });
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x16]), Buffer.from('Exif\0\0QA-GPS-51.5N-0.1W')]);
    const bigJpeg = Buffer.concat([jpegPlain.subarray(0, 2), exif, jpegPlain.subarray(2)]);
    const png = await genPage.screenshot({ type: 'png' });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    await gen.close();

    async function fillForm(page, { name, file }) {
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      const form = page.locator('form').filter({ has: page.locator('input[type="file"]') });
      await form.waitFor({ timeout: 15000 });
      await form.locator('input[type="text"]').first().fill(name);
      await form.locator('input[type="date"]').fill('1990-01-01');
      await form.locator('select').last().selectOption('ID_CARD');
      await form.locator('input[type="file"]').setInputFiles(file);
      return form;
    }

    // ── 1. JPEG at 1440: compression, EXIF stripped, double click → one email, PENDING ──
    const u1 = await mkUser('user-jpeg');
    {
      const { context, page, errors } = await openPage(1440, tokenFor(u1));
      const form = await fillForm(page, { name: 'Synthetic Jpeg Person', file: { name: 'passport-AB1234567.jpg', mimeType: 'image/jpeg', buffer: bigJpeg } });
      const sizeLine = form.locator('[data-kyc-file-size]');
      await sizeLine.filter({ hasText: 'Файл готов' }).waitFor({ timeout: 10000 });
      const shown = (await sizeLine.textContent()).trim();
      const before = meter.requests;
      await form.locator('button[type="submit"]').dblclick();
      await page.getByText('На рассмотрении').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      assert.equal(sink.mails.length, 1, 'double click → one email');
      const mail = sink.mails[0];
      assert.equal(mail.to, 'voltex.crypto@gmail.com');
      assert.match(mail.raw, /^Subject: =\?UTF-8\?B\?/m);
      const subject = mail.raw.match(/^Subject: ([\s\S]*?)\r\n(?! )/m)[1].split(/\r\n /).map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
      assert.equal(subject, `[KYC] Новая заявка — Synthetic Jpeg Person — ${u1.email}`);
      const att = attachmentOf(mail);
      assert.match(att.filename, /^kyc-[0-9a-f-]{36}\.jpg$/);
      assert.ok(!mail.raw.includes('AB1234567'), 'browser file name never reaches the email');
      assert.equal(att.bytes[0], 0xff); assert.equal(att.bytes[1], 0xd8);
      assert.ok(!att.bytes.includes(Buffer.from('QA-GPS')), 'EXIF/GPS stripped');
      const row = await prisma.kycSubmission.findFirst({ where: { userId: u1.id } });
      assert.equal(row.documentImagePath, null);
      assert.equal(row.documentDelivery, 'EMAIL');
      assert.equal(row.documentSizeBytes, att.bytes.length);
      assert.equal(row.emailMessageId, mail.messageId, 'the provider-reported Message-ID is recorded');
      const kycCalls = meter.paths.slice(-4);
      assert.equal(meter.multipart, 0, 'no multipart body ever reached Render');
      step('JPEG 1440: re-encoded + EXIF stripped, double click → 1 email to the fixed recipient, 1 metadata row, PENDING shown', {
        original: bigJpeg.length, uploaded: att.bytes.length, shownSize: shown, renderRequestsForSubmit: meter.requests - before, renderKycCalls: kycCalls,
      });
      await page.screenshot({ path: path.join(out, 'user-pending-1440.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 2. Email provider rejects → error, no row; accept → same attempt, one email ──
    const u2 = await mkUser('user-reject');
    {
      const { context, page, errors } = await openPage(390, tokenFor(u2));
      const form = await fillForm(page, { name: 'Synthetic Png Person', file: { name: 'scan.png', mimeType: 'image/png', buffer: png } });
      await form.locator('[data-kyc-file-size]').filter({ hasText: 'Файл готов' }).waitFor({ timeout: 10000 });
      sink.setMode('reject');
      const mailsBefore = sink.mails.length;
      await form.locator('button[type="submit"]').click();
      await form.getByText('Документ не отправлен').waitFor({ timeout: 10000 });
      assert.equal(await prisma.kycSubmission.count({ where: { userId: u2.id } }), 0, 'no Neon row when the email failed');
      assert.equal((await prisma.user.findUnique({ where: { id: u2.id } })).kycStatus, 'NOT_STARTED');
      step('email provider rejected → error shown, no DB row, status unchanged');
      sink.setMode('accept');
      await form.locator('button[type="submit"]').click();
      await page.getByText('На рассмотрении').first().waitFor({ timeout: 15000 });
      assert.equal(sink.mails.length - mailsBefore, 1);
      assert.equal(await prisma.kycSubmission.count({ where: { userId: u2.id } }), 1);
      step('retry after the rejection → 1 email, 1 row, PENDING (390 px)');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 3. Render down after the email was accepted → receipt, then metadata-only retry ──
    const u3 = await mkUser('user-callback');
    {
      const { context, page, errors } = await openPage(1440, tokenFor(u3));
      const form = await fillForm(page, { name: 'Synthetic Pdf Person', file: { name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf } });
      await form.locator('[data-kyc-file-size]').filter({ hasText: 'Файл готов' }).waitFor({ timeout: 10000 });
      const mailsBefore = sink.mails.length;
      failConfirmOnce = true;
      await form.locator('button[type="submit"]').click();
      await page.getByText('На рассмотрении').first().waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !localStorage.getItem('voltex_kyc_receipt'), null, { timeout: 20000 });
      await page.waitForTimeout(300);
      assert.equal(sink.mails.length - mailsBefore, 1, 'never a second email');
      assert.equal(attachmentOf(sink.mails.at(-1)).bytes.subarray(0, 5).toString(), '%PDF-');
      assert.equal(await prisma.kycSubmission.count({ where: { userId: u3.id } }), 1);
      step('PDF: callback failed after the email was accepted → PENDING shown, sealed receipt retried, 1 email, 1 row');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 4. Fake file type (text renamed .png) → refused by magic bytes, nothing sent ──
    const u4 = await mkUser('user-fake');
    {
      const { context, page } = await openPage(360, tokenFor(u4));
      const form = await fillForm(page, { name: 'Synthetic Fake Person', file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>not an image</svg>') } });
      await page.waitForTimeout(800);
      const mailsBefore = sink.mails.length;
      if (await form.locator('button[type="submit"]').isEnabled()) await form.locator('button[type="submit"]').click();
      await form.getByText('Подходят только JPEG, PNG или PDF.').waitFor({ timeout: 10000 });
      assert.equal(sink.mails.length, mailsBefore);
      assert.equal(await prisma.kycSubmission.count({ where: { userId: u4.id } }), 0);
      step('fake image (bad magic bytes) → refused, no email, no row (360 px)');
      await context.close();
    }

    // ── 5. Direct edge probes: unauthenticated, already pending, already approved ──
    {
      const probe = (token) => {
        const f = new FormData();
        for (const [k, v] of Object.entries({ requestId: randomUUID(), country: 'UA', fullName: 'Synthetic Probe', dateOfBirth: '1990-01-01', documentType: 'PASSPORT' })) f.append(k, v);
        f.append('document', new Blob([pdf], { type: 'application/pdf' }), 'x.pdf');
        return fetch(`http://127.0.0.1:${EDGE_PORT}/v1/submit`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin }, body: f });
      };
      const mailsBefore = sink.mails.length;
      assert.equal((await probe(null)).status, 401);
      const pending = await probe(tokenFor(u1));
      assert.equal(pending.status, 409); assert.equal((await pending.json()).code, 'kyc_already_pending');
      const approvedUser = await mkUser('user-approved', { kycStatus: 'APPROVED' });
      const approved = await probe(tokenFor(approvedUser));
      assert.equal(approved.status, 409); assert.equal((await approved.json()).code, 'kyc_already_verified');
      assert.equal(sink.mails.length, mailsBefore);
      step('edge probes: unauthenticated 401, already pending 409, already approved 409 — no email');
    }

    // ── 6. The form at every width: same fields, no horizontal overflow ──
    for (const width of WIDTHS) {
      const u = await mkUser(`user-w${width}`);
      const { context, page, errors } = await openPage(width, tokenFor(u));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      const form = page.locator('form').filter({ has: page.locator('input[type="file"]') });
      await form.waitFor({ timeout: 15000 });
      // The untouched form (nothing selected, so none of this change's markup is shown).
      const pristineOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      console.log(JSON.stringify({ width, pristineOverflow }));
      await form.locator('input[type="file"]').setInputFiles({ name: 'doc.jpg', mimeType: 'image/jpeg', buffer: jpegPlain });
      await form.locator('[data-kyc-file-size]').filter({ hasText: 'Файл готов' }).waitFor({ timeout: 10000 });
      const layout = await page.evaluate(() => {
        const f = [...document.querySelectorAll('form')].find((x) => x.querySelector('input[type="file"]'));
        const r = f.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          formOverflow: f.scrollWidth - f.clientWidth,
          offenders: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(-6).map((el) => `${el.tagName.toLowerCase()}[${String(el.getAttribute('class') || '').slice(0, 50)}] w=${Math.round(el.getBoundingClientRect().width)} r=${Math.round(el.getBoundingClientRect().right)} inForm=${f.contains(el)}`),
          formInside: r.left >= -1 && r.right <= window.innerWidth + 1,
          fields: { text: !!f.querySelector('input[type="text"]'), date: !!f.querySelector('input[type="date"]'), select: !!f.querySelector('select'), file: !!f.querySelector('input[type="file"]'), submit: !!f.querySelector('button[type="submit"]') },
        };
      });
      report.widths.push({ width, ...layout });
      console.log(JSON.stringify({ width, overflow: layout.overflow, formOverflow: layout.formOverflow, offenders: layout.offenders }));
      await page.screenshot({ path: path.join(out, `user-page-${width}.png`), fullPage: true });
      assert.ok(layout.overflow <= 1, `page overflows by ${layout.overflow}px at ${width}`);
      assert.ok(layout.formOverflow <= 1, `the KYC form itself overflows at ${width}`);
      assert.ok(layout.formInside, `form leaves the viewport at ${width}`);
      assert.deepEqual(layout.fields, { text: true, date: true, select: true, file: true, submit: true });
      await form.screenshot({ path: path.join(out, `user-form-${width}.png`) });
      assert.deepEqual(errors, []);
      await context.close();
    }
    step(`form at ${WIDTHS.join('/')}: all fields present, no horizontal overflow`);

    // ── 7. Admin: emailed document, no document request, «Проверено» → APPROVED ──
    for (const width of [390, 1440]) {
      const { context, page, errors } = await openPage(width, tokenFor(admin));
      const readsBefore = meter.documentReads;
      await page.goto(`${origin}/admin/kyc?user=${u1.id}`, { waitUntil: 'domcontentloaded' });
      const card = page.locator(`[data-kyc-review]`).first();
      await card.waitFor({ timeout: 15000 });
      await card.locator('[data-kyc-document-emailed]').getByText('Документ отправлен на email администратора').waitFor({ timeout: 10000 });
      await card.getByText((await prisma.kycSubmission.findFirst({ where: { userId: u1.id } })).emailMessageId).waitFor();
      await page.waitForTimeout(400);
      assert.equal(meter.documentReads, readsBefore, 'admin never requests an emailed document from Render');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `admin overflows by ${overflow}px at ${width}`);
      await page.screenshot({ path: path.join(out, `admin-kyc-${width}.png`), fullPage: true });
      if (width === 1440) {
        await card.getByRole('button', { name: 'Проверено' }).click();
        await page.waitForTimeout(800);
        assert.equal((await prisma.user.findUnique({ where: { id: u1.id } })).kycStatus, 'APPROVED');
        const u2Row = await prisma.kycSubmission.findFirst({ where: { userId: u2.id } });
        await page.goto(`${origin}/admin/kyc?user=${u2.id}`, { waitUntil: 'domcontentloaded' });
        const card2 = page.locator(`[data-kyc-review="${u2Row.id}"]`);
        await card2.waitFor({ timeout: 15000 });
        await card2.locator('input[type="text"]').fill('Synthetic QA rejection');
        await card2.getByRole('button', { name: 'Отклонить' }).click();
        await page.waitForTimeout(800);
        assert.equal((await prisma.user.findUnique({ where: { id: u2.id } })).kycStatus, 'REJECTED');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    step('admin 390/1440: «Документ отправлен на email администратора» + Message-ID, 0 document reads; «Проверено» → APPROVED, «Отклонить» → REJECTED');

    // ── 8. The user sees APPROVED; REJECTED user sees the reason and the form again ──
    {
      const { context, page } = await openPage(390, tokenFor(u1));
      await page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Верифицировано').first().waitFor({ timeout: 15000 });
      assert.equal(await page.locator('input[type="file"]').count(), 0);
      await context.close();
      const r = await openPage(390, tokenFor(u2));
      await r.page.goto(`${origin}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await r.page.getByText('Synthetic QA rejection').waitFor({ timeout: 15000 });
      assert.equal(await r.page.locator('input[type="file"]').count(), 1);
      await r.context.close();
      step('user: APPROVED shows verified without a form; REJECTED shows the reason and the form');
    }

    const uploadsAfter = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0;
    assert.equal(uploadsAfter, uploadsBefore, 'no uploads/kyc file written');
    assert.equal(meter.multipart, 0);
    assert.ok(meter.maxBody < 4096, `largest request body to Render: ${meter.maxBody} B`);
    report.renderMeter = { requests: meter.requests, bytesIn: meter.bytesIn, maxBodyBytes: meter.maxBody, multipartBodies: meter.multipart, documentReads: meter.documentReads, uploadsKycNewFiles: uploadsAfter - uploadsBefore };
    report.emails = sink.mails.length;
    step('Render meter: 0 multipart bodies, 0 document reads, 0 uploads/kyc files, largest body < 4 KB', report.renderMeter);
    report.result = 'PASS';
  } catch (err) {
    report.result = 'FAIL';
    report.error = String(err && err.stack || err);
    throw err;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
    edge.close();
    await prisma.$disconnect();
  }
})().catch((err) => { console.error(err); process.exit(1); });
