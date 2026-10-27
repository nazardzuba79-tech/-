'use strict';
// Actual notification Worker, synthetic signatures/Telegram transport, local SQLite only.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const roots = [path.resolve(__dirname, '../../workers/market-edge'),
  ...(process.env.VOLTEX_QA_WORKER_PACKAGE_ROOT ? [process.env.VOLTEX_QA_WORKER_PACKAGE_ROOT] : [])];
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: roots }));
const { Dispatcher, Agent, setGlobalDispatcher } = require(require.resolve('undici', { paths: roots }));
const agent = new Agent(); let blockedControlPlaneRequests = 0;
class LoopbackOnly extends Dispatcher {
  dispatch(options, handler) {
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(String(options.origin)).hostname)) {
      blockedControlPlaneRequests++; handler.onError(new Error('Offline QA refused non-loopback request')); return false;
    }
    return agent.dispatch(options, handler);
  }
}
setGlobalDispatcher(new LoopbackOnly());

async function main() {
  const script = await fs.readFile(process.argv[2], 'utf8');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voltex-notification619-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const messages = [], checks = [];
  // Inspection endpoint exists only in this disposable harness, not the published artifact.
  const probe = `\nexport class RetentionProbe extends Delivery { async fetch(r) {
    if (new URL(r.url).pathname === '/inspect') return Response.json({ record:await this.state.storage.get('event'), alarm:await this.state.storage.getAlarm() });
    return super.fetch(r);
  } }`;
  const options = { ...convertV4MiniflareOptions({ cf: false, durableObjectsPersist: dir, workers: [{
    name: 'notifications', modules: true, script: script + probe, compatibilityDate: '2026-09-01',
    bindings: { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_CHAT_ID: 'synthetic-chat',
      DEPOSIT_SIGNING_PUBLIC_KEY: publicKey.export({ format: 'jwk' }).x },
    durableObjects: { EVENTS: { className: 'NotificationEvent', useSQLite: true },
      PROBE: { className: 'RetentionProbe', useSQLite: true } },
    outboundService: async request => {
      assert.equal(request.url, 'https://api.telegram.org/botsynthetic-token/sendMessage');
      assert.equal(request.method, 'POST'); messages.push(await request.json());
      return WorkerResponse.json({ ok: true, result: { message_id: messages.length } });
    },
  }] }), cf: false, isolatedResourcePersistencePath: dir, resourcePersistencePath: dir, telemetry: { enabled: false } };
  let mf = new Miniflare(options);
  const event = { eventId: 'synthetic-copy-619', eventType: 'DEPOSIT_ADDRESS_COPIED', timestamp: Date.now(),
    asset: 'USDT', network: 'tron', networkLabel: 'TRON (TRC-20)', email: 'copier@example.invalid' };
  const signed = (value, endpoint = '/v1/copy') => {
    const body = JSON.stringify(value), timestamp = String(Date.now());
    return { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'x-voltex-timestamp': timestamp,
      'x-voltex-signature': crypto.sign(null, Buffer.from(`voltex-notifications-v1\n${timestamp}\n${endpoint}\n${body}`), privateKey).toString('base64url') } };
  };
  const send = (value, endpoint = '/v1/copy') => mf.dispatchFetch('https://notify.local' + endpoint, signed(value, endpoint));
  try {
    assert.equal((await mf.dispatchFetch('https://notify.local/v1/copy', { method: 'POST', body: JSON.stringify(event) })).status, 401); checks.push('unsigned event refused');
    const forged = signed(event); forged.headers['x-voltex-signature'] = 'A'.repeat(86);
    assert.equal((await mf.dispatchFetch('https://notify.local/v1/copy', forged)).status, 401); checks.push('forged signature refused');
    assert.equal((await send(event)).status, 200); checks.push('signed authenticated email event accepted');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, 'Скопійовано депозитну адресу VOLTEX\n\nМонета: USDT\nМережа: TRON (TRC-20)\nEmail: copier@example.invalid'); checks.push('exact Telegram text includes synthetic copier email');
    const duplicates = await Promise.all(Array.from({ length: 6 }, () => send(event).then(r => r.json())));
    assert.ok(duplicates.every(r => r.status === 'DUPLICATE')); assert.equal(messages.length, 1); checks.push('duplicate events remain silent');
    for (const email of ['bad', 'copier@example.invalid\nspoof', '<script>']) {
      assert.equal((await send({ ...event, eventId: 'invalid-' + checks.length, email })).status, 400);
    } checks.push('invalid email and line injection refused');
    assert.equal((await send({ ...event, eventId: 'private-extra', address: 'must-never-leave-api' })).status, 400); checks.push('wallet-address field refused');
    const { email: omitted, ...old } = event;
    assert.equal((await send({ ...old, eventId: 'legacy-copy-619' })).status, 200);
    assert.equal(messages[1].text, 'Скопійовано депозитну адресу VOLTEX\n\nМонета: USDT\nМережа: TRON (TRC-20)'); checks.push('old email-less API payload remains compatible');
    await mf.dispose(); mf = new Miniflare(options);
    assert.equal((await (await send(event)).json()).status, 'DUPLICATE'); assert.equal(messages.length, 2); checks.push('deduplication survives actual workerd restart');
    const ns = await mf.getDurableObjectNamespace('PROBE', 'notifications');
    const stub = ns.get(ns.idFromName('synthetic-retention-619'));
    assert.equal((await stub.fetch('https://internal/event', { method: 'POST', body: JSON.stringify({ ...event, eventId: 'synthetic-retention-619' }) })).status, 200);
    const stored = await (await stub.fetch('https://internal/inspect')).json();
    assert.deepEqual(Object.keys(stored.record).sort(), ['eventId', 'eventType', 'status', 'timestamp']);
    assert.ok(!JSON.stringify(stored).includes(event.email)); checks.push('email not persisted in SQLite');
    assert.equal(stored.alarm, stored.record.timestamp + 7 * 86400000); checks.push('existing retention preserved');
    assert.equal(blockedControlPlaneRequests, 0); checks.push('no external control-plane request attempted');
    const report = { result: 'PASS', checks: checks.length, labels: checks, syntheticTelegramMessages: messages.length,
      realTelegramRequests: 0, blockedControlPlaneRequests, productionTouched: false,
      workerSha256: crypto.createHash('sha256').update(script).digest('hex') };
    if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await mf?.dispose(); await agent.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
