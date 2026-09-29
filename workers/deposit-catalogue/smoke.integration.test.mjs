// The deposit post-deploy smoke script against the real Worker bundle in
// workerd over HTTP. Local, synthetic addresses; no external requests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const token = 'synthetic-local-only-catalogue-secret-0001';
const smoke = fileURLToPath(new URL('../../scripts/smoke-deposit-public.mjs', import.meta.url));
const entry = (assetId, networkId, address, enabled = true) => ({ assetId, networkId, address, enabled, memo: '', memoLabel: '' });
let script, seeded, bare;

async function worker(bindings) {
  const path = await mkdtemp(join(tmpdir(), 'voltex-deposit-smoke-'));
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: path, workers: [{ name: 'catalogue', modules: true, script,
    compatibilityDate: '2026-09-01', bindings, durableObjects: { RECEIVING_ADDRESS_CATALOGUE: { className: 'ReceivingAddressCatalogueDO', useSQLite: true } },
    outboundService: () => { throw new Error('Unexpected external request'); } }] }),
    isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false }, host: '127.0.0.1', port: 0 });
  return { mf, url: (await mf.ready).toString().replace(/\/$/, '') };
}
const run = (url) => new Promise((resolve) => {
  execFile(process.execPath, [smoke, url, '--site-origin', 'https://voltextech.net'], { env: { PATH: process.env.PATH } },
    (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
});

before(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./src/index.js', import.meta.url))], bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
  script = bundle.outputFiles[0].text;
  seeded = await worker({ DEPOSIT_CATALOGUE_STORE_TOKEN: token });
  bare = await worker({});
  const document = { schemaVersion: 1, baseline: [entry('ethereum', 'ethereum', '0x' + '1'.repeat(40)), entry('bitcoin', 'bitcoin', 'bc1q' + 'a'.repeat(38), false)], overrides: [] };
  const put = await fetch(`${seeded.url}/receiving-address-catalogue`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '0' }, body: JSON.stringify(document) });
  assert.equal(put.status, 200);
});
after(async () => { await seeded?.mf.dispose(); await bare?.mf.dispose(); });

test('a configured Worker passes every check and reports only active destinations', async () => {
  const r = await run(seeded.url);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /active destinations: 1 \(ETH\/ethereum\)/);
  assert.ok(!r.stdout.includes('0x1111') && !r.stdout.includes(token), 'no address or secret printed');
});

test('a Worker without its secret fails the smoke and says why', async () => {
  const r = await run(bare.url);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL public catalogue answers the site — 503/);
  assert.match(r.stdout, /the Worker has no DEPOSIT_CATALOGUE_STORE_TOKEN/);
});
