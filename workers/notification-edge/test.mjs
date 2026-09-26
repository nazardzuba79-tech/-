import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { acceptEvent, Delivery, handle, message, RETENTION_MS, validEvent } from './src/core.js';

const now = Date.now();
const event = (extra = {}) => ({ eventId: 'synthetic-1', eventType: 'DEPOSIT_DISCOVERED', timestamp: now, amount: '15', asset: 'USDT', network: 'TRC20', ...extra });
const env = { TELEGRAM_BOT_TOKEN: 'synthetic-only', TELEGRAM_CHAT_ID: 'synthetic-only' };
function storage() {
  let record; let alarm; let lock = Promise.resolve();
  const s = {
    get: async () => record, put: async (_, v) => { record = structuredClone(v); },
    setAlarm: async value => { alarm = value; }, deleteAll: async () => { record = undefined; alarm = undefined; },
    transaction: fn => { const result = lock.then(() => fn(s)); lock = result.catch(() => {}); return result; },
    snapshot: () => ({ record, alarm }),
  }; return s;
}
const req = e => new Request('https://internal/event', { method: 'POST', body: JSON.stringify(e) });
test('15 USDT and KYC text, optional known accumulation, no invented identity', () => {
  assert.match(message(event()), /Сумма: 15 USDT\nСеть: TRC20\nСтатус: Непривязанный/);
  assert.doesNotMatch(message(event()), /Email|Накоплено/);
  assert.match(message(event({ accumulated: '115', remaining: '185' })), /Накоплено: 115 USDT\nОсталось до минимума: 185 USDT/);
  assert.match(message(event({ amount: '300' })), /Готов к проверке/);
  assert.match(message(event({ eventType: 'KYC_SUBMITTED', email: 'synthetic@example.test' })), /Новая KYC заявка/);
});
test('concurrent duplicates and restart make ONE Telegram call; storage has exactly four fields', async () => {
  const s = storage(); let calls = 0;
  const send = async (_, init) => { calls++; const body = JSON.parse(init.body); assert.match(body.text, /15 USDT/); return Response.json({ ok: true, result: { message_id: 1 } }); };
  const d = new Delivery({ storage: s }, env, send, () => now);
  const results = await Promise.all(Array.from({ length: 20 }, () => d.fetch(req(event())).then(r => r.json())));
  assert.equal(results.filter(r => r.status === 'SENT').length, 1); assert.equal(calls, 1);
  const restart = new Delivery({ storage: s }, env, send, () => now);
  assert.equal((await (await restart.fetch(req(event()))).json()).status, 'DUPLICATE');
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(s.snapshot().record).sort(), ['eventId', 'eventType', 'status', 'timestamp']);
  assert.equal(s.snapshot().alarm, now + RETENTION_MS);
  await restart.alarm(); assert.equal(s.snapshot().record, undefined); assert.equal(s.snapshot().alarm, undefined);
});
for (const mode of ['reject', 'timeout', 'malformed']) test(`${mode}: never retry ambiguous/failed delivery`, async () => {
  const s = storage(); let calls = 0;
  const d = new Delivery({ storage: s }, env, async () => {
    calls++; if (mode === 'timeout') throw new Error('secret must not leak');
    return mode === 'reject' ? Response.json({ ok: false }, { status: 429 }) : new Response('invalid');
  });
  assert.equal((await d.fetch(req(event()))).status, 502);
  assert.equal((await (await d.fetch(req(event()))).json()).status, 'DUPLICATE'); assert.equal(calls, 1);
});
test('missing secrets reports NOT_CONFIGURED, no claim and no external call', async () => {
  const s = storage(); const d = new Delivery({ storage: s }, {}, () => assert.fail('fetch'));
  assert.equal((await (await d.fetch(req(event()))).json()).status, 'NOT_CONFIGURED');
  assert.equal(s.snapshot().record, undefined);
  const health = await handle(new Request('https://test/health'), {});
  assert.equal((await health.json()).status, 'NOT_CONFIGURED');
});
test('old/future events and unsupported types rejected; replay after retention cannot send', () => {
  assert.equal(validEvent(event({ timestamp: now - RETENTION_MS }), 'DEPOSIT_DISCOVERED', now), false);
  assert.equal(validEvent(event({ timestamp: now + 120_000 }), 'DEPOSIT_DISCOVERED', now), false);
  assert.equal(validEvent(event({ eventType: 'USER_REGISTERED' }), 'USER_REGISTERED'), false);
});
test('notification accepts the existing KYC 200-character name limit', () => {
  const e = { eventId: 'kyc-name', eventType: 'KYC_SUBMITTED', timestamp: now, fullName: 'N'.repeat(200) };
  assert.equal(validEvent(e, 'KYC_SUBMITTED', now), true);
  assert.equal(validEvent({ ...e, fullName: 'N'.repeat(201) }, 'KYC_SUBMITTED', now), false);
});
test('notification sources have no DB clients, scheduled polling or cron trigger', () => {
  for (const file of ['src/core.js', 'src/index.js', '../../src/services/TelegramNotifications.ts', '../kyc-edge/src/notifications.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /setInterval\s*\(|scheduled\s*\(|PrismaClient|DATABASE_URL|from ['"]pg['"]/);
  }
  assert.doesNotMatch(readFileSync(new URL('wrangler.toml', import.meta.url), 'utf8'), /\[triggers\]|crons\s*=/);
});
test('public deposit endpoint verifies exact signed body; browser, tampering, stale signature and KYC blocked', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); let calls = 0;
  const e = { ...env, DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x, EVENTS: {
    idFromName: name => name, get: () => ({ fetch: async () => { calls++; return Response.json({ status: 'SENT' }); } }),
  } };
  const signed = (data, extraHeaders = {}, stale = false, tamper = false) => {
    const body = JSON.stringify(data); const ts = String(stale ? now - 600_000 : Date.now());
    const signature = sign(null, Buffer.from(`voltex-notifications-v1\n${ts}\n/v1/deposit\n${body}`), privateKey).toString('base64url');
    return new Request('https://notify.test/v1/deposit', { method: 'POST', body: tamper ? body + ' ' : body,
      headers: { 'x-voltex-timestamp': ts, 'x-voltex-signature': signature, ...extraHeaders } });
  };
  assert.equal((await handle(signed(event()), e)).status, 200);
  assert.equal((await handle(signed(event(), { origin: 'https://voltextech.net' }), e)).status, 403);
  assert.equal((await handle(signed(event(), {}, false, true), e)).status, 401);
  assert.equal((await handle(signed(event(), {}, true), e)).status, 401);
  assert.equal((await handle(signed(event({ eventType: 'KYC_SUBMITTED' })), e)).status, 400);
  assert.equal((await handle(signed(event({ document: 'never allowed' })), e)).status, 400);
  assert.equal(calls, 1);
});

