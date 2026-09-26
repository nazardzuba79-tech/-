'use strict';

/**
 * Support chat → Postgres → outbox → SMTP, end to end in a real browser.
 *
 * The production frontend bundle talks to the REAL support and admin
 * support routers (compiled backend, dist/) on a disposable localhost
 * Postgres, and the REAL SupportEmailService sends through a local SMTP
 * sink that speaks enough RFC 5321 for Nodemailer (no mail leaves the
 * machine). Everything else the pages ask for is a small read-only fixture.
 *
 * Checks: a guest's first message and a second one (one POST each, even on
 * a double click), a signed-in user's message, the error line when a send
 * fails, a message sent while the relay is down (kept in the DB and the
 * chat, notification PENDING with a category, the admin page says
 * «Проблема»), the admin inbox (thread, delivery state, reply reaching the
 * widget) and the test-letter button, at 1440/430/390/360/320.
 *
 * Needs: npm run build (backend dist/), npm run build --prefix frontend,
 * SUPPORT_QA_DATABASE_URL=postgresql://…@127.0.0.1:…/voltex_support_test
 * with migrations applied.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const dbUrl = process.env.SUPPORT_QA_DATABASE_URL;
if (!dbUrl) throw new Error('SUPPORT_QA_DATABASE_URL is required');
const parsedDb = new URL(dbUrl);
if (parsedDb.hostname !== '127.0.0.1' || parsedDb.pathname !== '/voltex_support_test') throw new Error('disposable localhost test database required');

const JWT_SECRET = 'support-qa-only-secret-at-least-32-chars';
process.env.JWT_SECRET = JWT_SECRET;
process.env.DATABASE_URL = dbUrl;
const RECIPIENT = 'voltex.crypto@gmail.com';

const express = require('express');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const { supportRouter } = require(path.join(root, 'dist/api/routes/support.js'));
const { adminSupportRouter } = require(path.join(root, 'dist/api/routes/adminSupport.js'));
const { SupportEmailService } = require(path.join(root, 'dist/services/SupportEmailService.js'));
const { SupportNotificationOutbox } = require(path.join(root, 'dist/services/SupportNotificationOutbox.js'));

const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/support-email'));

/** Enough SMTP for Nodemailer: greeting, EHLO, MAIL, RCPT, DATA, QUIT. Stores each message. */
function smtpSink() {
  const mails = [];
  let accepting = true;
  const server = net.createServer((socket) => {
    if (!accepting) { socket.destroy(); return; }
    let buffer = '';
    let inData = false;
    let current = { from: '', to: [], data: '' };
    socket.write('220 qa-sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            mails.push(current);
            current = { from: '', to: [], data: '' };
            socket.write('250 2.0.0 queued\r\n');
          } else current.data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) socket.write('250-qa-sink\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) socket.write('250 qa-sink\r\n');
        else if (cmd.startsWith('MAIL FROM')) { current.from = line.slice(10); socket.write('250 2.1.0 ok\r\n'); }
        else if (cmd.startsWith('RCPT TO')) { current.to.push(line.slice(8)); socket.write('250 2.1.5 ok\r\n'); }
        else if (cmd === 'DATA') { inData = true; socket.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { socket.end('221 bye\r\n'); }
        else if (cmd === 'RSET' || cmd === 'NOOP') socket.write('250 ok\r\n');
        else socket.write('502 not implemented\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return { server, mails, setAccepting: (value) => { accepting = value; } };
}

/** Decodes the text/plain body Nodemailer produced (base64 or quoted-printable or 8bit). */
function bodyOf(mail) {
  const [head, ...rest] = mail.data.split('\n\n');
  const raw = rest.join('\n\n');
  if (/Content-Transfer-Encoding: base64/i.test(head)) return Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(head)) {
    return Buffer.from(raw.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  }
  return raw;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const report = { environment: 'production frontend bundle + real support/admin routers + local Postgres + local SMTP sink', steps: [], widths: [] };
  const step = (name, detail = {}) => { report.steps.push({ name, ...detail }); console.log(`✓ ${name}`); };

  await prisma.supportNotification.deleteMany({});
  await prisma.supportMessage.deleteMany({});
  await prisma.supportConversation.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'SUPPORT_' } } });
  const admin = await prisma.user.upsert({ where: { email: 'support-qa-admin@example.invalid' }, update: { role: 'ADMIN' },
    create: { email: 'support-qa-admin@example.invalid', passwordHash: 'QA_ONLY', referralCode: 'SUPPORTQAADMIN', role: 'ADMIN' } });
  const member = await prisma.user.upsert({ where: { email: 'support-qa-user@example.invalid' }, update: {},
    create: { email: 'support-qa-user@example.invalid', passwordHash: 'QA_ONLY', referralCode: 'SUPPORTQAUSER' } });
  const tokenFor = (user) => jwt.sign({ sub: user.id }, JWT_SECRET);

  const sink = smtpSink();
  sink.server.listen(0, '127.0.0.1');
  await once(sink.server, 'listening');
  const email = new SupportEmailService(undefined, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.server.address().port), SMTP_SECURE: 'false',
    SUPPORT_ADMIN_EMAIL: RECIPIENT, SUPPORT_FROM_EMAIL: 'support-qa@voltex.example',
  });
  const outbox = new SupportNotificationOutbox(prisma, email, { log: (line) => report.steps.push({ log: line }) });

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const posts = [];
  app.use('/api/v1', (req, _res, next) => { if (req.method === 'POST') posts.push(req.path); next(); });
  app.use('/api/v1', supportRouter(prisma, outbox, { rateLimit: false }));
  app.use('/api/v1', adminSupportRouter(prisma, email, outbox));
  app.get('/api/v1/me', (req, res) => {
    const header = req.headers.authorization || '';
    try {
      const { sub } = jwt.verify(header.slice(7), JWT_SECRET);
      const isAdmin = sub === admin.id;
      res.json({ id: sub, email: isAdmin ? admin.email : member.email, displayName: isAdmin ? 'QA Admin' : 'QA User', role: isAdmin ? 'ADMIN' : 'USER', isAdmin, kycStatus: 'NOT_STARTED' });
    } catch { res.status(401).json({ error: 'Missing bearer token' }); }
  });
  app.get('/api/v1/market/external/tickers', (_q, res) => res.json({ tickers: [] }));
  app.get('/api/v1/futures/config', (_q, res) => res.json({ symbols: [] }));
  app.use('/api/v1', (req, res) => (req.method === 'GET' ? res.json([]) : res.status(404).json({ error: 'not in QA' })));
  app.use(express.static(dist, { index: false }));
  app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((err, _q, res, _n) => { console.error('server error', err?.name); res.status(500).json({ error: 'Internal server error' }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  const waitFor = async (fn, what, ms = 8000) => {
    const until = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 100)); }
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

    async function openPage(width, token) {
      const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 }, locale: 'en-US' });
      await context.addInitScript(([t]) => { localStorage.setItem('exchange_lang', 'ru'); if (t) localStorage.setItem('exchange_token', t); }, [token]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      return { context, page, errors };
    }

    // ── 1. Guest, desktop: first message, double click, second message ──
    {
      const { context, page, errors } = await openPage(1440, null);
      await page.goto(`${origin}/legal/terms`, { waitUntil: 'domcontentloaded' });
      await page.locator('.support-launcher').click();
      const panel = page.locator('.support-panel');
      await panel.getByPlaceholder('Имя').fill('VOLTEX Support QA');
      await panel.getByPlaceholder('Email').fill('qa-support@example.invalid');
      await panel.locator('select').selectOption('TECHNICAL');
      await panel.getByPlaceholder('Опишите свой вопрос...').fill('Production support email delivery test.\nNo action required.');
      const before = posts.length;
      await panel.getByRole('button', { name: 'Начать чат' }).dblclick();
      await panel.locator('text=Production support email delivery test.').first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      const starts = posts.slice(before).filter((p) => p === '/support/conversations');
      assert.equal(starts.length, 1, 'double click must create one conversation');
      const conv = await prisma.supportConversation.findFirstOrThrow({ where: { guestEmail: 'qa-support@example.invalid' }, include: { messages: true, notifications: true } });
      assert.equal(conv.messages.length, 1);
      assert.equal(conv.notifications.length, 1);
      const sent = await waitFor(async () => (await prisma.supportNotification.findFirst({ where: { conversationId: conv.id, status: 'SENT' } })), 'first notification SENT');
      assert.equal(sent.recipient, RECIPIENT);
      const mail = sink.mails.at(-1);
      assert.deepEqual(mail.to, [`<${RECIPIENT}>`]);
      const body = bodyOf(mail);
      for (const part of ["Ім'я: VOLTEX Support QA", 'Email: qa-support@example.invalid', 'Тема: Техническая проблема', `Ticket ID: ${conv.id}`, 'Production support email delivery test.']) {
        assert.ok(body.includes(part), `mail body lacks ${part}`);
      }
      assert.match(mail.data, /Content-Type: text\/plain; charset=utf-8/);
      assert.match(mail.data, /Reply-To: qa-support@example\.invalid/);
      step('guest first message: 1 POST on double click, conversation+message+notification in Postgres, SMTP accepted, status SENT', { conversation: conv.id.slice(0, 8) });

      const input = panel.getByPlaceholder('Введите сообщение...');
      await input.fill('Second message from the guest.');
      const beforeSecond = posts.length;
      await panel.getByRole('button', { name: 'Отправить' }).dblclick();
      await panel.locator('text=Second message from the guest.').waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      assert.equal(posts.slice(beforeSecond).filter((p) => p.endsWith('/messages')).length, 1, 'double click must send one message');
      await waitFor(async () => (await prisma.supportNotification.count({ where: { conversationId: conv.id, status: 'SENT' } })) === 2, 'second notification SENT');
      assert.equal(sink.mails.length, 2);
      step('guest second message: 1 POST, own notification, SMTP accepted');

      // A failed send shows an error and keeps the draft.
      await page.route('**/api/v1/support/conversations/*/messages', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }), { times: 1 });
      await input.fill('This one fails once.');
      await panel.getByRole('button', { name: 'Отправить' }).click();
      await panel.getByRole('alert').waitFor({ timeout: 5000 });
      assert.equal(await input.inputValue(), 'This one fails once.');
      step('send failure: error line shown, draft kept');

      // Long unbroken text: no horizontal overflow in the panel.
      await input.fill('x'.repeat(1500));
      await panel.getByRole('button', { name: 'Отправить' }).click();
      await page.waitForTimeout(600);
      const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `panel overflows by ${overflow}px`);
      await page.screenshot({ path: path.join(out, 'guest-1440.png') });
      assert.deepEqual(errors, []);
      await context.close();
    }

    // ── 2. Relay down: the message is kept, the notification waits with a category ──
    {
      sink.setAccepting(false);
      const conv = await prisma.supportConversation.findFirstOrThrow({ where: { guestEmail: 'qa-support@example.invalid' } });
      const res = await fetch(`${origin}/api/v1/support/conversations/${conv.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Sent while SMTP is down.' }),
      });
      assert.equal(res.status, 201);
      const created = await res.json();
      const waiting = await waitFor(async () => {
        const row = await prisma.supportNotification.findUnique({ where: { messageId: created.id } });
        return row && row.attempts >= 1 && row.failureCategory ? row : null;
      }, 'failed attempt recorded', 45000);
      assert.equal(waiting.status, 'PENDING');
      assert.equal(waiting.failureCategory, 'CONNECTION');
      assert.ok(await prisma.supportMessage.findUnique({ where: { id: created.id } }), 'message must survive a failed send');
      step('SMTP down: HTTP 201, message stored, notification PENDING for retry', { category: waiting.failureCategory, nextAttemptInMs: waiting.nextAttemptAt.getTime() - Date.now() });
      sink.setAccepting(true);
    }

    // ── 3. Signed-in user on a phone-width page with the bottom tab bar ──
    for (const width of [430, 390, 360, 320]) {
      const { context, page, errors } = await openPage(width, tokenFor(member));
      // Markets carries the app header and the phone tab bar.
      await page.goto(`${origin}/markets`, { waitUntil: 'domcontentloaded' });
      const launcher = page.locator('.support-launcher');
      await launcher.waitFor({ timeout: 10000 });
      const nav = page.locator('.bottom-nav');
      try { await nav.waitFor({ timeout: 15000 }); } catch (error) {
        await page.screenshot({ path: path.join(out, `no-tab-bar-${width}.png`) });
        throw error;
      }
      // The page's own width before the widget opens: opening it must not add to it.
      const overflowBefore = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const lb = await launcher.boundingBox();
      const nb = await nav.boundingBox();
      assert.ok(lb.y + lb.height <= nb.y + 1, `@${width} launcher (bottom ${lb.y + lb.height}) overlaps the tab bar (top ${nb.y})`);
      await launcher.click();
      const panel = page.locator('.support-panel');
      if (width === 430) {
        await panel.getByPlaceholder('Имя').fill('QA Member');
        await panel.getByPlaceholder('Email').fill('support-qa-user@example.invalid');
        await panel.getByPlaceholder('Опишите свой вопрос...').fill('Signed-in user message.');
        await panel.getByRole('button', { name: 'Начать чат' }).click();
        await panel.locator('text=Signed-in user message.').waitFor({ timeout: 8000 });
        const conv = await prisma.supportConversation.findFirstOrThrow({ where: { userId: member.id } });
        assert.ok(conv);
        await waitFor(async () => (await prisma.supportNotification.count({ where: { conversationId: conv.id, status: 'SENT' } })) === 1, 'member notification SENT');
        step('signed-in user: conversation tied to the account, notification SENT');
      } else {
        await panel.locator('text=Signed-in user message.').waitFor({ timeout: 8000 });
      }
      const pb = await panel.boundingBox();
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      assert.ok(pb.x >= 0 && pb.x + pb.width <= vw + 1, `@${width} panel outside viewport`);
      assert.ok(pb.y + pb.height <= nb.y + 1, `@${width} panel under the tab bar`);
      const send = panel.getByRole('button', { name: 'Отправить' });
      const sb = await send.boundingBox();
      assert.ok(sb && sb.y + sb.height <= nb.y, `@${width} send button hidden`);
      await panel.getByPlaceholder('Введите сообщение...').focus();
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(pageOverflow <= overflowBefore + 1, `@${width} the widget widened the page: ${overflowBefore} → ${pageOverflow}`);
      const panelOverflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(panelOverflow <= 1, `@${width} panel overflows by ${panelOverflow}`);
      await page.screenshot({ path: path.join(out, `member-${width}.png`) });
      report.widths.push({ width, launcherBottom: Math.round(lb.y + lb.height), tabBarTop: Math.round(nb.y), panel: { x: Math.round(pb.x), w: Math.round(pb.width), bottom: Math.round(pb.y + pb.height) }, errors });
      assert.deepEqual(errors, []);
      await context.close();
    }
    step('phone widths 430/390/360/320: launcher above the tab bar, panel inside the viewport, Send visible');

    // ── 4. Admin: diagnostics, test letter, inbox, thread, reply reaching the widget ──
    {
      const { context, page, errors } = await openPage(1440, tokenFor(admin));
      await page.goto(`${origin}/admin/support`, { waitUntil: 'domcontentloaded' });
      const card = page.locator('[aria-label="Email-уведомления поддержки"]');
      await card.locator('text=Email-уведомления поддержки:').waitFor({ timeout: 10000 });
      const cardText = await card.innerText();
      assert.ok(cardText.includes(RECIPIENT), 'recipient shown');
      assert.ok(cardText.includes('SMTP') && cardText.includes('Настроен'), 'SMTP configured shown');
      assert.ok(cardText.includes('Не настроены'), 'inbound shown as not configured');
      const mailsBefore = sink.mails.length;
      await card.getByRole('button', { name: 'Отправить тестовое письмо' }).click();
      await card.locator('[data-test-email="sent"]').waitFor({ timeout: 10000 });
      assert.equal(sink.mails.length, mailsBefore + 1);
      assert.deepEqual(sink.mails.at(-1).to, [`<${RECIPIENT}>`]);
      assert.equal(await prisma.supportConversation.count({ where: { guestName: { contains: 'Тест' } } }), 0, 'test letter must not create a conversation');
      step('admin test letter: SMTP accepted, shown as sent, no conversation created');

      await page.locator('.admin-support-row', { hasText: 'VOLTEX Support QA' }).click();
      const thread = page.locator('.admin-support-thread');
      await thread.locator('text=Second message from the guest.').waitFor({ timeout: 8000 });
      const delivered = await thread.locator('[data-delivery="SENT"]').count();
      assert.ok(delivered >= 2, `expected delivery badges, got ${delivered}`);
      await page.getByLabel('Ответ пользователю').fill('Ответ поддержки из админки.');
      await page.getByRole('button', { name: 'Ответить в чат' }).click();
      await thread.locator('text=Ответ поддержки из админки.').waitFor({ timeout: 8000 });
      await page.screenshot({ path: path.join(out, 'admin-1440.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();

      const conv = await prisma.supportConversation.findFirstOrThrow({ where: { guestEmail: 'qa-support@example.invalid' } });
      assert.equal(conv.unreadByUser, true);
      const guest = await openPage(1440, null);
      await guest.page.addInitScript(([id]) => localStorage.setItem('exchange_support_guest_conversation_id', id), [conv.id]);
      await guest.page.goto(`${origin}/legal/terms`, { waitUntil: 'domcontentloaded' });
      await guest.page.locator('.support-launcher').click();
      await guest.page.locator('.support-panel').locator('text=Ответ поддержки из админки.').waitFor({ timeout: 10000 });
      step('admin reply appears in the guest chat');
      await guest.context.close();
    }

    // ── 5. Admin diagnostics on a phone ──
    {
      const { context, page } = await openPage(390, tokenFor(admin));
      await page.goto(`${origin}/admin/support`, { waitUntil: 'domcontentloaded' });
      await page.locator('text=Email-уведомления поддержки:').waitFor({ timeout: 10000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `admin page overflow ${overflow}`);
      await page.screenshot({ path: path.join(out, 'admin-390.png'), fullPage: true });
      await context.close();
    }

    const counts = await prisma.supportNotification.groupBy({ by: ['status'], _count: { _all: true } });
    report.notifications = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    report.smtpAccepted = sink.mails.length;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ notifications: report.notifications, smtpAccepted: report.smtpAccepted, widths: report.widths.map((w) => w.width) }));
  } finally {
    outbox.stop();
    await browser?.close();
    server.close();
    sink.server.close();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
