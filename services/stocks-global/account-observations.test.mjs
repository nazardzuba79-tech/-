import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountWorker } from './account-worker.mjs';
import { openAccounts } from './accounts.mjs';
import { createObservations } from './account-observations.mjs';
import { createState, applyQuote, submit, snapshot } from './engine.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT', NVIDIA = 'BYBIT:NVDAXUSDT';
const ALICE = { issuer: 'observation-fixture-only', subject: 'alice' }, BOB = { ...ALICE, subject: 'bob' };
const q = (extra = {}) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'event-1', capacity: '1.00000000', bid: '100', ask: '100', prices: { USDT: { buy: '100', sell: '100' } }, fx: {}, ...extra });
const order = (n, extra = {}) => ({ id: `observation-order-${String(n).padStart(16, '0')}`, instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1', ...extra });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-observation-')), path = join(dir, 'paper.sqlite');
  let time = NOW; const repos = [], control = new Int32Array(new SharedArrayBuffer(20));
  const open = async (hooks = false) => { const repo = await openAccountWorker(path, { now: () => time, diagnostics: true, ...(hooks ? { testHooks: { commitControl: control.buffer } } : {}) }); repos.push(repo); return repo; };
  const repo = await open(true);
  t.after(async () => { Atomics.store(control, 2, 1); Atomics.notify(control, 2); for (const repo of repos) await repo.close(); await rm(dir, { recursive: true, force: true }); });
  return { repo, control, open, path, advance: ms => { time += ms; return time; } };
}
const observe = (account, quote) => account.execute('observe', quote);
const buy = (account, n, extra = {}) => account.execute('submitObserved', { order: order(n, extra) });

test('reader quotes and PnL are projected with zero durable UPDATE/transaction calls', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), b = await f.repo.forPrincipal(BOB), before = f.repo.metrics();
  for (let n = 0; n < 20; n++) {
    const result = await observe(a, q({ eventId: `reader-${n}`, timestamp: NOW + n, receivedAt: NOW + n }));
    assert.deepEqual(result.observation, { durable: false, mode: 'volatile' }); assert.equal(result.snapshot.revision, 0);
  }
  const metrics = f.repo.metrics();
  assert.equal(metrics.sqlWriteCalls, before.sqlWriteCalls); assert.equal(metrics.transactionExecCalls, before.transactionExecCalls);
  assert.equal(metrics.observationsVolatile, 20); assert.equal(metrics.observationsDurable, 0);
  assert.deepEqual((await a.read()).quotes, {}); assert.equal((await a.execute('readView')).quotes[ID].eventId, 'reader-19');
  assert.deepEqual((await b.execute('readView')).quotes, {});
  const trade = await buy(a, 1); assert.equal(trade.snapshot.fills.length, 1);
  const time = f.advance(1000), changed = q({ eventId: 'mark', timestamp: time, receivedAt: time, prices: { USDT: { buy: '120', sell: '120' } } });
  const result = await observe(a, changed);
  assert.equal(result.snapshot.positions[ID + '|USDT'].unrealized, '2.00000000');
  assert.equal((await a.read()).quotes[ID].eventId, 'reader-19');
  assert.equal((await b.read()).wallets.USDT.cash, '10000.00000000');
});

test('projection uses unchanged snapshot arithmetic and preserves sequence capacity through equal-timestamp events', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), original = createState(NOW);
  const first = q(); applyQuote(original, first, NOW); await observe(a, first);
  submit(original, order(1, { quantity: '0.6' }), NOW); await buy(a, 1, { quantity: '0.6' });
  for (const next of [q({ eventId: 'event-2' }), first]) { applyQuote(original, next, NOW); await observe(a, next); }
  submit(original, order(2, { quantity: '0.6' }), NOW); const result = await buy(a, 2, { quantity: '0.6' });
  const expected = snapshot(original, NOW);
  for (const field of ['wallets', 'positions', 'fills', 'orders', 'realized', 'quotes']) assert.deepEqual(result.snapshot[field], expected[field]);
  assert.equal(result.snapshot.quotes[ID].used, '0.60000000');
  await observe(a, q({ receivedAt: NOW + 1 })); await buy(a, 3, { quantity: '0.6' });
  assert.equal((await a.read()).fills.at(-1).quantity, '0.40000000');
});

