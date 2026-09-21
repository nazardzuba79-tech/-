/** Explicitly opted-in, real transactions on a disposable loopback TEST PostgreSQL. */
import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { REFERRAL_REWARD_PERCENT } from '../../config/limits';
import { BANKING_REFERRAL_REWARD_PERCENT } from '../config';
import { BankingService } from '../service';

const enabled = process.env.BANKING_DB_TESTS === '1';
if (enabled) {
  require('dotenv').config();
  const hostname = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1'].includes(hostname)) throw new Error('Banking DB tests run only against a disposable loopback TEST database');
}
const dbDescribe = enabled ? describe : describe.skip;

const prisma = new PrismaClient();
/** Settlement needs no prices; the stub keeps the suite off the network entirely. */
const service = new BankingService(prisma, { prices: async () => ({ USDT: '1', BTC: '100000' }) } as any);

const months = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d; };
const plus = (from: Date, n: number) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + n); return d; };

async function user(referredBy?: string) {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `${id}@banking.test`, passwordHash: 'x',
    referralCode: id.replace(/-/g, '').slice(0, 8).toUpperCase(), referredById: referredBy ?? null } });
  return id;
}

async function placement(userId: string, opts: { principal: string; rate: string; asset?: string;
  compound?: boolean; term?: number; openedMonthsAgo: number }) {
  const id = randomUUID(), opened = months(opts.openedMonthsAgo);
  const compound = opts.compound ?? false, term = opts.term ?? 12, asset = opts.asset ?? 'USDT';
  await prisma.$executeRawUnsafe(
    `INSERT INTO banking_placements(id,user_id,program_id,asset,principal,monthly_rate,term_months,compound,payout_frequency,lock_rule,opened_at,matures_at)
     VALUES($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8,$9,$10,$11,$12)`,
    id, userId, compound ? 'COMPOUND_21_12M' : 'MONTHLY_17_24M', asset, opts.principal, opts.rate, term, compound,
    compound ? 'MATURITY' : 'MONTHLY', compound ? 'PRINCIPAL_AND_REWARDS_LOCKED_TO_MATURITY' : 'PRINCIPAL_RETURN_UNDEFINED',
    opened, plus(opened, term));
  return id;
}

const balance = async (userId: string, asset = 'USDT') =>
  (await prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } }))?.available.toString() ?? '0';

