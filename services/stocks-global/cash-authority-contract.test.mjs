import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState } from './engine.mjs';
import { openSyntheticCashAuthority, exactEight } from './testing/synthetic-cash-authority.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
const A = { issuer: 'cash-authority-contract-fixture', subject: 'synthetic-a' };
const B = { issuer: 'cash-authority-contract-fixture', subject: 'synthetic-b' };
const order = (id, extra = {}) => ({ id, instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'LIMIT', quantity: '0.1', limitPrice: '90', ...extra });
const command = (id, revision, type = 'submit', input = order(id)) => ({ intentId: id, expectedRevision: revision, type, input });
const quote = (event, price = '90', capacity = '1', timestamp = NOW) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: price, ask: price, timestamp, receivedAt: timestamp, verified: true, marketOpen: true, eventId: event, capacity, prices: { USDT: { buy: price, sell: price } }, fx: {} });
async function fixture(t, hooks = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-cash-contract-')), path = join(dir, 'authority.sqlite');
  const authorities = []; const open = extra => { const value = openSyntheticCashAuthority(path, { now: () => NOW, ...extra }); authorities.push(value); return value; };
  const authority = open(hooks);
  for (const [principal, cashId, available] of [[A, 'synthetic-existing-cash-a', '731.25'], [B, 'synthetic-existing-cash-b', '129.875']]) {
    const state = createState(NOW); state.wallets.USDT.cash = '0.00000000'; state.wallets.USDC.cash = '0.00000000';
    authority.installFixture({ principal, cashId, available, locked: '3.125', state });
  }
  const sessionA = authority.registerFixtureSession(A, { canTrade: true }), sessionB = authority.registerFixtureSession(B, { canTrade: true });
  t.after(async () => { for (const value of authorities) { try { value.close(); } catch {} } await rm(dir, { recursive: true, force: true }); });
  const run = (request, principal = A, session = sessionA, target = authority) => target.execute(target.issuePermit(principal, session, request), request);
  return { authority, sessionA, sessionB, run, open };
}

test('authority contract: missing binding, viewer and forged permit never allocate or mutate cash', async t => {
  const f = await fixture(t), before = f.authority.rowsFixture(), request = command('contract-missing-binding-1', 0);
  const missing = { ...A, subject: 'unbound' }, session = f.authority.registerFixtureSession(missing, { canTrade: true });
  assert.throws(() => f.authority.issuePermit(missing, session, request), /ACCOUNT_NOT_BOUND/);
  const viewer = f.authority.registerFixtureSession(A);
  assert.throws(() => f.authority.issuePermit(A, viewer, request), /AUTH_REQUIRED/);
  assert.throws(() => f.authority.execute({}, request), /AUTH_REQUIRED/);
  assert.deepEqual(f.authority.rowsFixture(), before);
});

test('authority contract: permit binds principal and full intent digest; conflicting replay cannot debit twice', async t => {
  const f = await fixture(t), request = command('contract-digest-order-01', 0), permit = f.authority.issuePermit(A, f.sessionA, request);
  assert.throws(() => f.authority.issuePermit(A, f.sessionB, request), /AUTH_REQUIRED/);
  assert.throws(() => f.authority.execute(permit, { ...request, input: { ...request.input, quantity: '0.2' } }), /IDEMPOTENCY_CONFLICT/);
  const first = f.authority.execute(permit, request), rows = f.authority.rowsFixture();
  assert.deepEqual(f.run(structuredClone(request)), first); assert.deepEqual(f.authority.rowsFixture(), rows);
  assert.throws(() => f.run({ ...request, input: { ...request.input, quantity: '0.2' } }), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => f.authority.execute(permit, { ...request, accountId: 'synthetic-existing-cash-b' }), /ACCOUNT_SELECTOR_FORBIDDEN/);
  assert.equal(f.authority.readFixture(B).snapshot.revision, 0);
});

test('authority contract: reservation and cancel use one cash row and preserve unrelated Wallet locks', async t => {
  const f = await fixture(t), id = 'contract-reserve-order-01'; f.run(command(id, 0));
  let view = f.authority.readFixture(A);
  assert.deepEqual(view.money, { available: '722.25000000', locked: '12.12500000' });
  assert.equal(view.snapshot.wallets.USDT.cash, '731.25000000');
  assert.equal('cash' in JSON.parse(f.authority.rowsFixture().accounts.find(row => row.cash_id === view.cashId).ledger).wallets.USDT, false);
  f.run(command('contract-cancel-intent-01', 1, 'cancel', { id })); view = f.authority.readFixture(A);
  assert.deepEqual(view.money, { available: '731.25000000', locked: '3.12500000' });
  assert.equal(f.authority.readFixture(B).money.available, '129.87500000');
});

test('authority contract: external Wallet spend is authoritative, cannot be respent through stale ledger cash', async t => {
  const f = await fixture(t); f.authority.spendElsewhereFixture('synthetic-existing-cash-a', '730');
  const before = f.authority.rowsFixture(); assert.throws(() => f.run(command('contract-no-double-cash-01', 0)), /INSUFFICIENT_FUNDS/);
  assert.deepEqual(f.authority.rowsFixture(), before); assert.equal(f.authority.readFixture(A).snapshot.wallets.USDT.available, '1.25000000');
});

