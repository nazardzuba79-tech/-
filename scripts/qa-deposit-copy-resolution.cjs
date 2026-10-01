/* Disposable PostgreSQL only. No production credentials, RPCs or payments. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const { DepositBatchService } = require('../dist/services/deposits/DepositBatchService');
const { ignoreDepositCopy, COPY_RESOLUTION_PREFIX } = require('../dist/services/deposits/depositCopyResolution');
const { latestDepositCopiesForUsers } = require('../dist/services/deposits/latestDepositCopiesForUsers');

const url = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.COPY_RESOLUTION_QA !== '1' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/voltex_copy_resolution') {
  throw Error('Refusing anything except the named disposable localhost database');
}
const db = new PrismaClient();
const address = '0x' + '1'.repeat(40);
const otherAddress = '0x' + '2'.repeat(40);
const checks = [];
const ok = (name) => { checks.push(name); console.log('PASS', name); };
async function user(role = 'USER') {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'synthetic-only', referralCode: id, role } });
}
async function copy(userId, fields = {}) {
  return db.depositAddressCopyEvent.create({ data: {
    userId, eventId: randomUUID(), asset: 'USDT', network: 'ethereum', addressSnapshot: address,
    source: 'header', ...fields,
  } });
}
const latest = async id => {
  const r = await latestDepositCopiesForUsers(db, [id]);
  assert.equal(r.failed, false); return r.byUser.get(id) || null;
};
const receipt = id => db.auditLog.findUnique({ where: { id: COPY_RESOLUTION_PREFIX + id } });
async function transfer(userId, amount = '500') {
  return db.deposit.create({ data: {
    userId, asset: 'USDT', chain: 'ethereum', txHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), amount,
    status: 'PENDING', confirmations: 30, finalized: true, verifiedAt: new Date(), recipientAddress: address,
  } });
}
function service(prove) {
  return new DepositBatchService(db, { getTicker: async () => null }, async chain => ({
    chain, type: 'evm', treasuryAddress: address, minConfirmations: 12, nativeAsset: 'ETH', tokens: {},
  }), prove || (async (_config, hash) => {
    const d = await db.deposit.findUnique({ where: { chain_txHash: { chain: 'ethereum', txHash: hash } } });
    return { amount: new BigNumber(d.amount.toString()), confirmations: 30, finalized: true, recipient: address, blockNumber: 1, blockTimestamp: null };
  }));
}
async function confirmParams(s, u, admin, idempotencyKey = randomUUID()) {
  const p = await s.preview({ userId: u.id, chain: 'ethereum', asset: 'USDT' });
  return { adminId: admin.id, userId: u.id, chain: 'ethereum', asset: 'USDT',
    token: p.token, depositIds: p.transfers.map(d => d.id), idempotencyKey };
}
async function balance(id) {
  return db.balance.findUnique({ where: { userId_asset: { userId: id, asset: 'USDT' } } });
}

async function main() {
  const admin = await user('ADMIN'), admin2 = await user('ADMIN');
  const a = await user(), b = await user();
  await db.balance.create({ data: { userId: a.id, asset: 'USDT', available: '123.456789', locked: '20' } });
  const old = await copy(a.id, { receivedAt: new Date('2026-01-01T00:00:00Z') });
  const selected = await copy(a.id, { receivedAt: new Date('2026-01-01T00:01:00Z') });
  const newer = await copy(a.id, { receivedAt: new Date('2026-01-01T00:02:00Z') });
  const different = await copy(a.id, { network: 'tron', addressSnapshot: 'T' + 'A'.repeat(33), receivedAt: new Date('2026-01-01T00:00:30Z') });
  const other = await copy(b.id);
  const before = await balance(a.id);
  const copyCount = await db.depositAddressCopyEvent.count();
  await Promise.all([ignoreDepositCopy(db, selected.id, admin.id), ignoreDepositCopy(db, selected.id, admin2.id)]);
  assert.equal((await receipt(selected.id)).metadata.outcome, 'IGNORED');
  assert.ok(await receipt(old.id));
  assert.equal(await receipt(newer.id), null);
  assert.equal(await receipt(different.id), null);
  assert.equal(await receipt(other.id), null);
  assert.equal((await latest(a.id)).id, newer.id);
  assert.deepEqual(await balance(a.id), before);
  assert.equal(await db.depositAddressCopyEvent.count(), copyCount);
  ok('Ignore is durable, concurrent/idempotent, rail/recipient/user scoped, and changes no money or copy history');
  const at = (await receipt(selected.id)).createdAt.toISOString();
  await ignoreDepositCopy(db, selected.id, admin.id);
  assert.equal((await receipt(selected.id)).createdAt.toISOString(), at);
  assert.equal((await latest(a.id)).id, newer.id);
  ok('Retry of an older Ignore cannot acknowledge a newer signal or rewrite the processing timestamp');
  await ignoreDepositCopy(db, newer.id, admin.id);
  assert.equal((await latest(a.id)).id, different.id);
  await ignoreDepositCopy(db, different.id, admin.id);
  assert.equal(await latest(a.id), null);
  const fresh = await copy(a.id);
  assert.equal((await latest(a.id)).id, fresh.id);
  await ignoreDepositCopy(db, selected.id, admin.id);
  assert.equal((await latest(a.id)).id, fresh.id);
  ok('Another network stays pending; a new copy after Ignore reappears and survives old retries');
  await assert.rejects(ignoreDepositCopy(db, randomUUID(), admin.id), /Сигнал больше недоступен/);
  ok('Missing signal cannot be resolved or used as a user selector');

  const c = await user();
  await db.balance.create({ data: { userId: c.id, asset: 'USDT', available: '100', locked: '20' } });
  const ready = await copy(c.id);
  const foreignAddress = await copy(c.id, { addressSnapshot: otherAddress });
  const foreignRail = await copy(c.id, { network: 'tron', addressSnapshot: 'T' + 'B'.repeat(33) });
  const foreignAsset = await copy(c.id, { asset: 'ETH' });
  const d = await transfer(c.id);
  let duringProof;
  const s = service(async () => {
    duringProof = await copy(c.id);
    return { amount: new BigNumber('500'), confirmations: 30, finalized: true, recipient: address };
  });
  const params = await confirmParams(s, c, admin);
  const result = await s.confirm(params);
  assert.equal(result.status, 'CREDITED');
  assert.equal((await balance(c.id)).available.toString(), '600');
  assert.equal((await balance(c.id)).locked.toString(), '20');
  assert.equal((await receipt(ready.id)).metadata.batchId, result.batchId);
  assert.equal((await receipt(ready.id)).metadata.outcome, 'CREDITED');
  for (const untouched of [foreignAddress, foreignRail, foreignAsset, duringProof, other]) assert.equal(await receipt(untouched.id), null);
  assert.equal((await db.deposit.findUnique({ where: { id: d.id } })).status, 'CREDITED');
  const next = await copy(c.id);
  const replayed = await s.confirm(params);
  assert.equal(replayed.replayed, true);
  assert.equal(await receipt(next.id), null);
  assert.equal((await balance(c.id)).available.toString(), '600');
  ok('Actual manual credit resolves only the captured matching user/coin/network/recipient; new copies and replay stay safe');

  const low = await user(), lowCopy = await copy(low.id);
  await transfer(low.id, '499.999999');
  const normal = service();
  await assert.rejects(normal.confirm(await confirmParams(normal, low, admin)), e => e.code === 'BELOW_MINIMUM');
  assert.equal(await receipt(lowCopy.id), null); assert.equal(await balance(low.id), null);
  ok('Below-minimum credit neither hides a signal nor creates money');

  const fail = await user(), failCopy = await copy(fail.id);
  await transfer(fail.id);
  const unavailable = service(async () => { throw Error('synthetic provider unavailable'); });
  await assert.rejects(unavailable.confirm(await confirmParams(unavailable, fail, admin)), e => e.code === 'PROVIDER_UNAVAILABLE');
  assert.equal(await receipt(failCopy.id), null); assert.equal(await balance(fail.id), null);
  ok('Failed external verification keeps the signal pending and the balance untouched');

  const rollback = await user(), rollbackCopy = await copy(rollback.id);
  const rollbackDeposit = await transfer(rollback.id);
  await db.$executeRawUnsafe(`CREATE FUNCTION copy_resolution_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = 'DEPOSIT_COPY_RESOLVED' THEN RAISE EXCEPTION 'synthetic resolution failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER copy_resolution_test_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION copy_resolution_test_failure()`);
  try { await assert.rejects(normal.confirm(await confirmParams(normal, rollback, admin))); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER copy_resolution_test_failure ON "AuditLog"'); await db.$executeRawUnsafe('DROP FUNCTION copy_resolution_test_failure()'); }
  assert.equal(await balance(rollback.id), null);
  assert.equal(await receipt(rollbackCopy.id), null);
  assert.equal((await db.deposit.findUnique({ where: { id: rollbackDeposit.id } })).status, 'PENDING');
  assert.equal(await db.depositBatch.count({ where: { userId: rollback.id } }), 0);
  ok('A resolution-write failure rolls back the whole credit; no false completed signal or partial balance change');

  const both = await user(), bothCopy = await copy(both.id);
  await transfer(both.id);
  const p1 = await confirmParams(normal, both, admin);
  const responses = await Promise.allSettled([normal.confirm(p1), normal.confirm({ ...p1, adminId: admin2.id, idempotencyKey: randomUUID() })]);
  assert.equal(responses.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await balance(both.id)).available.toString(), '500');
  assert.ok(await receipt(bothCopy.id));
  assert.equal(await db.auditLog.count({ where: { id: COPY_RESOLUTION_PREFIX + bothCopy.id } }), 1);
  ok('Two admins approving concurrently produce one monetary credit and one immutable resolution');

  const ignored = await user(), ignoredCopy = await copy(ignored.id);
  await ignoreDepositCopy(db, ignoredCopy.id, admin.id);
  await transfer(ignored.id);
  await normal.confirm(await confirmParams(normal, ignored, admin));
  assert.equal((await balance(ignored.id)).available.toString(), '500');
  assert.equal((await receipt(ignoredCopy.id)).metadata.outcome, 'IGNORED');
  const noCopy = await user(); await transfer(noCopy.id);
  await normal.confirm(await confirmParams(normal, noCopy, admin));
  assert.equal((await balance(noCopy.id)).available.toString(), '500');
  ok('Ignoring a hint never rejects a later genuine deposit; credit also works without any copy');
  console.log(JSON.stringify({ result: 'PASS', checks, scope: 'Disposable localhost PostgreSQL and injected synthetic proofs only' }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