dbDescribe('Banking referral commission', () => {
  afterAll(async () => { await prisma.$disconnect(); });

  // A.
  test('a referral with no referrer produces no commission at all', async () => {
    const solo = await user();
    const id = await placement(solo, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    const result = await service.settlePlacement(solo, id);
    expect(result.settledCount).toBe(1);
    expect(result.settled[0].amount).toBe('120');
    expect(result.settled[0].commission).toBeNull();
    expect(await prisma.bankingReferralReward.count({ where: { placementId: id } })).toBe(0);
    expect(await balance(solo)).toBe('120');
  });

  // B + G + H.
  test('120 USDT of profit pays the referrer 24 USDT, same asset, without touching the referral', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    const result = await service.settlePlacement(referred, id);

    expect(result.settled[0].amount).toBe('120');
    expect(result.settled[0].commission).toBe('24');
    // H — the referred user keeps the WHOLE 120. Nothing is deducted.
    expect(await balance(referred)).toBe('120');
    // B + G — the referrer is paid separately, in the same asset.
    expect(await balance(referrer)).toBe('24');

    const row = await prisma.bankingReferralReward.findFirstOrThrow({ where: { placementId: id } });
    expect(row.asset).toBe('USDT');
    expect(row.amount.toString()).toBe('24');
    expect(row.sourceProfitAmount.toString()).toBe('120');
    expect(new BigNumber(row.commissionRate.toString()).toString()).toBe('0.2');
  });

  // C — the failure mode this whole feature is defined against.
  test('the commission base is profit, never principal', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    await service.settlePlacement(referred, id);
    const row = await prisma.bankingReferralReward.findFirstOrThrow({ where: { placementId: id } });
    expect(row.sourceProfitAmount.toString()).toBe('120');
    expect(row.amount.toString()).not.toBe('200');  // 20% of the 1000 principal
    expect(row.amount.toString()).toBe('24');
  });

  // D.
  test('settling the same placement again pays nothing more', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    await service.settlePlacement(referred, id);
    const second = await service.settlePlacement(referred, id);
    expect(second.settledCount).toBe(0);
    expect(await balance(referred)).toBe('120');
    expect(await balance(referrer)).toBe('24');
    expect(await prisma.bankingReferralReward.count({ where: { placementId: id } })).toBe(1);
  });

  // E — two requests racing on the same placement.
  test('concurrent settlement credits exactly once', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    // Serializable may abort one of the pair; a rejection is an acceptable
    // outcome, a double credit is not. Assert on the money, not the promise.
    await Promise.allSettled([service.settlePlacement(referred, id), service.settlePlacement(referred, id)]);
    expect(await prisma.bankingReferralReward.count({ where: { placementId: id } })).toBe(1);
    expect(await balance(referred)).toBe('120');
    expect(await balance(referrer)).toBe('24');
  });

  // F.
  test('each completed month is its own reward and funds exactly one commission', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 3 });
    const result = await service.settlePlacement(referred, id);
    expect(result.settledCount).toBe(3);
    expect(result.settled.map(r => r.amount)).toEqual(['120', '120', '120']);
    expect(await balance(referred)).toBe('360');
    expect(await balance(referrer)).toBe('72');
    const rows = await prisma.bankingReferralReward.findMany({ where: { placementId: id } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(r => r.bankingRewardLedgerEntryId)).size).toBe(3);
  });

  // §10 — compound profit is not payable, so no commission, until maturity.
  test('a compound placement pays the referrer nothing before maturity', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.17', compound: true, term: 24, openedMonthsAgo: 6 });
    const result = await service.settlePlacement(referred, id);
    expect(result.settledCount).toBe(0);
    expect(await balance(referrer)).toBe('0');
  });

  test('a matured compound placement settles its whole profit once, and pays 20% of it', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.17', compound: true, term: 24, openedMonthsAgo: 25 });
    const result = await service.settlePlacement(referred, id);
    expect(result.settledCount).toBe(1);
    // Quantised to the ledger's own 18 places, rounded DOWN: what is paid is
    // exactly what the column can hold, and never a hair more than was earned.
    const profit = new BigNumber('1000').times(new BigNumber('1.17').pow(24)).minus('1000')
      .decimalPlaces(18, BigNumber.ROUND_DOWN);
    expect(result.settled[0].amount).toBe(profit.toFixed());
    expect(result.settled[0].commission).toBe(profit.times('0.2').decimalPlaces(18, BigNumber.ROUND_DOWN).toFixed());
    // And the stored ledger row equals the returned figure, to the digit.
    const led = await prisma.$queryRawUnsafe<{ amount: string }[]>(
      `SELECT amount::text FROM banking_ledger_entries WHERE placement_id=$1 AND entry_type='REWARD_PAID'`, id);
    expect(new BigNumber(led[0].amount).toFixed()).toBe(profit.toFixed());
    expect(await prisma.bankingReferralReward.count({ where: { placementId: id } })).toBe(1);
  });

  // §13 — a BTC placement pays a BTC commission, with no USD conversion.
  test('the commission is paid in the asset the profit was earned in', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '0.1', rate: '0.1', asset: 'BTC', openedMonthsAgo: 1 });
    const result = await service.settlePlacement(referred, id);
    expect(result.settled[0].amount).toBe('0.01');
    expect(result.settled[0].commission).toBe('0.002');
    expect(await balance(referrer, 'BTC')).toBe('0.002');
    expect(await balance(referrer, 'USDT')).toBe('0');
  });

  // §6 — an old placement settles at ITS rate, not today's.
  test('a placement opened at the old 17% settles 170, not 120', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.17', openedMonthsAgo: 1 });
    const result = await service.settlePlacement(referred, id);
    expect(result.settled[0].amount).toBe('170');
    expect(result.settled[0].commission).toBe('34');
  });

  // I + J — the read paths move no money.
  test('calculate() and state() pay nobody', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 2 });

    await service.calculate({ programId: 'MONTHLY_17_24M', asset: 'USDT', amount: '1000',
      startDate: new Date().toISOString().slice(0, 10), periodMonths: 6 });
    for (let i = 0; i < 3; i += 1) await service.state(referred);

    expect(await balance(referred)).toBe('0');
    expect(await balance(referrer)).toBe('0');
    expect(await prisma.bankingReferralReward.count({ where: { placementId: id } })).toBe(0);
    // state() DOES accrue — that is its job — but accrual is not payment.
    const accrued = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM banking_ledger_entries WHERE placement_id=$1 AND entry_type='REWARD_ACCRUED'`, id);
    expect(Number(accrued[0].n)).toBe(2);
    const paid = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM banking_ledger_entries WHERE placement_id=$1 AND entry_type='REWARD_PAID'`, id);
    expect(Number(paid[0].n)).toBe(0);
  });

  // K + L.
  test('the deposit programme and the Banking programme stay separate', async () => {
    expect(REFERRAL_REWARD_PERCENT).toBe(5);
    expect(BANKING_REFERRAL_REWARD_PERCENT).toBe(20);
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    await service.settlePlacement(referred, id);
    // Settling Banking profit must not write into the deposit referral table.
    expect(await prisma.referralReward.count({ where: { referrerId: referrer } })).toBe(0);
    expect(await prisma.bankingReferralReward.count({ where: { referrerId: referrer } })).toBe(1);
    const summary = await service.referralSummary(referrer);
    expect(summary.referralPercent).toBe(20);
    expect(summary.referredCount).toBe(1);
    expect(summary.rewardsByAsset).toEqual([{ asset: 'USDT', amount: '24' }]);
  });

  // §18.
  test('every credit leaves an audit trail that recomputes', async () => {
    const referrer = await user(), referred = await user(referrer);
    const id = await placement(referred, { principal: '1000', rate: '0.12', openedMonthsAgo: 1 });
    await service.settlePlacement(referred, id);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { userId: referrer, action: 'BANKING_REFERRAL_REWARD_CREDITED' } });
    const meta = log.metadata as Record<string, unknown>;
    expect(meta.referredUserId).toBe(referred);
    expect(meta.placementId).toBe(id);
    expect(meta.asset).toBe('USDT');
    expect(meta.sourceProfitAmount).toBe('120');
    expect(meta.rate).toBe(20);
    expect(meta.rewardAmount).toBe('24');
    expect(new BigNumber(String(meta.sourceProfitAmount)).times(Number(meta.rate)).div(100).toFixed())
      .toBe(String(meta.rewardAmount));
  });
});