test('authority contract: revocation before dispatch rejects minted permit without a financial write', async t => {
  const f = await fixture(t), request = command('contract-revoked-queued-01', 0), permit = f.authority.issuePermit(A, f.sessionA, request), before = f.authority.rowsFixture();
  f.authority.revokeFixtureSession(f.sessionA); assert.throws(() => f.authority.execute(permit, request), /AUTH_REQUIRED/);
  assert.deepEqual(f.authority.rowsFixture(), before);
  assert.equal(f.run(command('contract-independent-b-01', 0), B, f.sessionB).snapshot.revision, 1);
});

test('authority contract: fixture revocation after UPDATE rolls back cash, reserve, order and receipt before COMMIT', async t => {
  let revoke = () => {}; const f = await fixture(t, { beforeCommit: () => revoke() });
  const before = f.authority.rowsFixture(); revoke = () => f.authority.revokeFixtureSession(f.sessionA);
  assert.throws(() => f.run(command('contract-revoke-precommit-1', 0)), /AUTH_REQUIRED/);
  assert.deepEqual(f.authority.rowsFixture(), before);
  assert.throws(() => f.authority.issuePermit(A, f.sessionA, command('contract-revoke-precommit-2', 0)), /AUTH_REQUIRED/);
});

test('authority contract: storage rejection has no receipt and success follows durable commit', async t => {
  let fail = true, acknowledged = false; const f = await fixture(t, { beforeCommit: () => { if (fail) throw Error('fixture-storage-failure'); }, afterCommit: () => { acknowledged = true; } });
  const request = command('contract-storage-reject-01', 0), before = f.authority.rowsFixture();
  assert.throws(() => f.run(request), /fixture-storage-failure/); assert.deepEqual(f.authority.rowsFixture(), before); assert.equal(acknowledged, false);
  fail = false; f.run(request); assert.equal(acknowledged, true); const reopened = f.open();
  assert.equal(reopened.readFixture(A).snapshot.revision, 1); assert.equal(reopened.rowsFixture().receipts.length, 1);
});

test('authority contract: lost ACK and reopen replay one durable receipt without reserving twice', async t => {
  const f = await fixture(t, { afterCommit: () => { throw Error('fixture-lost-ack'); } }), request = command('contract-lost-ack-order-01', 0);
  assert.throws(() => f.run(request), /ACCOUNT_OUTCOME_UNKNOWN/); const before = f.authority.rowsFixture();
  const reopened = f.open(), session = reopened.registerFixtureSession(A, { canTrade: true });
  const receipt = f.run(request, A, session, reopened);
  assert.equal(receipt.snapshot.wallets.USDT.reserved, '9.00000000'); assert.deepEqual(reopened.rowsFixture(), before);
  assert.equal(before.receipts.length, 1); assert.equal(before.audit.length, 1);
});

test('authority contract: original FIFO/capacity and partial sell proceeds remain in the same cash account', async t => {
  const f = await fixture(t), first = 'contract-fifo-first-order', second = 'contract-fifo-second-order';
  f.run(command(first, 0)); f.run(command(second, 1));
  let receipt = f.run(command('contract-fifo-quote-event1', 2, 'quote', quote('contract-observation-1', '90', '0.15')));
  assert.deepEqual(receipt.snapshot.orders.map(row => [row.id, row.filled]), [[first, '0.10000000'], [second, '0.05000000']]);
  f.run(command('contract-fifo-cancel-rest', 3, 'cancel', { id: second }));
  f.run(command('contract-fifo-quote-event2', 4, 'quote', quote('contract-observation-2', '100')));
  receipt = f.run(command('contract-partial-sell-01', 5, 'submit', order('contract-partial-sell-01', { side: 'SELL', type: 'MARKET', quantity: '0.05' })));
  assert.equal(receipt.snapshot.wallets.USDT.cash, '722.75000000');
  assert.deepEqual(f.authority.readFixture(A).money, { available: '722.75000000', locked: '3.12500000' });
  assert.equal(f.authority.readFixture(B).snapshot.revision, 0);
});

test('authority contract: exact18-to8 conversion rejects dust without rounding', () => {
  assert.equal(exactEight('731.250000000000000000'), '731.25000000');
  for (const value of ['0.000000001', '1.123456789', '-1', '1e2']) assert.throws(() => exactEight(value), /CASH_PRECISION_UNSUPPORTED/);
});

test('authority contract: fixture session expiry at pre-COMMIT rolls back audit and financial effects', async t => {
  let clock = NOW; const f = await fixture(t, { now: () => clock, beforeCommit: () => { clock += 4000; } });
  const before = f.authority.rowsFixture();
  assert.throws(() => f.run(command('contract-expired-at-commit', 0)), /AUTH_REQUIRED/);
  assert.deepEqual(f.authority.rowsFixture(), before);
});
