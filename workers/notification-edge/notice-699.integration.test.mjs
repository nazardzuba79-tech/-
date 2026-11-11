// Issue #699 on real workerd + SQLite Durable Objects: chain-time deposit alert,
// daily digest, legacy (pre-#699) event, concurrent duplicates and restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';

test('real workerd: one alert per real receipt, one digest per day, restart and replay never send again', async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
    export { default, KycNotifications, NotificationEvent } from './src/index.js';
  ` }, bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'voltex-notice-699-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const calls = []; let telegram = 'ok';
  const options = {
    durableObjectsPersist: path,
    workers: [{ name: 'notifications', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
      bindings: { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_CHAT_ID: 'synthetic-chat', DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x },
      durableObjects: { EVENTS: { className: 'NotificationEvent', useSQLite: true } },
      outboundService: async request => {
        assert.equal(request.url, 'https://api.telegram.org/botsynthetic-token/sendMessage');
        calls.push((await request.json()).text);
        return telegram === 'ok' ? WorkerResponse.json({ ok: true, result: { message_id: calls.length } }) : WorkerResponse.json({ ok: false }, { status: 429 });
      },
    }],
  };
  const signed = (data, endpoint) => {
    const body = JSON.stringify(data), ts = String(Date.now());
    return { method: 'POST', body, headers: { 'x-voltex-timestamp': ts,
      'x-voltex-signature': sign(null, Buffer.from(`voltex-notifications-v1\n${ts}\n${endpoint}\n${body}`), privateKey).toString('base64url') } };
  };
  const post = (mf, data, endpoint) => mf.dispatchFetch(`https://local${endpoint}`, signed(data, endpoint)).then(r => r.json());
  const t = Date.now(), tx = n => n.toString(16).padStart(64, '0');
  const deposit = (id, extra = {}) => ({ eventId: id, eventType: 'DEPOSIT_DISCOVERED', timestamp: t, blockTime: t - 30 * 60_000, amount: '1010', asset: 'USDT', network: 'TRC20',
    txHash: tx(1), confirmations: 21, requiredConfirmations: 19, finalized: true, proofStatus: 'VERIFIED', ...extra });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(t));
  const digest = (extra = {}) => ({ eventId: `deposit-digest:tron:${day}`, eventType: 'DEPOSIT_DIGEST', timestamp: t,
    groups: [{ kind: 'MICRO', asset: 'TRX', network: 'TRON_NATIVE', count: 5, total: '0.000015', from: t - 15 * 3_600_000, to: t - 14 * 3_600_000, below: '1' }], ...extra });
  const runtimeOptions = { ...convertV4MiniflareOptions(options), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } };
  let mf = new Miniflare(runtimeOptions);
  try {
    // A real USDT receipt and a real native TRX receipt: one message each, with the chain time.
    const usdt = await Promise.all(Array.from({ length: 8 }, () => post(mf, deposit('real-usdt'), '/v1/deposit')));
    assert.equal(usdt.filter(r => r.status === 'SENT').length, 1, JSON.stringify(usdt));
    const trx = await Promise.all(Array.from({ length: 8 }, () => post(mf, deposit('real-trx', { asset: 'TRX', network: 'TRON_NATIVE', amount: '1500.25', txHash: tx(2) }), '/v1/deposit')));
    assert.equal(trx.filter(r => r.status === 'SENT').length, 1);
    assert.equal(calls.length, 2);
    assert.match(calls.find(c => c.includes('USDT')), /^Нове надходження: 1010 USDT\n\nМережа: TRON \(TRC-20\)\nЧас транзакції: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Київ\)\nВиявлено: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Київ\)\nTXID: 0{63}1\nПідтвердження: 21 \(мінімум 19\)\nСтатус: підтверджено в блокчейні; очікує ручної перевірки$/);
    assert.match(calls.find(c => c.includes('TRX')), /^Нове надходження: 1500\.25 TRX\n\nМережа: TRON \(Native\)\nЧас транзакції: /);

    // Five dust transfers: ONE digest, however often the API replays it.
    const digests = await Promise.all(Array.from({ length: 8 }, () => post(mf, digest(), '/v1/deposit-digest')));
    assert.equal(digests.filter(r => r.status === 'SENT').length, 1, JSON.stringify(digests));
    assert.equal(calls.length, 3);
    assert.match(calls[2], /^Зведення перевірки надходжень\n\nМікроперекази \(менше 1 TRX; можливий dust\): 5 шт\., разом 0\.000015 TRX\nМережа: TRON \(Native\)\nЧас транзакцій: /);
    assert.doesNotMatch(calls[2], /Нове надходження|TXID/);

    // Historical chain time and unknown fields never reach Telegram.
    assert.equal((await post(mf, deposit('old-1', { blockTime: t - 8 * 86_400_000 }), '/v1/deposit')).status, 'INVALID_EVENT');
    assert.equal((await post(mf, deposit('future-1', { blockTime: t + 3_600_000 }), '/v1/deposit')).status, 'INVALID_EVENT');
    assert.equal((await post(mf, { ...digest(), txHash: tx(9) }, '/v1/deposit-digest')).status, 'INVALID_EVENT');
    assert.equal((await post(mf, digest(), '/v1/deposit')).status, 'INVALID_EVENT');
    assert.equal(calls.length, 3);

    // The currently deployed API sends no blockTime: accepted, but not titled «Нове».
    const legacy = deposit('legacy-api'); delete legacy.blockTime;
    assert.equal((await post(mf, legacy, '/v1/deposit')).status, 'SENT');
    assert.match(calls[3], /^Надходження: 1010 USDT\n\nМережа: TRON \(TRC-20\)\nЧас транзакції: не передано\nTXID: /);

    // Telegram refuses a message: recorded as FAILED, never re-sent (existing at-most-once rule).
    telegram = 'reject';
    assert.equal((await post(mf, deposit('telegram-down', { txHash: tx(3) }), '/v1/deposit')).status, 'FAILED');
    telegram = 'ok';
    const again = await post(mf, deposit('telegram-down', { txHash: tx(3) }), '/v1/deposit');
    assert.equal(again.status, 'DUPLICATE'); assert.equal(again.deliveryStatus, 'FAILED');
    assert.equal(calls.length, 5);

    // Restart (deploy): every claim survives, nothing is sent again, even with a changed digest body.
    await mf.dispose(); mf = new Miniflare(runtimeOptions);
    for (const [data, endpoint] of [[deposit('real-usdt'), '/v1/deposit'], [deposit('real-trx', { asset: 'TRX', network: 'TRON_NATIVE', amount: '1500.25', txHash: tx(2) }), '/v1/deposit'],
      [digest(), '/v1/deposit-digest'], [digest({ groups: [{ kind: 'MICRO', asset: 'TRX', network: 'TRON_NATIVE', count: 9, total: '0.00003', below: '1' }] }), '/v1/deposit-digest'], [legacy, '/v1/deposit']]) {
      const replay = await post(mf, data, endpoint);
      assert.equal(replay.status, 'DUPLICATE', JSON.stringify(replay)); assert.equal(replay.deliveryStatus, 'SENT');
    }
    assert.equal(calls.length, 5, 'no Telegram call after restart');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls.length, 5, 'no background egress');
  } finally { await mf.dispose(); }
});
