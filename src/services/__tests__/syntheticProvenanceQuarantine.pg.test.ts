/**
 * #630 owner decision 2026-11-01: TEMPORARY PROVENANCE QUARANTINE, NOT CONFISCATION.
 * An account identified by immutable simulation-sale receipts is on hold until an audited admin decision:
 * no value leaves it by any covered path, no Spot order or fill may move value out of it, ordinary accounts are
 * untouched, and nothing is ever debited, relabelled or deleted. Real services, disposable loopback PostgreSQL,
 * synthetic users only.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import BigNumber from 'bignumber.js';
import { OrderService } from '../OrderService';
import { WithdrawalService } from '../WithdrawalService';
import { transferWalletBalance } from '../WalletTransferService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { OtcCashService } from '../../otc/OtcCashService';
import { BankingService } from '../../banking/service';
import { provenanceRecord, provenanceStatus, recordProvenanceDecision } from '../syntheticProceedsFloor';

const url = process.env.VOLTEX_NRX_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_nrx_test') throw Error('Disposable loopback voltex_nrx_test required');
}
const pg = url ? describe : describe.skip;
const HOLD = { code: 'SYNTHETIC_PROCEEDS_LOCKED', message: expect.stringMatching(/provenance review/) };
const marks: Record<string, string> = { 'BTC/USDT': '60000', 'ETH/USDT': '3000', 'USDC/USDT': '1' };
const prices = { getTicker: async (pair: string) => marks[pair] ? { lastPrice: marks[pair] } : null };

pg('provenance quarantine of identified legacy synthetic accounts (#630 owner decision)', () => {
  let db: PrismaClient, service: OrderService;
  const made: string[] = [];
  const user = async (usdt: string, btc = '0') => {
    const id = randomUUID(); made.push(id);
    await db.user.create({ data: { id, email: `${id}@quarantine.invalid`, passwordHash: 'fixture', referralCode: id, role: 'USER', kycStatus: 'APPROVED' } });
    await db.balance.createMany({ data: [{ userId: id, asset: 'USDT', available: usdt }, { userId: id, asset: 'BTC', available: btc }] });
    return id;
  };
  const identify = (id: string, proceeds = '100000') => db.auditLog.create({ data: { userId: id, action: 'TEAM_SPOT_SIMULATION_SOLD', metadata: { pair: 'QVTR/USDT', proceeds, counterparty: 'simulation:QVTR' } } });
  const decide = (userId: string, decision: 'QUARANTINE' | 'RELEASE_TO_FLOOR', requestId = 'req-' + randomUUID()) =>
    recordProvenanceDecision(db, { userId, adminId: 'fixture-admin', decision, reason: 'fixture review: provenance adjudication', requestId });
  const bal = async (id: string, asset = 'USDT') => {
    const b = await db.balance.findUnique({ where: { userId_asset: { userId: id, asset } } });
    return b ? [b.available.toFixed(), b.locked.toFixed()] : ['0', '0'];
  };
  const withdraw = (id: string, amount: string, asset = 'USDT') => new WithdrawalService(db, prices).requestWithdrawal({ userId: id, asset, network: 'FIXTURE', toAddress: 'NO_REAL_ADDRESS', amount });
  const limit = (id: string, side: 'BUY' | 'SELL', price: string, quantity = '1') =>
    service.placeOrder({ userId: id, pair: 'BTC/USDT', side, type: 'LIMIT', price: new BigNumber(price), quantity: new BigNumber(quantity) });
  const market = (id: string, side: 'BUY' | 'SELL', quantity = '1') =>
    service.placeOrder({ userId: id, pair: 'BTC/USDT', side, type: 'MARKET', quantity: new BigNumber(quantity) });
  const transfer = (id: string, amount: string) => transferWalletBalance(db, id, 'USDT', new BigNumber(amount), 'TO_FUTURES', prices);
  /** Every financial row of the given accounts, to prove a refusal or a decision moved nothing. */
  const digest = async (ids: string[]) => JSON.stringify({
    b: await db.balance.findMany({ where: { userId: { in: ids } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }], select: { userId: true, asset: true, available: true, locked: true } }),
    w: await db.withdrawal.findMany({ where: { userId: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, status: true, amount: true } }),
    o: await db.order.count({ where: { userId: { in: ids } } }),
    t: await db.trade.count({ where: { OR: [{ takerUserId: { in: ids } }, { makerUserId: { in: ids } }] } }),
    f: await db.futuresBalance.findMany({ where: { userId: { in: ids } }, select: { asset: true, available: true } }),
  });

  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url } } });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('External network forbidden in financial fixtures'));
  });
  beforeEach(async () => {
    service = new OrderService(db, new MatchingEngine(), prices); marks['BTC/USDT'] = '60000';
    // The disposable database is shared by several suites: start each case from an empty BTC/USDT book.
    await db.order.updateMany({ where: { pair: 'BTC/USDT', status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } }, data: { status: 'CANCELLED' } });
  });
  afterEach(async () => {
    await db.order.updateMany({ where: { userId: { in: made }, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } }, data: { status: 'CANCELLED' } });
  });
  afterAll(async () => { await db.$disconnect(); jest.restoreAllMocks(); });

  test('owner counterexample: 100000 synthetic USDT, buy 1 BTC at 60000, mark doubles — withdrawal of 40000 (and of 1) is still REFUSED', async () => {
    const legacy = await user('100000'), seller = await user('0', '1');
    await identify(legacy);
    expect(await provenanceStatus(db, legacy)).toBe('UNVERIFIED');
    await limit(seller, 'SELL', '60000');
    await limit(legacy, 'BUY', '60000'); // value-neutral at the mark: allowed, nothing leaves
    expect(await bal(legacy)).toEqual(['40000', '0']);
    expect(await bal(legacy, 'BTC')).toEqual(['1', '0']);
    for (const mark of ['120000', '30000', '60000']) {
      marks['BTC/USDT'] = mark;
      const before = await digest([legacy]);
      await expect(withdraw(legacy, '40000')).rejects.toMatchObject(HOLD);
      await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
      await expect(withdraw(legacy, '1', 'BTC')).rejects.toMatchObject(HOLD);
      expect(await digest([legacy])).toBe(before);
    }
  });

  test('every covered cross-ledger path is refused: Spot→Futures, OTC reserve, Banking principal', async () => {
    const legacy = await user('110000');
    await identify(legacy);
    const sessionId = (await db.session.create({ data: { userId: legacy } })).id;
    const otc = new OtcCashService(db, prices as any, { version: 'isolated-fixture', enabled: true, approvedUserIds: [legacy], maxActive: 3,
      routes: [{ country: 'RU', cityId: 'geonames-524901', asset: 'USDT', fiat: 'USD', cashPrecision: 2 }] } as any);
    const banking = new BankingService(db, { prices: async () => ({ USDT: '1', USDC: '1', BTC: '60000', ETH: '3000' }) } as any);
    const before = await digest([legacy]);
    await expect(transfer(legacy, '1')).rejects.toMatchObject(HOLD);
    await expect(otc.create({ userId: legacy, sessionId }, { country: 'RU', cityId: 'geonames-524901', asset: 'USDT', fiat: 'USD', tier: 'otc-convert', quantity: '20000', idempotencyKey: randomUUID() } as any)).rejects.toMatchObject(HOLD);
    await expect(banking.createPlacement(legacy, { programId: 'MONTHLY_17_24M', asset: 'USDT', amount: '20000', idempotencyKey: randomUUID() })).rejects.toMatchObject(HOLD);
    expect(await digest([legacy])).toBe(before);
    expect(await db.otcCashRequest.count({ where: { userId: legacy } })).toBe(0);
  });

  test('laundering through the book is refused: overpaying an accomplice (limit and market), and an old adverse resting order', async () => {
    const legacy = await user('100000'), accomplice = await user('0', '2');
    await identify(legacy);
    await limit(accomplice, 'SELL', '120000');
    const before = await digest([legacy, accomplice]);
    await expect(limit(legacy, 'BUY', '120000', '0.5')).rejects.toMatchObject(HOLD);
    await expect(market(legacy, 'BUY', '0.5')).rejects.toMatchObject(HOLD);
    expect(await digest([legacy, accomplice])).toBe(before);
    // An order resting from before the receipt was recorded: an innocent-looking taker cannot fill it.
    await db.order.updateMany({ where: { pair: 'BTC/USDT', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } }, data: { status: 'CANCELLED' } });
    const old = await user('150000');
    const resting = await limit(old, 'BUY', '120000');
    expect(resting.order.status).toBe('OPEN');
    await identify(old);
    const seller = await user('0', '1');
    await expect(limit(seller, 'SELL', '120000')).rejects.toMatchObject(HOLD);
    expect((await db.order.findUniqueOrThrow({ where: { id: resting.order.id } })).status).toBe('OPEN');
    expect(await db.trade.count({ where: { makerOrderId: resting.order.id } })).toBe(0);
  });

  test('value-neutral or value-raising trades and partial fills stay possible; nothing leaves', async () => {
    const legacy = await user('0', '2'), buyer = await user('300000');
    await identify(legacy);
    await limit(legacy, 'SELL', '70000', '2'); // above the mark: cannot lower the account's value
    await limit(buyer, 'BUY', '70000', '1');   // partial fill
    expect(await bal(legacy)).toEqual(['70000', '0']);
    expect(await bal(legacy, 'BTC')).toEqual(['0', '1']);
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
  });

  test('a withdrawal filed before identification cannot be approved or sent; it can still be rejected, funds returned', async () => {
    const legacy = await user('50000');
    const filed = await withdraw(legacy, '10000');
    await identify(legacy);
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: filed.id, performedByAdminId: 'fixture-admin' })).rejects.toMatchObject(HOLD);
    await db.withdrawal.update({ where: { id: filed.id }, data: { status: 'APPROVED' } }); // as if approved before the fix
    await expect(withdrawals.markSent({ withdrawalId: filed.id, performedByAdminId: 'fixture-admin', txHash: 'NO-CHAIN' })).rejects.toMatchObject(HOLD);
    await expect(withdrawals.rejectWithdrawal({ withdrawalId: filed.id, performedByAdminId: 'fixture-admin' })).resolves.toMatchObject({ status: 'REJECTED' });
    expect(await bal(legacy)).toEqual(['50000', '0']);
  });

  test('genuine excess: commingled while on hold; after an audited release only realized cash above S leaves; reversible', async () => {
    const legacy = await user('130000'); // 100000 synthetic + 30000 genuine
    await identify(legacy);
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
    const before = await digest([legacy]);
    expect(await decide(legacy, 'RELEASE_TO_FLOOR')).toMatchObject({ status: 'RELEASED_TO_FLOOR', replayed: false });
    expect(await digest([legacy])).toBe(before); // a decision moves no money
    await expect(withdraw(legacy, '30001')).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
    await expect(withdraw(legacy, '20000')).resolves.toMatchObject({ status: 'PENDING' });
    await decide(legacy, 'QUARANTINE');
    expect(await provenanceStatus(db, legacy)).toBe('UNVERIFIED');
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
    const record = await provenanceRecord(db, legacy);
    expect(record.decisions.map(d => [d.seq, d.decision])).toEqual([[1, 'RELEASE_TO_FLOOR'], [2, 'QUARANTINE']]);
  });

  test('released account: two concurrent withdrawals share one excess budget', async () => {
    const legacy = await user('108000');
    await identify(legacy);
    await decide(legacy, 'RELEASE_TO_FLOOR');
    const results = await Promise.allSettled([withdraw(legacy, '6000'), withdraw(legacy, '6000')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await bal(legacy)).toEqual(['102000', '6000']);
  });

  test('many accounts at once: every identified one refused, the innocent one unaffected', async () => {
    const held = await Promise.all([user('100000'), user('100000'), user('100000')]);
    for (const id of held) await identify(id);
    const innocent = await user('5000');
    const results = await Promise.allSettled([...held.map(id => withdraw(id, '100')), withdraw(innocent, '100')]);
    expect(results.slice(0, 3).every(r => r.status === 'rejected' && (r.reason as { code?: string }).code === 'SYNTHETIC_PROCEEDS_LOCKED')).toBe(true);
    expect(results[3].status).toBe('fulfilled');
    expect(await provenanceStatus(db, innocent)).toBe('CLEAR');
    await expect(decide(innocent, 'RELEASE_TO_FLOOR')).rejects.toMatchObject({ code: 'NOT_IDENTIFIED' });
    // An ordinary account's historical admin credit is not a receipt: never held by default.
    await db.auditLog.create({ data: { userId: innocent, action: 'BALANCE_ADJUSTED', metadata: { asset: 'USDT', amount: '1000' } } });
    expect(await provenanceStatus(db, innocent)).toBe('CLEAR');
  });

  test('malformed receipts and unreadable decisions fail closed; missing prices refuse Spot', async () => {
    const legacy = await user('100000');
    await db.auditLog.create({ data: { userId: legacy, action: 'TEAM_SPOT_SIMULATION_SOLD', metadata: { pair: 'QVTR/USDT', proceeds: 'NaN' } } });
    await expect(withdraw(legacy, '1')).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
    const other = await user('100000');
    await identify(other);
    await decide(other, 'RELEASE_TO_FLOOR');
    await db.auditLog.create({ data: { userId: other, action: 'SYNTHETIC_PROVENANCE_DECISION', metadata: { seq: 'forged', decision: 'RELEASE_TO_FLOOR' } } });
    expect(await provenanceStatus(db, other)).toBe('UNVERIFIED');
    const priced = await user('100000');
    await identify(priced);
    const blind = new OrderService(db, new MatchingEngine(), { getTicker: async () => null });
    await expect(blind.placeOrder({ userId: priced, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('1'), quantity: new BigNumber('1') })).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
  });

  test('decisions are idempotent by requestId, a reused requestId cannot change the outcome, and reasons are required', async () => {
    const legacy = await user('100000');
    await identify(legacy);
    const requestId = 'same-' + randomUUID();
    const [a, b] = await Promise.all([decide(legacy, 'RELEASE_TO_FLOOR', requestId), decide(legacy, 'RELEASE_TO_FLOOR', requestId)]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    await expect(decide(legacy, 'QUARANTINE', requestId)).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
    await expect(recordProvenanceDecision(db, { userId: legacy, adminId: 'a', decision: 'QUARANTINE', reason: 'short', requestId: 'r-' + randomUUID() })).rejects.toMatchObject({ code: 'INVALID_DECISION' });
    expect(await db.auditLog.count({ where: { userId: legacy, action: 'SYNTHETIC_PROVENANCE_DECISION' } })).toBe(1);
  });

  test('the operator preflight is read-only and reports aggregates only', async () => {
    const before = await digest(made);
    const sql = fs.readFileSync(path.join(__dirname, '../../../scripts/synthetic-provenance-preflight.sql'), 'utf8').replace(/^--.*$/gm, '').trim().replace(/;$/, '');
    const rows = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe<Record<string, bigint>[]>(sql);
    });
    expect(Object.keys(rows[0]).sort()).toEqual(['accounts_on_hold', 'accounts_with_malformed_receipts', 'identified_accounts', 'nonzero_futures_balances_on_identified',
      'open_orders_on_identified', 'open_withdrawals_on_identified', 'sent_withdrawals_after_first_sale', 'trades_with_other_accounts_after_first_sale']);
    expect(Number(rows[0].identified_accounts)).toBeGreaterThan(0);
    expect(await digest(made)).toBe(before);
  });
});
