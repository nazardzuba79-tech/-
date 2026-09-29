// The post-deploy smoke script, run against the real Worker bundle in workerd
// over HTTP, in the three states a rollout can be in. No external requests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const token = 'synthetic-local-only-listings-secret-0001';
const smoke = fileURLToPath(new URL('../../scripts/smoke-market-edge-listings.mjs', import.meta.url));
let script, configured, bare;

before(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./src/worker.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  script = bundle.outputFiles[0].text;
  configured = await worker({ LISTINGS_STORE_TOKEN: token });
  bare = await worker({});
});

async function worker(bindings) {
  const path = await mkdtemp(join(tmpdir(), 'voltex-edge-smoke-'));
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: path, workers: [{ name: 'market-edge', modules: true, script,
    compatibilityDate: '2026-09-01', bindings, durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { throw new Error('Unexpected external request'); } }] }),
    isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false }, host: '127.0.0.1', port: 0 });
  const url = (await mf.ready).toString().replace(/\/$/, '');
  return { mf, url };
}
const run = (url, extra = [], env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [smoke, url, ...extra], { env: { PATH: process.env.PATH, ...env } }, (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
});

after(async () => { await configured?.mf.dispose(); await bare?.mf.dispose(); });

test('configured Worker + the same token: every check passes, admin store CONNECTED', async () => {
  const r = await run(configured.url, ['--require-admin'], { LISTINGS_STORE_TOKEN: token });
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /listings admin store: CONNECTED \(0 listings\)/);
  assert.match(r.stdout, /ok {3}health version — public-display-edge-v10/);
  assert.ok(!r.stdout.includes(token), 'the token is never printed');
});

test('Worker without its secret: public checks pass, the store reads NOT CONFIGURED, --require-admin fails', async () => {
  const r = await run(bare.url);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /listings admin store: NOT CONFIGURED/);
  assert.equal((await run(bare.url, ['--require-admin'])).code, 1);
});

test('Render and Worker tokens differ: TOKEN MISMATCH fails the smoke', async () => {
  const r = await run(configured.url, [], { LISTINGS_STORE_TOKEN: 'another-synthetic-secret-of-32-chars-00' });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /listings admin store: TOKEN MISMATCH/);
});

test('a different health version is reported, never accepted silently', async () => {
  const r = await run(configured.url, ['--expect-version', 'public-display-edge-v11']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL health version — public-display-edge-v10 \(expected public-display-edge-v11\)/);
});
