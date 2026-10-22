import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountWorker } from './account-worker.mjs';
import { openAccounts } from './accounts.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT', NVIDIA = 'BYBIT:NVDAXUSDT';
const ALICE = { issuer: 'background-observation-fixture', subject: 'alice' }, BOB = { ...ALICE, subject: 'bob' };
const q = (extra = {}) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'event-1', capacity: '1.00000000', bid: '100', ask: '100', prices: { USDT: { buy: '100', sell: '100' } }, fx: {}, ...extra });
const order = (n, extra = {}) => ({ id: `background-order-${String(n).padStart(16, '0')}`, instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1', ...extra });
const buy = (account, n, extra = {}) => account.execute('submitObserved', { order: order(n, extra) });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-background-')), path = join(dir, 'paper.sqlite');
  let time = NOW; const repos = [], control = new Int32Array(new SharedArrayBuffer(20));
  const open = async (hooks = false) => { const repo = await openAccountWorker(path, { now: () => time, diagnostics: true, ...(hooks ? { testHooks: { commitControl: control.buffer } } : {}) }); repos.push(repo); return repo; };
  const repo = await open(true);
  t.after(async () => { Atomics.store(control, 2, 1); Atomics.notify(control, 2); for (const repo of repos) await repo.close(); await rm(dir, { recursive: true, force: true }); });
  return { repo, control, open, path, advance: ms => { time += ms; return time; } };
}
const outcome = durable => ({ observation: { durable, mode: durable ? 'committed' : 'volatile' } });

test('background observations omit the unused snapshot without losing quote views or introducing writes', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), b = await f.repo.forPrincipal(BOB), before = f.repo.metrics();
  for (let n = 0; n < 20; n++) {
    const quote = q({ instrumentId: n % 2 ? ID : NVIDIA, eventId: `background-${n}`, timestamp: NOW + n });
    const explicit = await a.execute('observe', quote), background = await b.execute('observeBackground', quote);
    assert.deepEqual(background, outcome(false));
    assert.deepEqual(await b.execute('readView'), explicit.snapshot);
  }
  assert.deepEqual(await a.read(), await b.read()); assert.deepEqual((await b.read()).quotes, {});
  assert.equal(f.repo.metrics().sqlWriteCalls, before.sqlWriteCalls);
  assert.equal(f.repo.metrics().transactionExecCalls, before.transactionExecCalls);
  await a.execute('observeFailed', { id: ID }); assert.deepEqual(await b.execute('observeFailedBackground', { id: ID }), outcome(false));
  assert.deepEqual(await b.execute('readView'), await a.execute('readView'));
  await assert.rejects(buy(b, 1), /QUOTE_STALE/);
});

test('background Limit matching preserves every fill, reserve, PnL and same-event capacity fence', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), b = await f.repo.forPrincipal(BOB);
  for (const account of [a, b]) { await account.execute('observe', q()); await buy(account, 1, { type: 'LIMIT', limitPrice: '90', quantity: '2' }); }
  const variants = [q({ eventId: 'non-crossing' }), q({ eventId: 'crossing', prices: { USDT: { buy: '80', sell: '80' } } }), q({ eventId: 'crossing', prices: { USDT: { buy: '80', sell: '80' } } }), q({ eventId: 'remaining', prices: { USDT: { buy: '85', sell: '85' } } })];
  for (const quote of variants) {
    const explicit = await a.execute('observe', quote), background = await b.execute('observeBackground', quote);
    assert.deepEqual(background, outcome(true)); assert.deepEqual(await b.execute('readView'), explicit.snapshot);
    assert.deepEqual(await b.read(), await a.read());
  }
  const view = await b.execute('readView');
  assert.equal(view.fills.length, 2); assert.equal(view.orders[0].status, 'FILLED');
  assert.equal(view.wallets.USDT.reserved, '0.00000000'); assert.equal(view.positions[ID + '|USDT'].quantity, '2.00000000');
  const mark = q({ eventId: 'mark', prices: { USDT: { buy: '95', sell: '95' } } });
  assert.deepEqual(await b.execute('observeBackground', mark), outcome(false));
  assert.equal((await b.execute('readView')).positions[ID + '|USDT'].unrealized, '25.00000000');
  const sale = await b.execute('submitObserved', { order: order(2, { side: 'SELL', quantity: '1' }) });
  assert.ok(sale.snapshot); assert.equal(sale.snapshot.fills.length, 3);
  const restored = await (await f.open()).forPrincipal(BOB); assert.deepEqual(await restored.read(), await b.read());
});

test('background source failure with an active order remains durable and explicit recovery returns a full snapshot', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), b = await f.repo.forPrincipal(BOB);
  for (const account of [a, b]) { await account.execute('observe', q()); await buy(account, 1, { type: 'LIMIT', limitPrice: '90' }); }
  const explicit = await a.execute('observeFailed', { id: ID });
  assert.deepEqual(await b.execute('observeFailedBackground', { id: ID }), outcome(true));
  assert.deepEqual(await b.execute('readView'), explicit.snapshot); assert.deepEqual(await a.read(), await b.read());
  await assert.rejects(buy(b, 2), /QUOTE_STALE/);
  const recovered = await b.execute('observe', q({ eventId: 'recover' }));
  assert.ok(recovered.snapshot); assert.equal(recovered.snapshot.quotes[ID].status.USDT, 'READY');
});

