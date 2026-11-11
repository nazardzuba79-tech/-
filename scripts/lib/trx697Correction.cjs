// One-time, owner-authorized correction of a proven TRC typo. Not an API,
// deposit importer or funding source. The sum comes ONLY from the old receipt.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const BigNumber = require('bignumber.js');
const ACTION = 'ASSET_CREDIT_TICKER_CORRECTED';
const canonical = value => value && typeof value.toJSON === 'function' ? canonical(value.toJSON())
  : Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const operationKey = originalId => `issue697:trx-ticker:${originalId}`;
async function walletState(tx, userId) {
  const out = {};
  for (const [name, delegate] of [['SPOT', 'balance'], ['DEMO', 'demoBalance'], ['CROSS', 'futuresBalance']]) {
    out[name] = (await tx[delegate].findMany({ where: { userId }, orderBy: { asset: 'asc' } })).map(row => ({
      id: row.id, asset: row.asset, available: row.available.toString(), locked: row.locked.toString(), updatedAt: row.updatedAt.toISOString(),
    }));
  }
  return out;
}
const rowOf = (state, ledger, asset) => state[ledger].find(r => r.asset === asset);
const available = (state, ledger, asset) => new BigNumber(rowOf(state, ledger, asset)?.available || '0');
const locked = (state, ledger, asset) => new BigNumber(rowOf(state, ledger, asset)?.locked || '0');
async function noUse(tx, userId) {
  for (const table of ['order', 'demoOrder', 'futuresOrder', 'futuresPosition', 'cfdPosition', 'fundingPayment', 'withdrawal', 'depositBatch', 'purchase']) {
    assert.equal(await tx[table].count({ where: { userId } }), 0, `Financial history requires manual review: ${table}`);
  }
  for (const table of ['trade', 'demoTrade']) assert.equal(await tx[table].count({ where: { OR: [{ takerUserId: userId }, { makerUserId: userId }] } }), 0, 'Executed trades require manual review');
}
async function preview(tx, spec) {
  assert.equal(spec.issue, 697); assert.equal(spec.intendedLedger, 'CROSS');
  const original = await tx.auditLog.findUniqueOrThrow({ where: { id: spec.originalAuditId } });
  assert.equal(digest(original), spec.originalDigest, 'Original receipt changed');
  assert.equal(original.userId, spec.userId); assert.equal(original.action, 'BALANCE_ADJUSTED');
  const meta = original.metadata;
  assert.equal(meta.receiptVersion, 1); assert.equal(meta.account, 'SPOT'); assert.equal(meta.asset, 'TRC');
  assert.equal(meta.performedByAdminId, spec.operatorId); assert.equal(String(meta.beforeAvailable), '0'); assert.equal(String(meta.locked), '0');
  const amount = new BigNumber(meta.delta); assert.ok(amount.isFinite() && amount.gt(0)); assert.ok(amount.eq(meta.newAvailable));
  const actor = await tx.user.findUniqueOrThrow({ where: { id: spec.operatorId }, select: { role: true } }); assert.equal(actor.role, 'ADMIN');
  await tx.user.findUniqueOrThrow({ where: { id: spec.userId }, select: { id: true } });
  const state = await walletState(tx, spec.userId); assert.equal(digest(state), spec.walletDigest, 'Wallet changed since private review');
  for (const ledger of ['SPOT', 'DEMO', 'CROSS']) for (const asset of ['TRC', 'TRX']) {
    assert.ok(locked(state, ledger, asset).isZero(), 'Reserved funds prohibit correction');
    assert.ok(available(state, ledger, asset).eq(ledger === 'CROSS' && asset === 'TRC' ? amount : 0), 'Funds were already moved, spent or credited');
  }
  await noUse(tx, spec.userId);
  return { original, amount: amount.toFixed(), state, operationKey: operationKey(original.id) };
}
async function apply(prisma, spec, mutateFuturesBalance) {
  return prisma.$transaction(async tx => {
    // Same account-wide lock as the existing Spot/Cross transfer service.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-transfer:${spec.userId}`}, 0))::text`;
    const key = operationKey(spec.originalAuditId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const prior = await tx.auditLog.findUnique({ where: { id: key } });
    if (prior) {
      assert.equal(prior.action, ACTION); assert.equal(prior.userId, spec.userId);
      assert.equal(prior.metadata.originalAuditId, spec.originalAuditId); assert.equal(prior.metadata.performedByAdminId, spec.operatorId);
      return { status: 'ALREADY_APPLIED', receipt: prior };
    }
    await tx.$queryRaw`SELECT id FROM "Balance" WHERE "userId" = ${spec.userId} ORDER BY asset FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "DemoBalance" WHERE "userId" = ${spec.userId} ORDER BY asset FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FuturesBalance" WHERE "userId" = ${spec.userId} ORDER BY asset FOR UPDATE`;
    const checked = await preview(tx, spec); const quantity = new BigNumber(checked.amount);
    // A conditional debit MUST succeed before the identical native-asset credit.
    await mutateFuturesBalance(tx, spec.userId, 'TRC', { available: quantity.negated() }, true);
    await mutateFuturesBalance(tx, spec.userId, 'TRX', { available: quantity });
    const after = await walletState(tx, spec.userId);
    assert.ok(available(after, 'CROSS', 'TRC').isZero()); assert.ok(available(after, 'CROSS', 'TRX').eq(quantity));
    assert.equal(digest(after.SPOT), digest(checked.state.SPOT)); assert.equal(digest(after.DEMO), digest(checked.state.DEMO));
    const other = state => state.CROSS.filter(r => !['TRC', 'TRX'].includes(r.asset));
    assert.equal(digest(other(after)), digest(other(checked.state)));
    assert.equal(digest(await tx.auditLog.findUniqueOrThrow({ where: { id: spec.originalAuditId } })), spec.originalDigest);
    const receipt = await tx.auditLog.create({ data: { id: key, userId: spec.userId, action: ACTION, metadata: {
      receiptVersion: 1, issue: 697, originalAuditId: checked.original.id, originalCreditAt: checked.original.createdAt.toISOString(),
      performedByAdminId: spec.operatorId, fromAsset: 'TRC', toAsset: 'TRX', account: 'CROSS', amount: checked.amount,
      before: checked.state, after, conservedQuantity: checked.amount, newFunding: false,
      reason: 'Owner-confirmed native TRX deposit was entered as TRC; reclassify only the intact existing Cross balance. No Spot compensation.',
    } } });
    return { status: 'APPLIED', receipt };
  }, { isolationLevel: 'Serializable', timeout: 20000 });
}
module.exports = { preview, apply, digest, walletState, operationKey };