test('active Limit observations remain durable even when non-crossing; same event cannot rematch', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE);
  await observe(a, q()); await buy(a, 1, { type: 'LIMIT', limitPrice: '90', quantity: '2' });
  const time = f.advance(10), next = q({ eventId: 'non-crossing', timestamp: time, receivedAt: time });
  const result = await observe(a, next); assert.equal(result.observation.durable, true); assert.equal(result.snapshot.fills.length, 0);
  assert.equal((await a.read()).quotes[ID].eventId, next.eventId);
  await observe(a, { ...next, prices: { USDT: { buy: '80', sell: '80' } } }); assert.equal((await a.read()).fills.length, 0);
  await f.repo.close(); const reopened = await f.open(), restored = await reopened.forPrincipal(ALICE);
  const later = f.advance(3000);
  await observe(restored, { ...next, timestamp: later, receivedAt: later, prices: { USDT: { buy: '80', sell: '80' } } });
  assert.equal((await restored.read()).fills.length, 0, 'same event remains consumed as an observation after restart');
  const filled = await observe(restored, q({ eventId: 'crossing-new', timestamp: later + 1, receivedAt: later + 1, prices: { USDT: { buy: '80', sell: '80' } } }));
  assert.equal(filled.snapshot.fills.length, 1); assert.equal(filled.snapshot.orders[0].status, 'PARTIAL');
});

test('restart never falls back to fresh durable quotes; replay remains idempotent and recovery is stricter', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q()); await buy(a, 1);
  await observe(a, q({ eventId: 'unpersisted-newer', timestamp: NOW + 1000, receivedAt: NOW + 1000 }));
  await f.repo.close(); const reopened = await f.open(), restored = await reopened.forPrincipal(ALICE);
  const replay = await buy(restored, 1); assert.equal(replay.snapshot.fills.length, 1);
  await assert.rejects(buy(restored, 1, { quantity: '0.2' }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(buy(restored, 2), /QUOTE_STALE/);
  await observe(restored, q({ eventId: 'older-still-fresh', timestamp: NOW + 500, receivedAt: NOW }));
  await assert.rejects(buy(restored, 2), /QUOTE_STALE/);
  const time = f.advance(3000); await observe(restored, q({ eventId: 'safe-newer', timestamp: time, receivedAt: time }));
  assert.equal((await buy(restored, 2)).snapshot.fills.length, 2);
});

test('Limit during cold recovery only reserves and cannot use older fallback observations', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q()); await buy(a, 1);
  await f.repo.close(); const reopened = await f.open(), restored = await reopened.forPrincipal(ALICE);
  const pending = await buy(restored, 2, { type: 'LIMIT', limitPrice: '150' });
  assert.equal(pending.snapshot.orders[1].status, 'OPEN'); assert.equal(pending.snapshot.fills.length, 1);
  const blocked = await observe(restored, q({ eventId: 'crossing-but-before-recovery', timestamp: NOW + 1, receivedAt: NOW + 1 }));
  assert.equal(blocked.observation.durable, true); assert.equal(blocked.snapshot.fills.length, 1);
  const time = f.advance(3000); const recovered = await observe(restored, q({ eventId: 'recovered', timestamp: time, receivedAt: time }));
  assert.equal(recovered.snapshot.fills.length, 2);
});

test('source failure and server admission fence prevent fallback; stale projected quote is not executable', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q()); await buy(a, 1);
  const before = f.repo.metrics(); await a.execute('observeFailed', { id: ID });
  assert.equal(f.repo.metrics().sqlWriteCalls, before.sqlWriteCalls);
  assert.equal((await a.execute('readView')).quotes[ID].status.USDT, 'QUOTE_STALE');
  await assert.rejects(buy(a, 2), /QUOTE_STALE/);
  await observe(a, q()); await assert.rejects(a.execute('submitObserved', { order: order(2), sourceBlocked: true }), /QUOTE_STALE/);
  f.advance(31000); await assert.rejects(buy(a, 2), /QUOTE_STALE/);
  assert.equal((await a.read()).fills.length, 1);
});

