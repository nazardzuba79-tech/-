import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { openAccountWorker } from './account-worker.mjs';
import { SimError } from './engine.mjs';

// The SQLite account worker re-runs the caller's authorization at its
// pre-COMMIT fence (after the write is staged, before COMMIT). Disposable
// ledgers only; no real user, session or balance.
const NOW = 1791569400000;
const ID = 'BYBIT:AAPLXUSDT';
const ALICE = { issuer: 'commit-fence-fixture', subject: 'alice' };
const BOB = { issuer: 'commit-fence-fixture', subject: 'bob' };
const quote = (n = 1) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'commit-fence-quote-' + n, capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {} });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-commit-fence-'));
  const repo = await openAccountWorker(join(dir, 'accounts.sqlite'), { now: () => NOW });
  t.after(async () => { await repo.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  const alice = await repo.forPrincipal(ALICE), bob = await repo.forPrincipal(BOB);
  const revision = async store => (await store.read()).revision;
  return { repo, alice, bob, revision };
}
const rejects = async (promise, code) => assert.rejects(promise, error => error instanceof SimError && error.code === code);

test('an allowed fence commits; the fence runs once per fenced command', async t => {
  const f = await fixture(t); let calls = 0;
  await f.alice.execute('quote', quote(1), { fence: async () => { calls++; } });
  assert.equal(calls, 1);
  assert.equal(await f.revision(f.alice), 1);
});

test('a revoked authorization at the fence rolls back with AUTH_REQUIRED', async t => {
  const f = await fixture(t);
  await rejects(f.alice.execute('quote', quote(1), { fence: async () => { throw new SimError('AUTH_REQUIRED'); } }), 'AUTH_REQUIRED');
  assert.equal(await f.revision(f.alice), 0);
  // The worker stays healthy and the next command commits normally.
  await f.alice.execute('quote', quote(2), { fence: async () => {} });
  assert.equal(await f.revision(f.alice), 1);
});

test('an unavailable or failing authorization rolls back with AUTH_UNAVAILABLE', async t => {
  const f = await fixture(t);
  await rejects(f.alice.execute('quote', quote(1), { fence: async () => { throw new SimError('AUTH_UNAVAILABLE'); } }), 'AUTH_UNAVAILABLE');
  await rejects(f.alice.execute('quote', quote(2), { fence: async () => { throw new Error('identity service crashed'); } }), 'AUTH_UNAVAILABLE');
  assert.equal(await f.revision(f.alice), 0);
});

test('a fence that never answers times out to a rollback; its late answer cannot release a later commit', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  let releaseLate;
  const late = new Promise(resolve => { releaseLate = resolve; });
  const started = Date.now();
  await rejects(f.alice.execute('quote', quote(1), { fence: () => late }), 'AUTH_UNAVAILABLE');
  assert.ok(Date.now() - started >= 2400, 'bounded wait');
  assert.equal(await f.revision(f.alice), 0);
  // The next fenced command is denied; the stale allow of the first must not leak into it.
  let resolveSecond;
  const second = f.bob.execute('quote', quote(2), { fence: () => new Promise((_, reject) => { resolveSecond = () => reject(new SimError('AUTH_REQUIRED')); }) });
  while (!resolveSecond) await new Promise(resolve => setTimeout(resolve, 5));
  releaseLate();
  await new Promise(resolve => setTimeout(resolve, 50));
  resolveSecond();
  await rejects(second, 'AUTH_REQUIRED');
  assert.equal(await f.revision(f.bob), 0);
});

test('fences are accepted only as functions on state-changing commands', async t => {
  const f = await fixture(t);
  await rejects(f.alice.execute('readView', undefined, { fence: async () => {} }), 'ACCOUNT_COMMAND_INVALID');
  await rejects(f.alice.execute('quote', quote(1), { fence: 'allow' }), 'ACCOUNT_COMMAND_INVALID');
  // Unfenced commands keep their previous behavior.
  await f.alice.execute('quote', quote(1));
  assert.equal(await f.revision(f.alice), 1);
});

test('a wall clock stepped back during the fence wait cannot stretch it', { timeout: 30000 }, async t => {
  // testing/wall-clock-step-back.mjs moves the worker's Date.now() one hour back
  // while the fence waits; the 2.5 s deadline must still end the wait and roll back.
  // The driver is a file, not --eval: workers inherit execArgv and reject --input-type.
  const here = new URL('.', import.meta.url).href;
  const driverDir = await mkdtemp(join(tmpdir(), 'stocks-fence-clock-driver-'));
  t.after(() => rm(driverDir, { recursive: true, force: true }));
  const driver = join(driverDir, 'driver.mjs');
  await writeFile(driver, `
    import { Worker } from 'node:worker_threads';
    import { mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const { openAccountWorker } = await import(${JSON.stringify(here + 'account-worker.mjs')});
    const probe = await new Promise((resolve, reject) => {
      const w = new Worker(new URL('data:text/javascript,import{parentPort}from"node:worker_threads";parentPort.postMessage(globalThis[Symbol.for("stocks.wallClockStepBack")]===true)'));
      w.once('message', value => { void w.terminate(); resolve(value); }); w.once('error', reject);
    });
    const dir = await mkdtemp(join(tmpdir(), 'stocks-fence-clock-'));
    const repo = await openAccountWorker(join(dir, 'accounts.sqlite'), { now: () => ${NOW} });
    const alice = await repo.forPrincipal(${JSON.stringify(ALICE)});
    const started = performance.now(); let code = 'COMMITTED';
    try { await alice.execute('quote', ${JSON.stringify(quote(1))}, { fence: () => new Promise(() => {}) }); } catch (error) { code = error.code; }
    const elapsedMs = performance.now() - started, revision = (await alice.read()).revision;
    await repo.close(); await rm(dir, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ probe, code, elapsedMs, revision }));`);
  const child = spawn(process.execPath, ['--import', here + 'testing/wall-clock-step-back.mjs', driver], { windowsHide: true });
  let stdout = '', stderr = '', killed = false;
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const kill = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 15000);
  const status = await new Promise(resolve => child.once('close', resolve)); clearTimeout(kill);
  assert.equal(killed, false, 'the fence wait outlived 15 s after a wall-clock step back');
  assert.equal(status, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.probe, true, 'the step-back preload reaches worker threads');
  assert.equal(result.code, 'AUTH_UNAVAILABLE');
  assert.ok(result.elapsedMs >= 2400 && result.elapsedMs < 10000, 'bounded wait: ' + result.elapsedMs);
  assert.equal(result.revision, 0);
});
