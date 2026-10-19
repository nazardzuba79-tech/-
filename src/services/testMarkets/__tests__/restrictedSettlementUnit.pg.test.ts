/**
 * Feasibility spike for History20 private settlement (owner decision
 * pending): `SIMUSDT` as a restricted unit inside the existing Spot
 * `Balance` rows. Nothing credits it and no pair quotes it; this only proves,
 * on a real (disposable, loopback) PostgreSQL, that a unit held next to
 * deposited USDT can leave through none of the money paths, and that every
 * legacy asset keeps its guard result.
 *
 * The SIMUSDT row below is a FIXTURE standing for future simulated profit.
 * Synthetic users only; no venue, chain or broker call.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'restricted-unit-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { isRestrictedSettlementUnit, isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../testAssetConfig';
import { WithdrawalService } from '../../WithdrawalService';
import { DepositService } from '../../DepositService';
import { BalanceAdjustmentService } from '../../BalanceAdjustmentService';
import { transferWalletBalance } from '../../WalletTransferService';
import { PurchaseService } from '../../PurchaseService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { OrderService } from '../../OrderService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import { OTC_ASSETS } from '../../../otc/policy';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Restricted settlement unit tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

describe('restricted settlement unit: recognition, legacy guards unchanged', () => {
  test('SIMUSDT bare and on either side of a pair; never USDT, ordinary pairs or a SIM ticker', () => {
    for (const v of ['SIMUSDT', 'simusdt', ' SIMUSDT ', 'VHX01/SIMUSDT', 'VHX01-SIMUSDT', 'SIMUSDT/USDT']) expect(isRestrictedSettlementUnit(v)).toBe(true);
    for (const v of ['USDT', 'USDC', 'BTC/USDT', 'BTCUSDT', 'NRX/USDT', 'SIM', 'SIM/USDT', 'VHX01SIMUSDT', '', null, undefined]) expect(isRestrictedSettlementUnit(v)).toBe(false);
  });

  test('the restricted-asset guard: SIMUSDT added; USDT, ordinary pairs, VTA, NRX and AITH keep their results', () => {
    expect(isTestAssetPairOrSymbol('SIMUSDT')).toBe(true);
    expect(isTestAssetPairOrSymbol('VHX01/SIMUSDT')).toBe(true);
    for (const v of ['USDT', 'BTC', 'BTC/USDT', 'ETH/USDT']) expect(isTestAssetPairOrSymbol(v)).toBe(false);
    for (const v of ['VTA', 'VTA/USDT', 'NRX', 'NRX/USDT', 'AITH', 'AITH/USDT']) expect(isTestAssetPairOrSymbol(v)).toBe(true);
  });
});

pg('restricted settlement unit next to deposited USDT: no money path lets it out (disposable PostgreSQL)', () => {
  let db: PrismaClient, user: string, admin: string;
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const venue = { getTicker: jest.fn(async () => ({ lastPrice: '60000' })) };

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    user = randomUUID(); admin = randomUUID();
    await db.user.createMany({ data: ([[user, 'USER'], [admin, 'ADMIN']] as const).map(([id, role]) => ({ id, email: `${id}@restricted-unit.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    // 1000 deposited USDT and, as a FIXTURE, 250 SIMUSDT of simulated profit.
    await db.balance.createMany({ data: [{ userId: user, asset: 'USDT', available: '1000' }, { userId: user, asset: 'SIMUSDT', available: '250' }] });
    venue.getTicker.mockClear();
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('withdrawals: SIMUSDT is refused on both paths, and never counts toward USDT', async () => {
    const withdrawals = new WithdrawalService(db);
    const request = (asset: string, amount: string) => withdrawals.requestWithdrawal({ userId: user, asset, network: 'TRC20', toAddress: 'TQ-synthetic-fixture', amount });
    await expect(request('SIMUSDT', '1')).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(withdrawals.requestUnheldWithdrawal({ userId: user, asset: 'SIMUSDT', network: 'TRC20', toAddress: 'TQ-synthetic-fixture', amount: '1', available: '250' }))
      .rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(request('USDT', '1000')).resolves.toBeTruthy();
    await expect(request('USDT', '1')).rejects.toThrow('Insufficient USDT balance');
    expect(await balance(user, 'USDT')).toEqual(['0', '1000']);
    expect(await balance(user, 'SIMUSDT')).toEqual(['250', '0']);
    expect(await db.withdrawal.count({ where: { userId: user, asset: 'SIMUSDT' } })).toBe(0);
  });

  test('deposits and admin adjustments refuse SIMUSDT before any write', async () => {
    const deposits = new DepositService(db, { type: 'evm', chain: 'ETH' } as never);
    await expect(deposits.recordObservation({ txHash: '0xfixture', asset: 'SIMUSDT', source: 'admin_check' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(new BalanceAdjustmentService(db).adjust({ userId: user, asset: 'SIMUSDT', amount: '100', reason: 'fixture', performedByAdminId: admin }))
      .rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await db.deposit.count({ where: { asset: 'SIMUSDT' } })).toBe(0);
    expect(await balance(user, 'SIMUSDT')).toEqual(['250', '0']);
  });

  test('transfer to Futures refuses SIMUSDT; USDT still moves as before', async () => {
    await expect(transferWalletBalance(db, user, 'SIMUSDT', new BigNumber(10), 'TO_FUTURES')).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await db.futuresBalance.count({ where: { userId: user, asset: 'SIMUSDT' } })).toBe(0);
    await transferWalletBalance(db, user, 'USDT', new BigNumber(10), 'TO_FUTURES');
    expect(await balance(user, 'USDT')).toEqual(['990', '0']);
    expect(await balance(user, 'SIMUSDT')).toEqual(['250', '0']);
  });

  test('it pays for no product, is no OTC cash asset, and is never valued', async () => {
    const product = await db.product.create({ data: { name: 'Fixture product', description: 'fixture', priceAmount: '10', priceAsset: 'SIMUSDT' } });
    await expect(new PurchaseService(db).purchaseProduct(user, product.id)).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await db.purchase.count({ where: { userId: user } })).toBe(0);
    expect(await balance(user, 'SIMUSDT')).toEqual(['250', '0']);
    expect(Object.keys(OTC_ASSETS)).not.toContain('SIMUSDT');
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
    const prices = await wallet.pricesFor(['SIMUSDT', 'USDT']);
    expect(prices.get('SIMUSDT') ?? null).toBeNull();
    expect(prices.get('USDT')).toBe(1);
  });

  test('no Spot order on a SIMUSDT pair (default off): refused before any row, for users and the owner', async () => {
    const orders = new OrderService(db, new MatchingEngine(), venue);
    for (const pair of ['VHX01/SIMUSDT', 'BTC/SIMUSDT']) {
      await expect(orders.placeOrder({ userId: user, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOrder({ userId: admin, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    }
    expect(await db.order.count({ where: { userId: { in: [user, admin] } } })).toBe(0);
    expect(venue.getTicker).not.toHaveBeenCalled();
    expect(await balance(user, 'SIMUSDT')).toEqual(['250', '0']);
  });
});
