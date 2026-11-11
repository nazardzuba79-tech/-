// Issue #699: chain time vs record time, historical/micro transfers and the daily digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { acceptEvent, CLOCK_SKEW_MS, Delivery, handle, kyivTime, message, RETENTION_MS, validEvent } from './src/core.js';

const now = Date.UTC(2026, 10, 11, 10, 0, 0); // 12:00 Kyiv
const tx = 'cd'.repeat(32);
const env = { TELEGRAM_BOT_TOKEN: 'synthetic-only', TELEGRAM_CHAT_ID: 'synthetic-only' };
const deposit = (extra = {}) => ({ eventId: 'dep-699', eventType: 'DEPOSIT_DISCOVERED', timestamp: now, blockTime: Date.UTC(2026, 10, 11, 9, 31, 0),
  amount: '1010', asset: 'USDT', network: 'TRC20', txHash: tx, confirmations: 21, requiredConfirmations: 19, finalized: true, proofStatus: 'VERIFIED', ...extra });
const group = (extra = {}) => ({ kind: 'MICRO', asset: 'TRX', network: 'TRON_NATIVE', count: 5, total: '0.000015',
  from: Date.UTC(2026, 10, 10, 19, 10, 0), to: Date.UTC(2026, 10, 10, 20, 20, 0), below: '1', ...extra });
const digest = (extra = {}) => ({ eventId: 'deposit-digest:tron:2026-11-11', eventType: 'DEPOSIT_DIGEST', timestamp: now, groups: [group()], ...extra });
function storage() {
  let record; let alarm; let lock = Promise.resolve();
  const s = { get: async () => record, put: async (_, v) => { record = structuredClone(v); }, setAlarm: async v => { alarm = v; },
    deleteAll: async () => { record = undefined; alarm = undefined; },
    transaction: fn => { const r = lock.then(() => fn(s)); lock = r.catch(() => {}); return r; }, snapshot: () => ({ record, alarm }) };
  return s;
}
const req = e => new Request('https://internal/event', { method: 'POST', body: JSON.stringify(e) });

