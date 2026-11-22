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
import { FuturesPositionService } from '../../futures/FuturesPositionService';
import { PurchaseService } from '../PurchaseService';
import { provenanceRecord, provenanceStatus, recordProvenanceDecision } from '../syntheticProceedsFloor';
import { ConversionError, DEFAULT_CONVERSION_ASSETS, WalletConversionService, parseConversionAssets, parseConversionReserves } from '../WalletConversionService';

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
  /** An independently evidenced genuine deposit: credited, proven on-chain, and actually in the balance. */
  const genuineDeposit = async (id: string, amount: string, proof: { verified?: boolean; ignored?: boolean } = {}, asset = 'USDT') => {
    await db.deposit.create({ data: { userId: id, asset, chain: asset === 'USDT' ? 'TRC20' : asset, txHash: 'fixture-' + randomUUID(), amount, status: 'CREDITED', creditedAt: new Date(),
      verifiedAt: proof.verified === false ? null : new Date(), ignoredAt: proof.ignored ? new Date() : null } });
    await db.balance.upsert({ where: { userId_asset: { userId: id, asset } }, create: { userId: id, asset, available: amount }, update: { available: { increment: amount } } });
  };
  /** The real conversion service on this database with a fixed fake market: USDT≈1 USD, BTC 60000 USD bid/ask. */
  const conversion = () => {
    const assets = parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!;
    const book = new Map([['USD', '1'], ['USDT', '1'], ['BTC', '60000'], ['ETH', '3000']]);
    const prices = { read: async () => ({ fetchedAt: Date.now(), bid: book, ask: book }), depth: async () => '1000000000' };
    const limits = { maxUsd: new BigNumber('1000'), dailyUsd: new BigNumber('5000'), reserves: parseConversionReserves('USD:1000000,USDT:1000000,BTC:100,ETH:1000', assets)! };
    return new WalletConversionService(db, prices, Date.now, assets, limits, {});
  };
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
    // The position was built before the account was identified (a quarantined account cannot trade at all).
    await limit(seller, 'SELL', '60000');
    await limit(legacy, 'BUY', '60000');
    await identify(legacy);
    expect(await provenanceStatus(db, legacy)).toBe('UNVERIFIED');
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
    // The seller is not refused; the held bid is simply not matchable, so the sale rests unfilled.
    const sale = await limit(seller, 'SELL', '120000');
    expect(sale.trades).toHaveLength(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: resting.order.id } })).status).toBe('OPEN');
    expect(await db.trade.count({ where: { makerOrderId: resting.order.id } })).toBe(0);
  });

  test('owner review 6554472895: no Spot execution with an innocent counterparty at a FAIR price — buy, sell, market, OCO-free resting maker — state byte-identical', async () => {
    const legacy = await user('100000', '1'), innocent = await user('100000', '1'), other = await user('100000', '1');
    await identify(legacy);
    // Innocent B rests fair-price liquidity on both sides.
    await limit(innocent, 'SELL', '60000', '0.5');
    await limit(innocent, 'BUY', '59900', '0.5');
    const before = await digest([legacy, innocent]);
    const audits = await db.auditLog.count({ where: { userId: { in: [legacy, innocent] } } });
    await expect(limit(legacy, 'BUY', '60000', '0.5')).rejects.toMatchObject(HOLD);   // taker, fair price
    await expect(limit(legacy, 'SELL', '59900', '0.5')).rejects.toMatchObject(HOLD);  // taker, fair price
    await expect(market(legacy, 'BUY', '0.1')).rejects.toMatchObject(HOLD);
    await expect(market(legacy, 'SELL', '0.1')).rejects.toMatchObject(HOLD);
    await expect(limit(legacy, 'BUY', '50000', '0.1')).rejects.toMatchObject(HOLD);   // would only rest
    expect(await db.order.count({ where: { userId: legacy } })).toBe(0);
    expect(await digest([legacy, innocent])).toBe(before);
    expect(await db.auditLog.count({ where: { userId: { in: [legacy, innocent] } } })).toBe(audits);
    // B's own funds stay fully usable: it trades with someone else and withdraws.
    await limit(other, 'BUY', '60000', '0.5');
    expect(await bal(innocent, 'BTC')).toEqual(['0.5', '0']);
    await expect(withdraw(innocent, '1000')).resolves.toMatchObject({ status: 'PENDING' });
  });

  test('a held account\'s resting order is left out of the book: an innocent taker is NOT refused, never fills it, and the order can be cancelled and replayed', async () => {
    const legacy = await user('100000');
    const requestId = randomUUID();
    const resting = await service.placeOrder({ userId: legacy, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('60000'), quantity: new BigNumber('1'), requestId });
    expect(resting.order.status).toBe('OPEN');
    await identify(legacy);
    const innocent = await user('0', '1');
    const legacyBefore = await digest([legacy]);
    // The innocent seller's order is accepted: it rests, because the held bid is not matchable.
    const sold = await limit(innocent, 'SELL', '60000');
    expect(sold.order.status).toBe('OPEN');
    expect(sold.trades).toHaveLength(0);
    expect(await db.trade.count({ where: { makerOrderId: resting.order.id } })).toBe(0);
    expect(await digest([legacy])).toBe(legacyBefore);
    // Replay of the committed order by its request ID still answers; cancelling returns the hold to the same account.
    const replay = await service.placeOrder({ userId: legacy, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('60000'), quantity: new BigNumber('1'), requestId });
    expect(replay.order.id).toBe(resting.order.id);
    await service.cancelOrder(legacy, resting.order.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: resting.order.id } })).status).toBe('CANCELLED');
    expect(await bal(legacy)).toEqual(['100000', '0']);
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
    // The innocent seller's resting order then fills against an ordinary buyer.
    const buyer = await user('100000');
    await limit(buyer, 'BUY', '60000');
    expect(await bal(innocent)).toEqual(['60000', '0']);
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
    expect(Object.keys(rows[0]).sort()).toEqual(['accounts_on_hold', 'accounts_with_malformed_receipts', 'banking_referral_rewards_from_identified',
      'counterparties_paid_quote_by_identified', 'counterparties_with_withdrawals_after_contact', 'counterparty_accounts_after_first_sale',
      'deposit_reattributions_touching_identified', 'identified_accounts',
      'malformed_simulation_sale_pair_receipts', 'malformed_simulation_sale_proceeds_receipts',
      'nonzero_futures_balances_on_identified', 'open_orders_on_identified', 'open_withdrawals_on_identified',
      'sent_withdrawals_after_first_sale', 'trades_with_other_accounts_after_first_sale',
      'unattributed_simulation_sale_receipts', 'unexpected_simulation_sale_ledger_receipts']);
    expect(Number(rows[0].identified_accounts)).toBeGreaterThan(0);
    expect(await digest(made)).toBe(before);
  });

  test('owner mandatory regression: synthetic 100000, buy 1 BTC at 60000, SELL it for 120000 — principal AND the derived 60000 profit stay held', async () => {
    const legacy = await user('100000'), seller = await user('0', '1'), buyer = await user('500000');
    // The round trip happened before the account was identified (once on hold it cannot trade at all).
    await limit(seller, 'SELL', '60000');
    await limit(legacy, 'BUY', '60000');
    marks['BTC/USDT'] = '120000';
    await limit(buyer, 'BUY', '120000');
    await limit(legacy, 'SELL', '120000');
    await identify(legacy);
    expect(await bal(legacy)).toEqual(['160000', '0']);
    const before = await digest([legacy]);
    for (const amount of ['160000', '60000', '1']) await expect(withdraw(legacy, amount)).rejects.toMatchObject(HOLD);
    await expect(transfer(legacy, '1')).rejects.toMatchObject(HOLD);
    expect(await digest([legacy])).toBe(before);
  });

  test('an independently evidenced genuine 10000 USDT deposit stays withdrawable — exactly that much, and an admin can pay it out', async () => {
    const legacy = await user('100000');
    await identify(legacy);
    await genuineDeposit(legacy, '10000');
    await expect(withdraw(legacy, '10001')).rejects.toMatchObject(HOLD);
    const paid = await withdraw(legacy, '10000');
    expect(paid).toMatchObject({ status: 'PENDING' });
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: paid.id, performedByAdminId: 'fixture-admin' })).resolves.toMatchObject({ status: 'APPROVED' });
    await expect(withdrawals.markSent({ withdrawalId: paid.id, performedByAdminId: 'fixture-admin', txHash: 'NO-CHAIN' })).resolves.toMatchObject({ status: 'SENT' });
    expect(await bal(legacy)).toEqual(['100000', '0']);
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD); // the SENT 10000 used the whole evidence
  });

  test('historical COMPLETED withdrawal consumes its verified deposit budget but leaves the genuine remainder requestable', async () => {
    // Before the current SENT status existed, fulfilled withdrawals used COMPLETED.
    // The prior budget omitted those historical rows, allowing already-paid
    // verified funds to be requested again from a mixed synthetic balance.
    const legacy = await user('100000');
    await identify(legacy);
    await genuineDeposit(legacy, '10000');
    await db.withdrawal.create({ data: { userId: legacy, asset: 'USDT', network: 'FIXTURE',
      toAddress: 'HISTORICAL_PAID_ADDRESS', amount: '6000', status: 'COMPLETED',
      balanceHeld: true, txHash: 'HISTORICAL_FIXTURE_ONLY' } });
    await db.balance.update({ where: { userId_asset: { userId: legacy, asset: 'USDT' } },
      data: { available: { decrement: '6000' } } });
    expect(await bal(legacy)).toEqual(['104000', '0']);
    const before = await digest([legacy]);
    await expect(withdraw(legacy, '4000.000001')).rejects.toMatchObject(HOLD);
    expect(await digest([legacy])).toBe(before);
    const pending = await withdraw(legacy, '4000');
    expect(pending).toMatchObject({ status: 'PENDING' });
    expect(await bal(legacy)).toEqual(['100000', '4000']);
    await expect(withdraw(legacy, '0.000001')).rejects.toMatchObject(HOLD);
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: pending.id, performedByAdminId: 'fixture-admin' }))
      .resolves.toMatchObject({ status: 'APPROVED' });
    await expect(withdrawals.markSent({ withdrawalId: pending.id, performedByAdminId: 'fixture-admin', txHash: 'FIXTURE_NO_CHAIN' }))
      .resolves.toMatchObject({ status: 'SENT' });
    expect(await bal(legacy)).toEqual(['100000', '0']);
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
  });

  test('unheld historical Cross/demo requests do not consume an actual admin-credited deposit budget', async () => {
    const mixed = await user('100000');
    await identify(mixed);
    await genuineDeposit(mixed, '250');
    // Older demo/Cross withdrawal requests held no real Balance. Their status
    // must not make verified real deposits unavailable under the new provenance gate.
    await db.withdrawal.createMany({ data: [
      { userId: mixed, asset: 'USDT', network: 'FIXTURE', toAddress: 'DEMO_PENDING', amount: '100', status: 'PENDING', balanceHeld: false },
      { userId: mixed, asset: 'USDT', network: 'FIXTURE', toAddress: 'DEMO_SENT', amount: '150', status: 'SENT', balanceHeld: false },
    ] });
    const real = await withdraw(mixed, '250');
    expect(real).toMatchObject({ status: 'PENDING' });
    expect(await bal(mixed)).toEqual(['100000', '250']);
    await expect(withdraw(mixed, '1')).rejects.toMatchObject(HOLD);
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: real.id, performedByAdminId: 'fixture-admin' }))
      .resolves.toMatchObject({ status: 'APPROVED' });
    await expect(withdrawals.markSent({ withdrawalId: real.id, performedByAdminId: 'fixture-admin', txHash: 'FIXTURE_NO_CHAIN' }))
      .resolves.toMatchObject({ status: 'SENT' });
    expect(await bal(mixed)).toEqual(['100000', '0']);
  });

  test('a price-provider outage cannot block a verified BTC deposit on a mixed-history account; synthetic USDT stays held', async () => {
    const mixed = await user('100000');
    await identify(mixed);
    await genuineDeposit(mixed, '0.25', {}, 'BTC');
    const offline = { getTicker: async (_pair: string): Promise<null> => { throw new Error('Fixture provider offline'); } };
    const withdrawals = new WithdrawalService(db, offline);
    const request = await withdrawals.requestWithdrawal({
      userId: mixed, asset: 'BTC', network: 'BTC',
      toAddress: 'FIXTURE_BTC_NOT_A_REAL_ADDRESS', amount: '0.25',
    });
    expect(request).toMatchObject({ status: 'PENDING' });
    await expect(withdrawals.approveWithdrawal({ withdrawalId: request.id, performedByAdminId: 'fixture-admin' }))
      .resolves.toMatchObject({ status: 'APPROVED' });
    await expect(withdrawals.markSent({ withdrawalId: request.id, performedByAdminId: 'fixture-admin', txHash: 'FIXTURE_NO_CHAIN' }))
      .resolves.toMatchObject({ status: 'SENT' });
    expect(await bal(mixed, 'BTC')).toEqual(['0', '0']);

    // Missing independent evidence must still fail closed during the outage:
    // none of the model-created 100000 USDT may be requested.
    const unchanged = await digest([mixed]);
    await expect(withdrawals.requestWithdrawal({
      userId: mixed, asset: 'USDT', network: 'TRC20',
      toAddress: 'FIXTURE_NOT_A_REAL_ADDRESS', amount: '1',
    })).rejects.toMatchObject(HOLD);
    expect(await digest([mixed])).toBe(unchanged);
    // Even an audited release never makes an unsupported 1 USDT withdrawable
    // by valuing unpriced synthetic collateral at a fictitious market price.
    await decide(mixed, 'RELEASE_TO_FLOOR');
    const released = await digest([mixed]);
    await expect(withdrawals.requestWithdrawal({
      userId: mixed, asset: 'USDT', network: 'TRC20',
      toAddress: 'FIXTURE_NOT_A_REAL_ADDRESS', amount: '1',
    })).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
    expect(await digest([mixed])).toBe(released);
  });

  test('genuine deposit next to synthetic profit: only the deposit leaves, never the profit', async () => {
    const legacy = await user('100000'), seller = await user('0', '1'), buyer = await user('500000');
    await genuineDeposit(legacy, '10000');
    await limit(seller, 'SELL', '60000');
    await limit(legacy, 'BUY', '60000');
    marks['BTC/USDT'] = '120000';
    await limit(buyer, 'BUY', '120000');
    await limit(legacy, 'SELL', '120000');
    await identify(legacy);
    expect(await bal(legacy)).toEqual(['170000', '0']);
    await expect(withdraw(legacy, '70000')).rejects.toMatchObject(HOLD);
    await expect(withdraw(legacy, '10000')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(withdraw(legacy, '1')).rejects.toMatchObject(HOLD);
  });

  test('owner rule 2026-11-04: a genuine deposit stays requestable after the account traded (per-asset net bound); unproven, ignored and admin-credited funds are not evidence', async () => {
    const spent = await user('100000'), seller = await user('0', '1');
    await genuineDeposit(spent, '10000');
    await limit(seller, 'SELL', '60000');
    await limit(spent, 'BUY', '60000'); // 50000 USDT + 1 BTC left; the 10000 USDT deposit is still this account's own money
    await identify(spent);
    await expect(withdraw(spent, '10001')).rejects.toMatchObject(HOLD);
    await expect(withdraw(spent, '10000')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(withdraw(spent, '1')).rejects.toMatchObject(HOLD);
    await expect(withdraw(spent, '0.1', 'BTC')).rejects.toMatchObject(HOLD); // bought with synthetic USDT: no BTC evidence
    expect(await bal(spent)).toEqual(['40000', '10000']);
    for (const proof of [{ verified: false }, { ignored: true }]) {
      const id = await user('100000');
      await identify(id);
      await genuineDeposit(id, '10000', proof);
      await expect(withdraw(id, '1')).rejects.toMatchObject(HOLD);
    }
    const adjusted = await user('110000');
    await identify(adjusted);
    await db.auditLog.create({ data: { userId: adjusted, action: 'BALANCE_ADJUSTED', metadata: { asset: 'USDT', amount: '10000' } } });
    await expect(withdraw(adjusted, '1')).rejects.toMatchObject(HOLD);
  });

  test('owner rule 2026-11-04: evidenced BTC and ETH deposits on a mixed account are withdrawable in that asset and an admin can approve and pay them; the synthetic-bought BTC is not', async () => {
    const mixed = await user('100000', '1'); // 1 BTC (and 1 ETH) bought with synthetic USDT before identification
    await db.balance.create({ data: { userId: mixed, asset: 'ETH', available: '1' } });
    await identify(mixed);
    await genuineDeposit(mixed, '0.5', {}, 'BTC');
    await genuineDeposit(mixed, '2', {}, 'ETH');
    expect(await bal(mixed, 'BTC')).toEqual(['1.5', '0']);
    await expect(withdraw(mixed, '0.6', 'BTC')).rejects.toMatchObject(HOLD);
    const btc = await withdraw(mixed, '0.5', 'BTC');
    expect(btc).toMatchObject({ status: 'PENDING' });
    await expect(withdraw(mixed, '0.00000001', 'BTC')).rejects.toMatchObject(HOLD);
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: btc.id, performedByAdminId: 'fixture-admin' })).resolves.toMatchObject({ status: 'APPROVED' });
    await expect(withdrawals.markSent({ withdrawalId: btc.id, performedByAdminId: 'fixture-admin', txHash: 'NO-CHAIN' })).resolves.toMatchObject({ status: 'SENT' });
    expect(await bal(mixed, 'BTC')).toEqual(['1', '0']);
    expect(await bal(mixed, 'ETH')).toEqual(['3', '0']);
    await expect(withdraw(mixed, '2.5', 'ETH')).rejects.toMatchObject(HOLD);
    await expect(withdraw(mixed, '2', 'ETH')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(withdraw(mixed, '0.5', 'ETH')).rejects.toMatchObject(HOLD);
    await expect(withdraw(mixed, '1', 'USDT')).rejects.toMatchObject(HOLD); // no USDT evidence at all
    // After an audited release the floor still holds the synthetic principal: no USDT leaves without USDT evidence.
    await decide(mixed, 'RELEASE_TO_FLOOR');
    await expect(withdraw(mixed, '1', 'USDT')).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
    expect(await bal(mixed)).toEqual(['100000', '0']);
  });

  test('owner rule 2026-11-04: an ordinary account with demo history requests BTC, ETH and USDT withdrawals of its credited deposits; the admin approves and pays; no demo-state block', async () => {
    const ordinary = await user('0');
    await db.demoBalance.createMany({ data: [{ userId: ordinary, asset: 'USDT', available: '5000' }, { userId: ordinary, asset: 'BTC', available: '0.2' }] });
    await db.auditLog.create({ data: { userId: ordinary, action: 'WALLET_DEMO_CONVERTED', metadata: { fromAsset: 'USDT', toAsset: 'BTC', fromAmount: '100', toAmount: '0.001', ledger: 'demo' } } });
    for (const [asset, amount] of [['BTC', '0.25'], ['ETH', '3'], ['USDT', '700']] as const) await genuineDeposit(ordinary, amount, {}, asset);
    expect(await provenanceStatus(db, ordinary)).toBe('CLEAR');
    const withdrawals = new WithdrawalService(db, prices);
    for (const [asset, amount] of [['BTC', '0.25'], ['ETH', '3'], ['USDT', '700']] as const) {
      const request = await withdraw(ordinary, amount, asset);
      expect(request).toMatchObject({ status: 'PENDING' });
      await expect(withdrawals.approveWithdrawal({ withdrawalId: request.id, performedByAdminId: 'fixture-admin' })).resolves.toMatchObject({ status: 'APPROVED' });
      await expect(withdrawals.markSent({ withdrawalId: request.id, performedByAdminId: 'fixture-admin', txHash: 'NO-CHAIN' })).resolves.toMatchObject({ status: 'SENT' });
      expect(await bal(ordinary, asset)).toEqual(['0', '0']);
    }
    // Demo funds are never real: nothing of them became withdrawable.
    expect((await db.demoBalance.findMany({ where: { userId: ordinary }, orderBy: { asset: 'asc' } })).map(b => [b.asset, b.available.toFixed()])).toEqual([['BTC', '0.2'], ['USDT', '5000']]);
  });

  test('Codex counterexample 6636891345: an identified account cannot quote or confirm a conversion (USDT→BTC) in any review status; a quote taken before identification does not settle; an ordinary account still converts', async () => {
    const service = conversion();
    const legacy = await user('100');
    await identify(legacy, '100');
    const before = await digest([legacy]);
    await expect(service.quote(legacy, 'USDT', 'BTC', '10')).rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(await service.availability(legacy)).toMatchObject({ convertible: false });
    await decide(legacy, 'RELEASE_TO_FLOOR');
    await expect(service.quote(legacy, 'USDT', 'BTC', '10')).rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(await digest([legacy])).toBe(before);
    const late = await user('100');
    const quote = await service.quote(late, 'USDT', 'BTC', '10');
    await identify(late, '100');
    await expect(service.confirm(late, quote.quoteId)).rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(await bal(late)).toEqual(['100', '0']);
    expect(await bal(late, 'BTC')).toEqual(['0', '0']);
    const ordinary = await user('100');
    const q = await service.quote(ordinary, 'USDT', 'BTC', '10');
    expect(await service.confirm(ordinary, q.quoteId)).toMatchObject({ status: 'APPLIED', fee: '0' });
    expect(await bal(ordinary)).toEqual(['90', '0']);
    expect(new BigNumber((await bal(ordinary, 'BTC'))[0]).isGreaterThan(0)).toBe(true);
    expect(ConversionError).toBeDefined();
  });

  test('genuine evidence covers one withdrawal of the asset at a time; never an asset without its own evidenced deposit, nor Futures, OTC or Banking', async () => {
    const legacy = await user('100000', '1');
    await identify(legacy);
    await genuineDeposit(legacy, '10000');
    const results = await Promise.allSettled([withdraw(legacy, '10000'), withdraw(legacy, '10000')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await bal(legacy)).toEqual(['100000', '10000']);
    const other = await user('100000', '1');
    await identify(other);
    await genuineDeposit(other, '10000');
    await expect(withdraw(other, '0.1', 'BTC')).rejects.toMatchObject(HOLD);
    await expect(transfer(other, '100')).rejects.toMatchObject(HOLD);
  });

  test('preflight measures historical downstream exposure: a counterparty paid by an identified account before the hold, who then withdrew', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../scripts/synthetic-provenance-preflight.sql'), 'utf8').replace(/^--.*$/gm, '').replace(/--[^\n]*/g, '').trim().replace(/;$/, '');
    const run = () => db.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return (await tx.$queryRawUnsafe<Record<string, bigint>[]>(sql))[0]; });
    const start = await run();
    const legacy = await user('100000'), seller = await user('0', '1');
    await identify(legacy);                                  // first sale recorded
    await db.auditLog.updateMany({ where: { userId: legacy, action: 'TEAM_SPOT_SIMULATION_SOLD' }, data: { createdAt: new Date(Date.now() - 60_000) } });
    // A pre-guard trade (written directly: today's code refuses it) paid the seller 60000 synthetic USDT.
    await db.trade.create({ data: { pair: 'BTC/USDT', takerOrderId: randomUUID(), makerOrderId: randomUUID(), takerUserId: legacy, makerUserId: seller, price: '60000', quantity: '1', side: 'BUY' } });
    const former = await db.withdrawal.create({ data: { userId: seller, asset: 'USDT', network: 'FIXTURE', toAddress: 'NONE', amount: '100', status: 'SENT', balanceHeld: true } });
    const after = await run();
    const d = (k: string) => Number(after[k]) - Number(start[k]);
    expect([d('counterparty_accounts_after_first_sale'), d('counterparties_paid_quote_by_identified'), d('counterparties_with_withdrawals_after_contact')]).toEqual([1, 1, 1]);
    // Legacy COMPLETED is also a paid withdrawal, not an invisible status:
    // changing the same counterparty from SENT to COMPLETED must retain the exposure count.
    await db.withdrawal.update({ where: { id: former.id }, data: { status: 'COMPLETED' } });
    await db.withdrawal.create({ data: { userId: legacy, asset: 'USDT', network: 'FIXTURE',
      toAddress: 'HISTORICAL_COMPLETED', amount: '1', status: 'COMPLETED', balanceHeld: true } });
    const historical = await run();
    expect(Number(historical.counterparties_with_withdrawals_after_contact) - Number(start.counterparties_with_withdrawals_after_contact)).toBe(1);
    expect(Number(historical.sent_withdrawals_after_first_sale) - Number(start.sent_withdrawals_after_first_sale)).toBe(1);
    // The counterparty is NOT held automatically: that needs its own evidence and an owner decision.
    expect(await provenanceStatus(db, seller)).toBe('CLEAR');
  });

  test('read-only preflight reports unclassifiable historical receipts rather than hiding them behind zero identified accounts', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../scripts/synthetic-provenance-preflight.sql'), 'utf8')
      .replace(/^--.*$/gm, '').replace(/--[^\n]*/g, '').trim().replace(/;$/, '');
    const run = () => db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return (await tx.$queryRawUnsafe<Record<string, bigint>[]>(sql))[0];
    });
    const before = await run();
    const malformedPair = await user('0'), malformedAmount = await user('0'), unrecognizedLedger = await user('0');
    // The runtime rejects the invalid pair; without this check the original
    // SQL silently excluded it from identified_accounts altogether.
    await db.auditLog.create({ data: { userId: malformedPair, action: 'TEAM_SPOT_SIMULATION_SOLD',
      metadata: { pair: 'NOT_A_PAIR', proceeds: '100000' } } });
    await db.auditLog.create({ data: { userId: malformedAmount, action: 'TEAM_SPOT_SIMULATION_SOLD',
      metadata: { pair: 'QVTR/USDT', proceeds: 'not-a-number' } } });
    await db.auditLog.create({ data: { userId: unrecognizedLedger, action: 'TEAM_SPOT_SIMULATION_SOLD',
      metadata: { pair: 'QVTR/USDT', proceeds: '1', settlementLedger: 'UNKNOWN' } } });
    await db.auditLog.create({ data: { userId: null, action: 'TEAM_SPOT_SIMULATION_SOLD',
      metadata: { pair: 'QVTR/USDT', proceeds: '5' } } });
    const after = await run();
    const increase = (field: string) => Number(after[field]) - Number(before[field]);
    expect(increase('unattributed_simulation_sale_receipts')).toBe(1);
    expect(increase('malformed_simulation_sale_pair_receipts')).toBe(1);
    expect(increase('malformed_simulation_sale_proceeds_receipts')).toBe(1);
    expect(increase('unexpected_simulation_sale_ledger_receipts')).toBe(1);
    expect(increase('identified_accounts')).toBe(2); // malformed pair and NULL user are not classified
    expect(increase('accounts_with_malformed_receipts')).toBe(1);
    // Production query is aggregate-only; never include individual IDs or amounts in the report.
    expect(Object.keys(after)).not.toContain('userId');
    expect(Object.keys(after)).not.toContain('amount');
  });

  test('review findings: ADMIN house MARKET SELL, Futures orders and product purchases are refused for a held account; nothing moves', async () => {
    const admin = await user('100000', '1');
    await db.user.update({ where: { id: admin }, data: { role: 'ADMIN' } });
    await identify(admin);
    const before = await digest([admin]);
    await expect(market(admin, 'SELL', '0.5')).rejects.toMatchObject(HOLD);       // the house-sale shortcut
    const futures = new FuturesPositionService(db, new MatchingEngine(), { getMarkPrice: () => { throw new Error('mark must not be read'); } } as any);
    await expect(futures.placeOrder({ userId: admin, symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('60000'), quantity: new BigNumber('0.01'), leverage: 2, marginType: 'ISOLATED' } as any)).rejects.toMatchObject(HOLD);
    const product = await db.product.create({ data: { name: 'fixture', description: 'fixture', priceAmount: '100', priceAsset: 'USDT' } });
    await expect(new PurchaseService(db).purchaseProduct(admin, product.id)).rejects.toThrow(/provenance review/);
    expect(await digest([admin])).toBe(before);
    expect(await db.purchase.count({ where: { userId: admin } })).toBe(0);
    // An ordinary account still purchases normally.
    const ordinary = await user('1000');
    await expect(new PurchaseService(db).purchaseProduct(ordinary, product.id)).resolves.toBeTruthy();
  });

  test('review finding: Banking principal is refused for an identified account even after release (its SERIALIZABLE snapshot predates the floor lock)', async () => {
    const legacy = await user('200000');
    await identify(legacy);
    await decide(legacy, 'RELEASE_TO_FLOOR');
    const banking = new BankingService(db, { prices: async () => ({ USDT: '1', USDC: '1', BTC: '60000', ETH: '3000' }) } as any);
    await expect(banking.createPlacement(legacy, { programId: 'MONTHLY_17_24M', asset: 'USDT', amount: '20000', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
    expect(await bal(legacy)).toEqual(['200000', '0']);
  });
});