const registration = (extra = {}) => ({ eventId: 'synthetic-user', eventType: 'NEW_USER_REGISTERED',
  userId: 'synthetic-user', email: 'synthetic@example.invalid', role: 'USER', timestamp: now, ...extra });
test('registration Telegram text always includes title, email, user ID and actual registration date/time', () => {
  assert.equal(message(registration()), `Нова реєстрація VOLTEX\n\nEmail: synthetic@example.invalid\nUser ID: synthetic-user\nЧас реєстрації (UTC): ${new Date(now).toISOString()}`);
});
test('registration requires USER, email, matching user/event ID and a bounded timestamp', async () => {
  for (const extra of [{ role: 'ADMIN' }, { role: 'SERVICE' }, { role: undefined }, { email: undefined },
    { email: 'invalid' }, { email: 'x\ny@example.test' }, { userId: undefined }, { userId: 'different-id' },
    { timestamp: now - RETENTION_MS }, { timestamp: now + 120_000 }]) {
    assert.equal(validEvent(registration(extra), 'NEW_USER_REGISTERED', now), false, JSON.stringify(extra));
  }
  for (const field of ['password', 'passwordHash', 'jwt', 'sessionToken', 'apiKey', 'secret']) {
    const result = await acceptEvent(registration({ [field]: 'NEVER_SEND' }), 'NEW_USER_REGISTERED', env);
    assert.equal(result.status, 400, field);
  }
});
test('signed registration endpoint rejects browser, unsigned, tampered, wrong-route and wrong-type events', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); let calls = 0;
  const e = { ...env, DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x, EVENTS: {
    idFromName: name => { assert.equal(name, 'NEW_USER_REGISTERED:synthetic-user'); return name; },
    get: () => ({ fetch: async () => { calls++; return Response.json({ status: 'SENT' }); } }),
  } };
  const signed = (data = registration(), headers = {}, signedPath = '/v1/registration', tamper = false) => {
    const body = JSON.stringify(data), ts = String(Date.now());
    return new Request('https://notify.test/v1/registration', { method: 'POST', body: tamper ? body + ' ' : body,
      headers: { 'x-voltex-timestamp': ts, 'x-voltex-signature': sign(null, Buffer.from(`voltex-notifications-v1\n${ts}\n${signedPath}\n${body}`), privateKey).toString('base64url'), ...headers } });
  };
  assert.equal((await handle(signed(), e)).status, 200);
  assert.equal((await handle(new Request('https://notify.test/v1/registration', { method: 'POST', body: JSON.stringify(registration()) }), e)).status, 401);
  assert.equal((await handle(signed(registration(), { origin: 'https://voltextech.net' }), e)).status, 403);
  assert.equal((await handle(signed(registration(), { 'sec-fetch-site': 'same-site' }), e)).status, 403);
  assert.equal((await handle(signed(registration(), {}, '/v1/deposit'), e)).status, 401);
  assert.equal((await handle(signed(registration(), {}, '/v1/registration', true), e)).status, 401);
  assert.equal((await handle(signed(event()), e)).status, 400);
  assert.equal((await handle(signed(registration({ role: 'ADMIN' })), e)).status, 400);
  assert.equal(calls, 1);
});
for (const mode of ['success', 'failure', 'timeout']) test(`registration ${mode}: one attempt and no retained email`, async () => {
  const s = storage(); let calls = 0;
  const send = async (_url, init) => {
    calls++; assert.match(JSON.parse(init.body).text, /Email: synthetic@example.invalid/);
    if (mode === 'timeout') throw new Error('synthetic-secret');
    return Response.json(mode === 'success' ? { ok: true, result: { message_id: 123 } } : { ok: false }, { status: mode === 'success' ? 200 : 503 });
  };
  const d = new Delivery({ storage: s }, env, send, () => now);
  const results = await Promise.all(Array.from({ length: 10 }, () => d.fetch(req(registration())).then(r => r.json())));
  assert.equal(results.filter(r => r.status !== 'DUPLICATE').length, 1);
  assert.equal(calls, 1);
  assert.equal(s.snapshot().record.status, mode === 'success' ? 'SENT' : mode === 'failure' ? 'FAILED' : 'UNKNOWN');
  assert.deepEqual(Object.keys(s.snapshot().record).sort(), ['eventId', 'eventType', 'status', 'timestamp']);
  assert.doesNotMatch(JSON.stringify(s.snapshot()), /synthetic@example|email|password/);
  const restart = new Delivery({ storage: s }, env, send, () => now);
  assert.equal((await (await restart.fetch(req(registration()))).json()).status, 'DUPLICATE');
  assert.equal(calls, 1);
  assert.equal(s.snapshot().alarm, now + RETENTION_MS);
});