test('a new receipt shows coin, amount, network, the real transaction time, detection time, TXID and status', () => {
  assert.equal(message(deposit()), [
    'Нове надходження: 1010 USDT', '', 'Мережа: TRON (TRC-20)',
    'Час транзакції: 11.11.2026, 11:31 (Київ)', 'Виявлено: 11.11.2026, 12:00 (Київ)',
    `TXID: ${tx}`, 'Підтвердження: 21 (мінімум 19)', 'Статус: підтверджено в блокчейні; очікує ручної перевірки',
  ].join('\n'));
  const native = message(deposit({ asset: 'TRX', network: 'TRON_NATIVE', amount: '1500.25', blockTime: Date.UTC(2026, 10, 10, 19, 54, 0) }));
  assert.match(native, /^Нове надходження: 1500\.25 TRX\n\nМережа: TRON \(Native\)\nЧас транзакції: 10\.11\.2026, 21:54 \(Київ\)\nВиявлено: 11\.11\.2026, 12:00 \(Київ\)/);
  assert.doesNotMatch(native, /USDT|TRC-20/);
});
test('the transaction time is the chain time, never the record time, across the Kyiv DST boundary', () => {
  assert.match(message(deposit({ timestamp: Date.UTC(2026, 9, 25, 10, 0, 0), blockTime: Date.UTC(2026, 9, 24, 20, 30, 0) })),
    /Час транзакції: 24\.10\.2026, 23:30 \(Київ\)\nВиявлено: 25\.10\.2026, 12:00 \(Київ\)/);
});
test('an event from the pre-#699 API (no blockTime) is still accepted but is never titled «Нове»', () => {
  const legacy = deposit(); delete legacy.blockTime;
  assert.equal(validEvent(legacy, 'DEPOSIT_DISCOVERED', now), true);
  assert.match(message(legacy), /^Надходження: 1010 USDT\n\nМережа: TRON \(TRC-20\)\nЧас транзакції: не передано\nTXID: /);
  assert.doesNotMatch(message(legacy), /Нове надходження|Виявлено/);
});
test('a chain time that cannot belong to a new receipt is refused before any durable claim or Telegram call', async () => {
  let claims = 0;
  const bound = { ...env, EVENTS: { idFromName() { claims++; throw Error('must reject before the durable object'); } } };
  for (const blockTime of [now - RETENTION_MS - 1, now + CLOCK_SKEW_MS + 1, 0, -5, 1.5, '1762855200000', null]) {
    const e = deposit({ timestamp: now, blockTime });
    assert.equal(validEvent(e, 'DEPOSIT_DISCOVERED', now), false, String(blockTime));
    assert.equal((await acceptEvent({ ...e, timestamp: Date.now(), blockTime: typeof blockTime === 'number' && blockTime > 1e12 ? blockTime - now + Date.now() : blockTime }, 'DEPOSIT_DISCOVERED', bound)).status, 400);
  }
  // The API database clock may run behind the chain clock; only a block from the FUTURE is impossible.
  assert.equal(validEvent(deposit({ timestamp: now - 3_600_000, blockTime: now - 60_000 }), 'DEPOSIT_DISCOVERED', now), true);
  assert.equal(validEvent(deposit({ blockTime: now - RETENTION_MS }), 'DEPOSIT_DISCOVERED', now), true, 'exactly the retention is still valid');
  assert.equal(validEvent(deposit({ blockTime: now + CLOCK_SKEW_MS }), 'DEPOSIT_DISCOVERED', now), true, 'bounded clock skew');
  assert.equal(claims, 0);
});
test('digest text: one message, counts/sums/time range only, never «Нове надходження», never a TXID', () => {
  const text = message(digest({ groups: [group(), group({ kind: 'HISTORICAL', asset: 'USDT', network: 'TRC20', count: 2, total: '517',
    from: Date.UTC(2026, 10, 5, 15, 29, 0), to: Date.UTC(2026, 10, 7, 11, 45, 0), below: undefined }),
    group({ kind: 'TIME_UNKNOWN', count: 1, total: '3', from: undefined, to: undefined, below: undefined })] }));
  assert.equal(text, [
    'Зведення перевірки надходжень', '',
    'Мікроперекази (менше 1 TRX; можливий dust): 5 шт., разом 0.000015 TRX', 'Мережа: TRON (Native)',
    'Час транзакцій: 10.11.2026, 21:10 – 10.11.2026, 22:20 (Київ)', '',
    'Старі перекази, вперше знайдені зараз: 2 шт., разом 517 USDT', 'Мережа: TRON (TRC-20)',
    'Час транзакцій: 05.11.2026, 17:29 – 07.11.2026, 13:45 (Київ)', '',
    'Перекази без підтвердженого часу блоку: 1 шт., разом 3 TRX', 'Мережа: TRON (Native)', '',
    'Окремі сповіщення про ці перекази не надсилаються.',
    'Нічого не зараховано автоматично; усі записи збережено в адмінці («Пополнения») для ручної перевірки.',
  ].join('\n'));
  assert.doesNotMatch(text, /Нове надходження|TXID|[a-f0-9]{64}/);
  assert.match(message(digest({ groups: [group({ count: 1, total: '0.000003', from: now - 5, to: now - 5 })] })), /Час транзакцій: 11\.11\.2026, 11:59 \(Київ\)/);
});
test('digest schema is strict: identity, group shape, assets, amounts, times and no smuggled fields', async () => {
  assert.equal(validEvent(digest(), 'DEPOSIT_DIGEST', now), true);
  assert.equal(validEvent(digest(), 'DEPOSIT_DISCOVERED', now), false);
  assert.equal(validEvent(deposit(), 'DEPOSIT_DIGEST', now), false);
  const bad = [
    { eventId: 'deposit-digest:tron:2026-11-1' }, { eventId: 'deposit-digest:eth:2026-11-11' }, { eventId: 'dep-699' },
    { groups: [] }, { groups: undefined }, { groups: 'x' }, { groups: [group(), group()] }, { groups: Array.from({ length: 7 }, (_, i) => group({ count: i + 1 })) },
    { groups: [group({ kind: 'NEW' })] }, { groups: [group({ asset: 'BTC' })] }, { groups: [group({ network: 'TRC20' })] },
    { groups: [group({ count: 0 })] }, { groups: [group({ count: 1.5 })] }, { groups: [group({ total: '0' })] }, { groups: [group({ total: '1e-6' })] },
    { groups: [group({ from: undefined })] }, { groups: [group({ from: now, to: now - 1 })] }, { groups: [group({ to: now + CLOCK_SKEW_MS + 1 })] },
    { groups: [group({ below: undefined })] }, { groups: [group({ below: '0' })] }, { groups: [group({ kind: 'HISTORICAL' })] },
    { groups: [group({ txHash: tx })] }, { groups: [group({ userId: 'u' })] }, { groups: [null] }, { groups: [[]] },
    { timestamp: now - RETENTION_MS }, { timestamp: now + 120_000 },
  ];
  for (const patch of bad) assert.equal(validEvent(digest(patch), 'DEPOSIT_DIGEST', now), false, JSON.stringify(patch));
  const fresh = digest({ timestamp: Date.now(), groups: [group({ from: Date.now() - 3_600_000, to: Date.now() - 1_800_000 })] });
  for (const field of ['txHash', 'amount', 'email', 'userId', 'credit', 'address']) {
    assert.equal((await acceptEvent({ ...fresh, [field]: 'x' }, 'DEPOSIT_DIGEST', env)).status, 400, field);
  }
});
test('digest is signed for its own route only; deposit and digest bodies cannot be swapped', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const names = [];
  const e = { ...env, DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x, EVENTS: {
    idFromName: name => { names.push(name); return name; }, get: () => ({ fetch: async () => Response.json({ status: 'SENT' }) }) } };
  const live = Date.now();
  const d = digest({ timestamp: live, groups: [group({ from: live - 7_200_000, to: live - 3_600_000 })] });
  const dep = deposit({ timestamp: live, blockTime: live - 60_000 });
  const signed = (data, route, signedRoute = route, headers = {}) => {
    const body = JSON.stringify(data), ts = String(Date.now());
    return new Request(`https://notify.test${route}`, { method: 'POST', body, headers: { 'x-voltex-timestamp': ts,
      'x-voltex-signature': sign(null, Buffer.from(`voltex-notifications-v1\n${ts}\n${signedRoute}\n${body}`), privateKey).toString('base64url'), ...headers } });
  };
  assert.equal((await handle(signed(d, '/v1/deposit-digest'), e)).status, 200);
  assert.equal((await handle(signed(dep, '/v1/deposit'), e)).status, 200);
  assert.equal((await handle(signed(d, '/v1/deposit'), e)).status, 400);
  assert.equal((await handle(signed(dep, '/v1/deposit-digest'), e)).status, 400);
  assert.equal((await handle(signed(d, '/v1/deposit-digest', '/v1/deposit'), e)).status, 401);
  assert.equal((await handle(signed(d, '/v1/deposit-digest', '/v1/deposit-digest', { origin: 'https://voltextech.net' }), e)).status, 403);
  assert.equal((await handle(new Request('https://notify.test/v1/deposit-digest', { method: 'POST', body: JSON.stringify(d) }), e)).status, 401);
  assert.deepEqual(names, ['DEPOSIT_DIGEST:deposit-digest:tron:2026-11-11', 'DEPOSIT_DISCOVERED:dep-699']);
});
for (const mode of ['success', 'reject', 'timeout']) test(`digest ${mode}: one Telegram attempt across repeats and restart; nothing but four fields stored`, async () => {
  const s = storage(); let calls = 0;
  const send = async (_url, init) => {
    calls++; assert.match(JSON.parse(init.body).text, /^Зведення перевірки надходжень/);
    if (mode === 'timeout') throw new Error('synthetic-secret');
    return Response.json(mode === 'success' ? { ok: true, result: { message_id: 7 } } : { ok: false }, { status: mode === 'success' ? 200 : 429 });
  };
  const d = new Delivery({ storage: s }, env, send, () => now);
  const results = await Promise.all(Array.from({ length: 10 }, () => d.fetch(req(digest())).then(r => r.json())));
  assert.equal(results.filter(r => r.status !== 'DUPLICATE').length, 1); assert.equal(calls, 1);
  // A replay of the same Kyiv day with a different row set is still the same event.
  const restarted = new Delivery({ storage: s }, env, send, () => now + 3_600_000);
  const replay = await (await restarted.fetch(req(digest({ timestamp: now + 3_600_000, groups: [group({ count: 9, total: '0.00003' })] })))).json();
  assert.equal(replay.status, 'DUPLICATE'); assert.equal(replay.deliveryStatus, mode === 'success' ? 'SENT' : mode === 'reject' ? 'FAILED' : 'UNKNOWN');
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(s.snapshot().record).sort(), ['eventId', 'eventType', 'status', 'timestamp']);
  assert.doesNotMatch(JSON.stringify(s.snapshot()), /0\.000015|groups|MICRO/);
});
test('five dust transfers summarised = one Telegram message; a real receipt alongside = exactly one more', async () => {
  const sent = [];
  const send = async (_url, init) => { sent.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: sent.length } }); };
  const objects = new Map();
  const object = name => { if (!objects.has(name)) objects.set(name, new Delivery({ storage: storage() }, env, send)); return objects.get(name); };
  const bound = { ...env, EVENTS: { idFromName: name => name, get: name => ({ fetch: request => object(name).fetch(request) }) } };
  const liveNow = Date.now();
  const d = digest({ timestamp: liveNow, groups: [group({ from: liveNow - 54_000_000, to: liveNow - 49_000_000 })] });
  const dep = deposit({ timestamp: liveNow, blockTime: liveNow - 1_800_000 });
  for (let i = 0; i < 4; i++) { await acceptEvent(d, 'DEPOSIT_DIGEST', bound); await acceptEvent(dep, 'DEPOSIT_DISCOVERED', bound); }
  assert.equal(sent.length, 2);
  assert.equal(sent.filter(t => /^Нове надходження: 1010 USDT/.test(t)).length, 1);
  assert.equal(sent.filter(t => /Мікроперекази \(менше 1 TRX; можливий dust\): 5 шт\./.test(t)).length, 1);
});
test('kyivTime helper used for chain times', () => { assert.equal(kyivTime(Date.UTC(2026, 10, 10, 19, 10, 0)), '10.11.2026, 21:10'); });
