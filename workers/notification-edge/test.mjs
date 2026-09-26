import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Delivery, handle, message, RETENTION_MS, validEvent } from './src/core.js';

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
