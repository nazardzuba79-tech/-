import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';

test('real workerd + SQLite DO: signed deposit/registration, private KYC binding, concurrent duplicate, restart, no idle egress', async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
    export { default, KycNotifications, NotificationEvent } from './src/index.js';
    import { Delivery } from './src/core.js';
    // Test-only inspection/cleanup entrypoints; never included in deployment.
    export class RetentionProbe extends Delivery {
      async fetch(r) {
        if (new URL(r.url).pathname === '/inspect') return Response.json({record:await this.state.storage.get('event'), alarm:await this.state.storage.getAlarm()});
        if (new URL(r.url).pathname === '/cleanup') {await this.alarm(); return new Response('clean');}
        return super.fetch(r);
      }
    }
  ` }, bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'voltex-notification-test-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const calls = [];
  const options = {
    durableObjectsPersist: path,
    workers: [{ name: 'notifications', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
      bindings: { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_CHAT_ID: 'synthetic-chat', DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x },
      durableObjects: { EVENTS: { className: 'NotificationEvent', useSQLite: true }, PROBE: { className: 'RetentionProbe', useSQLite: true } },
      outboundService: async request => {
        assert.equal(request.url, 'https://api.telegram.org/botsynthetic-token/sendMessage');
        calls.push(await request.json());
        return WorkerResponse.json({ ok: true, result: { message_id: calls.length } });
      },
    }, { name: 'kyc-test-caller', modules: true, compatibilityDate: '2025-09-24',
      script: `export default { async fetch(r, env) { return Response.json(await env.NOTIFICATIONS.notify(await r.json())); } }`,
      serviceBindings: { NOTIFICATIONS: { name: 'notifications', entrypoint: 'KycNotifications' } },
      outboundService: () => { throw new Error('unexpected outbound call'); },
    }],
  };
  const e = { eventId: 'integration-1', eventType: 'DEPOSIT_DISCOVERED', timestamp: Date.now(), amount: '15', asset: 'USDT', network: 'TRC20' };
  const signed = (data = e, endpoint = '/v1/deposit') => {
    const body = JSON.stringify(data), ts = String(Date.now());
    return { method: 'POST', body, headers: { 'x-voltex-timestamp': ts,
      'x-voltex-signature': sign(null, Buffer.from(`voltex-notifications-v1\n${ts}\n${endpoint}\n${body}`), privateKey).toString('base64url') } };
  };
  const runtimeOptions = { ...convertV4MiniflareOptions(options), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } };
  let mf = new Miniflare(runtimeOptions);
  try {
    const responses = await Promise.all(Array.from({ length: 12 }, () => mf.dispatchFetch('https://local/v1/deposit', signed()).then(r => r.json())));
    assert.equal(responses.filter(r => r.status === 'SENT').length, 1, JSON.stringify({ responses, calls }));
    assert.equal(calls.length, 1); assert.match(calls[0].text, /15 USDT/);
    const kyc = await mf.getWorker('kyc-test-caller');
    const result = await kyc.fetch('https://local/', { method: 'POST', body: JSON.stringify({ eventId: 'kyc-1', eventType: 'KYC_SUBMITTED', timestamp: Date.now(), email: 'synthetic@example.test' }) });
    assert.equal((await result.json()).status, 'SENT'); assert.equal(calls.length, 2);
    const forbidden = await kyc.fetch('https://local/', { method: 'POST', body: JSON.stringify(e) });
    assert.equal((await forbidden.json()).status, 'INVALID_EVENT');
    const registration = { eventId: e.eventId, userId: e.eventId, eventType: 'NEW_USER_REGISTERED', role: 'USER',
      timestamp: Date.now(), email: 'synthetic-registration@example.invalid' };
    const regResponses = await Promise.all(Array.from({ length: 12 }, () => mf.dispatchFetch('https://local/v1/registration', signed(registration, '/v1/registration')).then(r => r.json())));
    assert.equal(regResponses.filter(r => r.status === 'SENT').length, 1);
    assert.equal(calls.length, 3, 'registration uses separate event namespace, same deduplication');
    assert.match(calls[2].text, /^Нова реєстрація VOLTEX\n\nEmail: synthetic-registration@example.invalid\nДата і час: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Київ\)$/);
    assert.ok(!calls[2].text.includes('integration-1'), 'no user ID in the Telegram text');
    const copy = { eventId: 'integration-copy-1', eventType: 'DEPOSIT_ADDRESS_COPIED',
      timestamp: Date.now(), asset: 'USDT', network: 'tron', networkLabel: 'TRON (TRC-20)' };
    const copies = await Promise.all(Array.from({ length: 12 }, () => mf.dispatchFetch('https://local/v1/copy', signed(copy, '/v1/copy')).then(r => r.json())));
    assert.equal(copies.filter(r => r.status === 'SENT').length, 1);
    assert.equal(calls.length, 4, 'only one Telegram message per recorded copy event');
    assert.equal(calls[3].text, 'Скопійовано депозитну адресу VOLTEX\n\nМонета: USDT\nМережа: TRON (TRC-20)');
    assert.ok(!calls[3].text.includes(registration.email), 'no account identity in copy Telegram');
    const wrongBinding = await kyc.fetch('https://local/', { method: 'POST', body: JSON.stringify(registration) });
    assert.equal((await wrongBinding.json()).status, 'INVALID_EVENT', 'KYC authority not broadened');
    await mf.dispose(); mf = new Miniflare(runtimeOptions);
    assert.equal((await (await mf.dispatchFetch('https://local/v1/deposit', signed())).json()).status, 'DUPLICATE');
    assert.equal((await (await mf.dispatchFetch('https://local/v1/registration', signed(registration, '/v1/registration'))).json()).status, 'DUPLICATE');
    assert.equal((await (await mf.dispatchFetch('https://local/v1/copy', signed(copy, '/v1/copy'))).json()).status, 'DUPLICATE');
    assert.equal(calls.length, 4, 'restart retains deposit, registration and copy claims');
    const ns = await mf.getDurableObjectNamespace('PROBE', 'notifications');
    const probe = ns.get(ns.idFromName('retention-test'));
    await probe.fetch('https://local/event', { method: 'POST', body: JSON.stringify({ ...registration, eventId: 'retention-test', userId: 'retention-test' }) });
    const stored = await (await probe.fetch('https://local/inspect')).json();
    assert.deepEqual(Object.keys(stored.record).sort(), ['eventId', 'eventType', 'status', 'timestamp']);
    assert.ok(!JSON.stringify(stored).includes(registration.email), 'no registration PII in SQLite');
    assert.equal(stored.alarm, stored.record.timestamp + 7 * 86400_000);
    await probe.fetch('https://local/cleanup');
    const cleared = await (await probe.fetch('https://local/inspect')).json();
    assert.equal(cleared.record, undefined); assert.equal(cleared.alarm, null);
    assert.equal(calls.length, 5, 'cleanup has no network side effects');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls.length, 5, 'no background egress');
  } finally { await mf.dispose(); }
});

test('real workerd: KYC materials event through the private binding — one Telegram message, duplicate deduplicated, deposit/registration refused', async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
    export { default, KycNotifications, NotificationEvent } from './src/index.js';
  ` }, bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'voltex-notification-materials-'));
  const calls = [];
  const options = {
    durableObjectsPersist: path,
    workers: [{ name: 'notifications', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
      bindings: { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_CHAT_ID: 'synthetic-chat' },
      durableObjects: { EVENTS: { className: 'NotificationEvent', useSQLite: true } },
      outboundService: async request => { calls.push(await request.json()); return WorkerResponse.json({ ok: true, result: { message_id: calls.length } }); },
    }, { name: 'kyc-edge-caller', modules: true, compatibilityDate: '2025-09-24',
      script: `export default { async fetch(r, env) { return Response.json(await env.NOTIFICATIONS.notifyMaterials(await r.json())); } }`,
      serviceBindings: { NOTIFICATIONS: { name: 'notifications', entrypoint: 'KycNotifications' } },
      outboundService: () => { throw new Error('unexpected outbound call'); },
    }],
  };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } });
  try {
    const caller = await mf.getWorker('kyc-edge-caller');
    const event = { eventId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', eventType: 'KYC_MATERIALS_RECEIVED', timestamp: Date.now(), email: 'synthetic@example.test', fullName: 'Test Synthetic Person', part: 'SELFIE', complete: true };
    const send = (e) => caller.fetch('https://local/', { method: 'POST', body: JSON.stringify(e) }).then(r => r.json());
    const results = await Promise.all([send(event), send(event), send(event)]);
    assert.equal(results.filter(r => r.status === 'SENT').length, 1, JSON.stringify(results));
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /^📎 KYC: получены дополнительные материалы\n\nEmail: synthetic@example\.test\nFull Name: Test Synthetic Person\nМатериал: селфи для подтверждения личности\nСтатус: повторная проверка$/);
    assert.equal((await send({ ...event, eventId: 'other', fileBase64: '/9j/' })).status, 'INVALID_EVENT');
    assert.equal((await send({ eventId: 'dep', eventType: 'DEPOSIT_DISCOVERED', timestamp: Date.now(), amount: '15', asset: 'USDT', network: 'TRC20' })).status, 'INVALID_EVENT');
    assert.equal((await send({ eventId: 'kyc-1', eventType: 'KYC_SUBMITTED', timestamp: Date.now() })).status, 'INVALID_EVENT', 'materials method cannot send a new-application event');
    assert.equal(calls.length, 1);
  } finally { await mf.dispose(); }
});