test('background quotes retain invalid, stale, closed-session and unverified execution guards', async t => {
  const f = await fixture(t), first = await f.repo.forPrincipal(ALICE);
  await assert.rejects(first.execute('observeBackground', q({ timestamp: NOW + 2001 })), /INVALID_QUOTE/);
  const cases = [[{ verified: false }, 'INVALID_QUOTE'], [{ marketOpen: false }, 'MARKET_CLOSED'], [{ timestamp: NOW - 31000, receivedAt: NOW - 31000 }, 'QUOTE_STALE'], [{ capacity: 'invalid' }, 'INVALID_QUOTE'], [{ prices: { USDT: { buy: 'invalid', sell: '100' } } }, 'INVALID_QUOTE']];
  for (const [index, [patch, code]] of cases.entries()) {
    const a = await f.repo.forPrincipal({ ...ALICE, subject: `alice-${index}` }), b = await f.repo.forPrincipal({ ...BOB, subject: `bob-${index}` });
    const quote = q(patch); await a.execute('observe', quote); await b.execute('observeBackground', quote);
    const results = await Promise.all([buy(a, 1), buy(b, 1)].map(p => p.catch(error => error.code)));
    assert.equal(results[0], code); assert.equal(results[1], code);
    assert.equal((await b.read()).fills.length, 0);
    assert.deepEqual(await b.execute('readView'), await a.execute('readView'));
  }
});

test('background updates never expose another owner or permit unfunded owners to use its observations', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE), b = await f.repo.forPrincipal(BOB);
  assert.deepEqual(await a.execute('observeBackground', q()), outcome(false)); await buy(a, 1);
  assert.deepEqual((await b.execute('readView')).quotes, {}); await assert.rejects(buy(b, 1), /QUOTE_STALE/);
  assert.equal((await b.read()).wallets.USDT.cash, '10000.00000000'); assert.equal((await b.read()).fills.length, 0);
  const external = openAccounts(f.path, { now: () => NOW });
  try { assert.deepEqual(external.forPrincipal(BOB).read().positions, {}); }
  finally { external.close(); }
});

test('background active-order acknowledgement waits for durable commit and subsequent reads remain FIFO', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await a.execute('observe', q()); await buy(a, 1, { type: 'LIMIT', limitPrice: '90' });
  const before = await a.read(), count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0);
  let settled = false, readSettled = false;
  const pending = a.execute('observeBackground', q({ eventId: 'crossing', prices: { USDT: { buy: '80', sell: '80' } } }));
  pending.then(() => { settled = true; }, () => { settled = true; });
  const read = a.read().then(value => { readSettled = true; return value; });
  const deadline = Date.now() + 5000;
  while (Atomics.load(f.control, 1) <= count) { assert.ok(Date.now() < deadline); await delay(5); }
  assert.equal(settled, false); assert.equal(readSettled, false);
  const external = openAccounts(f.path, { now: () => NOW });
  try { assert.deepEqual(external.forPrincipal(ALICE).read(), before); } finally { external.close(); }
  Atomics.store(f.control, 2, 1); Atomics.notify(f.control, 2);
  assert.deepEqual(await pending, outcome(true)); assert.equal((await read).fills.length, 1);
});

test('background failed commit rolls back the fill and removes the quote from execution admission', async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await a.execute('observe', q()); await buy(a, 1, { type: 'LIMIT', limitPrice: '90' });
  const before = await a.read(); Atomics.store(f.control, 4, 1);
  await assert.rejects(a.execute('observeBackground', q({ eventId: 'crossing', prices: { USDT: { buy: '80', sell: '80' } } })), /ACCOUNT_TEST_COMMIT_FAILURE/);
  Atomics.store(f.control, 4, 0); assert.deepEqual(await a.read(), before);
  await assert.rejects(buy(a, 2), /QUOTE_STALE/);
});

for (const failure of [1, 2]) test(`background post-COMMIT failure ${failure} remains UNKNOWN and recovers each fill once`, async t => {
  const f = await fixture(t), a = await f.repo.forPrincipal(ALICE); await a.execute('observe', q()); await buy(a, 1, { type: 'LIMIT', limitPrice: '90' });
  Atomics.store(f.control, 3, failure);
  await assert.rejects(a.execute('observeBackground', q({ eventId: 'crossing', prices: { USDT: { buy: '80', sell: '80' } } })), /ACCOUNT_OUTCOME_UNKNOWN/);
  await assert.rejects(a.read(), /ACCOUNT_UNAVAILABLE/);
  const restored = await (await f.open()).forPrincipal(ALICE), recovered = await buy(restored, 1, { type: 'LIMIT', limitPrice: '90' });
  assert.equal(recovered.snapshot.fills.length, 1); assert.equal(recovered.snapshot.wallets.USDT.cash, '9992.00000000');
  await assert.rejects(buy(restored, 2), /QUOTE_STALE/);
});
