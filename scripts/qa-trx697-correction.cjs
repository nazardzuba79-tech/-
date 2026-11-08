// Disposable PostgreSQL only. No production credentials, accounts or funding.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const BigNumber = require('bignumber.js');
const { startDatabase } = require('./qa-deposit-packages.cjs');
const { preview, apply, digest, walletState, operationKey } = require('./lib/trx697Correction.cjs');
const { mutateFuturesBalance } = require('../dist/services/WalletMutation');
const { transferWalletBalance } = require('../dist/services/WalletTransferService');
const out = path.resolve('output/trx697'); fs.mkdirSync(out, { recursive: true });
const report = { scope: 'Disposable PostgreSQL; invented fixture accounts only', checks: [] };
async function main() {
  const database = await startDatabase(); let prisma;
  try {
    for (const dir of fs.readdirSync('prisma/migrations').sort()) {
      const sql = path.join('prisma/migrations', dir, 'migration.sql');
      if (fs.existsSync(sql)) await database.db.query(fs.readFileSync(sql, 'utf8'));
    }
    prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
    report.postgres = (await database.db.query('SHOW server_version')).rows[0].server_version;
    const actor = await prisma.user.create({ data: { email: 'admin697@example.invalid', passwordHash: 'fixture', role: 'ADMIN', referralCode: 'QA697ADMIN' } });
    let seq = 0;
    async function fixture() {
      const user = await prisma.user.create({ data: { email: `case${++seq}@example.invalid`, passwordHash: 'fixture', referralCode: `QA697CASE${seq}` } });
      await prisma.balance.create({ data: { userId: user.id, asset: 'TRC', available: '0' } });
      await prisma.balance.create({ data: { userId: user.id, asset: 'BTC', available: '0.17' } });
      await prisma.demoBalance.create({ data: { userId: user.id, asset: 'USDT', available: '33' } });
      await prisma.futuresBalance.create({ data: { userId: user.id, asset: 'TRC', available: '1684' } });
      await prisma.futuresBalance.create({ data: { userId: user.id, asset: 'ETH', available: '2' } });
      const original = await prisma.auditLog.create({ data: { userId: user.id, action: 'BALANCE_ADJUSTED', metadata: {
        receiptVersion: 1, account: 'SPOT', asset: 'TRC', beforeAvailable: '0', locked: '0', delta: '1684', newAvailable: '1684', performedByAdminId: actor.id,
      } } });
      return { issue: 697, intendedLedger: 'CROSS', userId: user.id, operatorId: actor.id, originalAuditId: original.id,
        originalDigest: digest(original), walletDigest: digest(await walletState(prisma, user.id)) };
    }
    const test = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
    await test('unrelated account and unrelated assets stay byte-for-byte unchanged', async () => {
      const other = await fixture(), target = await fixture();
      const before = digest(await walletState(prisma, other.userId));
      await apply(prisma, target, mutateFuturesBalance);
      assert.equal(digest(await walletState(prisma, other.userId)), before);
      assert.equal(digest(await prisma.auditLog.findUniqueOrThrow({ where: { id: other.originalAuditId } })), other.originalDigest);
    });
    await test('any order history blocks automatic correction', async () => {
      const spec = await fixture();
      await prisma.order.create({ data: { userId: spec.userId, pair: 'TRX/USDT', side: 'SELL', type: 'MARKET', originalQuantity: '1', remainingQuantity: '0', status: 'FILLED' } });
      const before = digest(await walletState(prisma, spec.userId));
      await assert.rejects(() => apply(prisma, spec, mutateFuturesBalance), /Financial history requires manual review/);
      assert.equal(digest(await walletState(prisma, spec.userId)), before);
    });
    await test('read-only preview; original receipt and wallets unchanged', async () => {
      const spec = await fixture(), before = digest(await walletState(prisma, spec.userId));
      const result = await prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return preview(tx, spec); });
      assert.equal(result.amount, '1684'); assert.equal(digest(await walletState(prisma, spec.userId)), before);
      assert.equal(await prisma.auditLog.count({ where: { id: operationKey(spec.originalAuditId) } }), 0);
    });
    await test('conserved in-place Cross correction and restart idempotency', async () => {
      const spec = await fixture(); const result = await apply(prisma, spec, mutateFuturesBalance);
      assert.equal(result.status, 'APPLIED'); assert.equal(result.receipt.metadata.newFunding, false);
      const after = await walletState(prisma, spec.userId); assert.equal(after.CROSS.find(r => r.asset === 'TRC').available, '0');
      assert.equal(after.CROSS.find(r => r.asset === 'TRX').available, '1684');
      await prisma.$disconnect(); prisma = new PrismaClient({ datasources: { db: { url: database.url } } });
      assert.equal((await apply(prisma, spec, mutateFuturesBalance)).status, 'ALREADY_APPLIED');
      assert.equal(digest(await walletState(prisma, spec.userId)), digest(after));
    });
    for (const [name, change, changeSpec] of [
      ['spent funds', async s => prisma.futuresBalance.update({ where: { userId_asset: { userId: s.userId, asset: 'TRC' } }, data: { available: '1683' } }), true],
      ['reserved funds', async s => prisma.futuresBalance.update({ where: { userId_asset: { userId: s.userId, asset: 'TRC' } }, data: { locked: '1' } }), true],
      ['existing TRX', async s => prisma.futuresBalance.create({ data: { userId: s.userId, asset: 'TRX', available: '1' } }), true],
      ['stale private snapshot', async s => prisma.futuresBalance.update({ where: { userId_asset: { userId: s.userId, asset: 'ETH' } }, data: { available: '3' } }), false],
      ['altered original receipt', async s => prisma.auditLog.update({ where: { id: s.originalAuditId }, data: { action: 'OTHER' } }), false],
      ['wrong operator', async s => { s.operatorId = s.userId; }, false],
      ['already transferred to Spot', async s => transferWalletBalance(prisma, s.userId, 'TRC', new BigNumber('1684'), 'TO_SPOT'), true],
    ]) await test('reject ' + name + ' without any mutation', async () => {
      const spec = await fixture(); await change(spec);
      if (changeSpec) spec.walletDigest = digest(await walletState(prisma, spec.userId));
      const before = digest(await walletState(prisma, spec.userId));
      await assert.rejects(() => apply(prisma, spec, mutateFuturesBalance));
      assert.equal(digest(await walletState(prisma, spec.userId)), before);
      assert.equal(await prisma.auditLog.count({ where: { id: operationKey(spec.originalAuditId) } }), 0);
    });
    await test('audit insertion failure rolls back both ticker legs', async () => {
      const spec = await fixture(), before = digest(await walletState(prisma, spec.userId));
      await database.db.query(`CREATE FUNCTION qa697_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA audit failure'; END $$;
        CREATE TRIGGER qa697_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.action = 'ASSET_CREDIT_TICKER_CORRECTED') EXECUTE FUNCTION qa697_fail_audit();`);
      try { await assert.rejects(() => apply(prisma, spec, mutateFuturesBalance), /QA audit failure/); }
      finally { await database.db.query('DROP TRIGGER qa697_fail_audit ON "AuditLog"; DROP FUNCTION qa697_fail_audit()'); }
      assert.equal(digest(await walletState(prisma, spec.userId)), before);
    });
    await test('concurrent attempts never duplicate; retry reads unique receipt', async () => {
      const spec = await fixture(); const results = await Promise.allSettled([1, 2].map(() => apply(prisma, spec, mutateFuturesBalance)));
      assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.status === 'APPLIED').length, 1);
      for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'P2034');
      assert.equal((await apply(prisma, spec, mutateFuturesBalance)).status, 'ALREADY_APPLIED');
      assert.equal(await prisma.auditLog.count({ where: { id: operationKey(spec.originalAuditId) } }), 1);
      assert.equal((await walletState(prisma, spec.userId)).CROSS.find(r => r.asset === 'TRX').available, '1684');
    });
    await test('concurrent transfer cannot duplicate or lose quantity', async () => {
      const spec = await fixture();
      await Promise.allSettled([apply(prisma, spec, mutateFuturesBalance), transferWalletBalance(prisma, spec.userId, 'TRC', new BigNumber('1684'), 'TO_SPOT')]);
      const rows = await walletState(prisma, spec.userId);
      const quantities = [...rows.SPOT, ...rows.CROSS].filter(r => ['TRC', 'TRX'].includes(r.asset));
      assert.equal(quantities.reduce((sum, row) => sum + Number(row.available), 0), 1684);
      assert.equal(quantities.filter(r => rowPositive(r)).length, 1);
    });
    report.status = 'PASS';
  } finally { if (prisma) await prisma.$disconnect(); await database.stop(); fs.writeFileSync(path.join(out, 'correction.json'), JSON.stringify(report, null, 2)); }
}
function rowPositive(row) { return Number(row.available) > 0; }
main().catch(e => { console.error(e); process.exitCode = 1; });