test('bounded payload eviction preserves watermark and used capacity; lost owner uses epoch barrier', () => {
  let time = NOW;
  const obs = createObservations({ now: () => time, maxBytes: 600 }), state = createState(NOW);
  obs.register('alice', true); obs.observe('alice', state, q({ timestamp: NOW + 100, eventId: 'latest' }));
  obs.observe('alice', state, q({ instrumentId: NVIDIA }));
  assert.ok(obs.metrics().observationBytes <= 600); assert.ok(obs.metrics().observationEvictions >= 1);
  assert.throws(() => obs.submit('alice', state, { order: order(1) }, time), /QUOTE_STALE/);
  obs.observe('alice', state, q({ timestamp: NOW + 50 }));
  assert.throws(() => obs.submit('alice', state, { order: order(1) }, time), /QUOTE_STALE/);
  obs.observe('alice', state, q({ timestamp: NOW + 100, eventId: 'latest' }));
  obs.submit('alice', state, { order: order(1) }, time); obs.committed('alice', state, ID);
  obs.observe('alice', state, q({ instrumentId: NVIDIA })); obs.observe('alice', state, q({ timestamp: NOW + 100, eventId: 'latest' }));
  obs.submit('alice', state, { order: order(2, { quantity: '1' }) }, time);
  assert.equal(state.fills.at(-1).quantity, '0.90000000');
  obs.forget('alice'); obs.register('alice', false); obs.observe('alice', state, q({ timestamp: NOW + 100, eventId: 'latest' }));
  assert.throws(() => obs.submit('alice', state, { order: order(3) }, time), /QUOTE_STALE/);
  time += 3000; obs.observe('alice', state, q({ timestamp: time, receivedAt: time, eventId: 'post-recovery' }));
  obs.submit('alice', state, { order: order(3) }, time); assert.equal(state.fills.length, 3);
});

test('failed active quote COMMIT cannot publish projection as execution authority', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q());
  await buy(a, 1, { type: 'LIMIT', limitPrice: '90' }); const before = await a.read();
  Atomics.store(f.control, 4, 1);
  await assert.rejects(observe(a, q({ eventId: 'crossing', timestamp: NOW + 1, prices: { USDT: { buy: '80', sell: '80' } } })), /ACCOUNT_TEST_COMMIT_FAILURE/);
  Atomics.store(f.control, 4, 0); assert.deepEqual(await a.read(), before);
  await assert.rejects(buy(a, 2), /QUOTE_STALE/); assert.equal((await a.read()).fills.length, 0);
});

test('observed submit loss after durable COMMIT recovers same ID exactly once', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q());
  Atomics.store(f.control, 3, 1); await assert.rejects(buy(a, 1), /ACCOUNT_OUTCOME_UNKNOWN/);
  const reopened = await f.open(), restored = await reopened.forPrincipal(ALICE);
  const recovered = await buy(restored, 1); assert.equal(recovered.snapshot.fills.length, 1); assert.equal(recovered.snapshot.wallets.USDT.cash, '9990.00000000');
  await assert.rejects(buy(restored, 2), /QUOTE_STALE/);
});

test('another repository cannot turn an older read projection into unfenced execution authority', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q());
  const external = openAccounts(f.path, { now: () => NOW });
  try { await external.forPrincipal(ALICE).transact(s => submit(s, order(1, { type: 'LIMIT', limitPrice: '150' }), NOW)); }
  finally { external.close(); }
  await assert.rejects(buy(a, 2), /QUOTE_STALE/); assert.equal((await a.read()).fills.length, 0);
  const time = f.advance(1); const durable = await observe(a, q({ eventId: 'after-limit', timestamp: time, receivedAt: time }));
  assert.equal(durable.observation.durable, true); assert.equal(durable.snapshot.orders[0].status, 'FILLED');
  assert.equal((await buy(a, 2)).snapshot.fills.length, 2);
});

test('cancel and capital edits acknowledge durable success and preserve valid sibling valuation', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q());
  await observe(a, q({ instrumentId: NVIDIA })); await buy(a, 1, { type: 'LIMIT', limitPrice: '50' });
  const cancelled = await a.execute('cancel', { id: order(1).id }); assert.equal(cancelled.result.status, 'CANCELLED');
  const capital = await a.execute('balances', { id: 'capital-observations-111111111111', balances: { USDT: '12000', USDC: '13000' } });
  assert.equal(capital.snapshot.wallets.USDT.cash, '12000.00000000'); assert.equal(capital.snapshot.adjustments.length, 1);
  const view = await a.execute('readView'); assert.equal(view.quotes[NVIDIA].status.USDT, 'READY');
  assert.equal((await buy(a, 2, { instrumentId: NVIDIA })).snapshot.fills.length, 1);
});

test('real worker caps owner/tombstone lifetime at 512 and eviction cannot revive a durable quote', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q()); await buy(a, 1);
  await observe(a, q({ eventId: 'lost-volatile', timestamp: NOW + 1000, receivedAt: NOW + 1000 }));
  for (let n = 0; n < 512; n++) await f.repo.forPrincipal({ ...ALICE, subject: `fixture-other-${n}` });
  assert.equal(f.repo.metrics().observationOwners, 512); assert.ok(f.repo.metrics().observationBytes <= 4 * 1048576);
  await assert.rejects(buy(a, 2), /QUOTE_STALE/); assert.equal(f.repo.metrics().observationOwners, 512);
  await observe(a, q()); await assert.rejects(buy(a, 2), /QUOTE_STALE/);
  assert.equal((await buy(a, 1)).snapshot.fills.length, 1, 'existing-ID recovery still works after handle eviction');
  const time = f.advance(3000); await observe(a, q({ eventId: 'after-handle-recovery', timestamp: time, receivedAt: time }));
  assert.equal((await buy(a, 2)).snapshot.fills.length, 2);
});

test('same-ID replay and a blocked pending Limit never downgrade a newer volatile watermark', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await observe(a, q()); await buy(a, 1);
  const newer = q({ eventId: 'newer-not-durable', timestamp: NOW + 1000, receivedAt: NOW + 1000 });
  await observe(a, newer); await buy(a, 1);
  assert.equal((await a.execute('readView')).quotes[ID].eventId, newer.eventId);
  await observe(a, q()); assert.equal((await a.execute('readView')).quotes[ID].eventId, newer.eventId);
  await a.execute('submitObserved', { order: order(2, { type: 'LIMIT', limitPrice: '50' }), sourceBlocked: true });
  await observe(a, q()); await assert.rejects(buy(a, 3), /QUOTE_STALE/);
  assert.equal((await a.read()).fills.length, 1);
});

test('rebasing against a newer durable quote invalidates old payload before ignored observations return', () => {
  const obs = createObservations({ now: () => NOW }), state = createState(NOW); obs.register('alice', true);
  applyQuote(state, q(), NOW); obs.observe('alice', state, q({ eventId: 'volatile-B', timestamp: NOW + 200, prices: { USDT: { buy: '90', sell: '90' } } }));
  applyQuote(state, q({ eventId: 'durable-C', timestamp: NOW + 300, prices: { USDT: { buy: '110', sell: '110' } } }), NOW); state.revision++;
  for (let n = 0; n < 2; n++) {
    assert.equal(obs.observe('alice', state, q({ eventId: 'volatile-B', timestamp: NOW + 200, prices: { USDT: { buy: '90', sell: '90' } } })).ignored, true);
    assert.equal(obs.view('alice', structuredClone(state)).quotes[ID].eventId, 'durable-C');
    assert.throws(() => obs.submit('alice', structuredClone(state), { order: order(1) }, NOW), /QUOTE_STALE/);
  }
  assert.equal(state.quotes[ID].eventId, 'durable-C'); assert.equal(state.fills.length, 0);
});
