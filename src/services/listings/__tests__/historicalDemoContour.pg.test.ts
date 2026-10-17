/**
 * The historical demo contour against a real (disposable, loopback)
 * PostgreSQL: every real-money entry point refuses a historical simulation,
 * and no row of any other module changes — balances, Spot and demo orders
 * and trades, deposits, withdrawals, futures balances, snapshots, audit.
 * Synthetic users and fixtures only.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { importHistoricalHourlyCsv } from '../../../shared/listingHistoricalReplay';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { listingScenarioPreview } from '../listingPreview';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { HISTORICAL_DEMO_MESSAGE } from '../simulationContour';
import { TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../testMarkets/testAssetConfig';
import { OrderService } from '../../OrderService';
import { DemoTradingService } from '../../DemoTradingService';
import { BalanceAdjustmentService } from '../../BalanceAdjustmentService';
import { WithdrawalService } from '../../WithdrawalService';
import { DepositService } from '../../DepositService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Historical contour tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const HOUR = 3_600_000;
const LISTING_AT = '2026-11-01T00:00:00.000Z';
function csv(hours: number): string {
  let price = 100;
  return Array.from({ length: hours }, (_, i) => {
    const open = price, close = open * (1 + (i % 2 ? -.008 : .011));
    price = close;
    return [Date.parse('2018-01-01T00:00:00Z') / 1000 + i * 3600, open, Math.max(open, close) * 1.003, Math.min(open, close) * .997, close].join(',');
  }).join('\n');
}

pg('historical demo contour on disposable PostgreSQL', () => {
  let db: PrismaClient, admin: string, user: string, symbol: string, config: ListingConfig;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    admin = randomUUID(); user = randomUUID();
    symbol = `H${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    const base = defaultScenarioControls('2', 'CALM');
    config = parseListingConfig({
      schemaVersion: 1, symbol, name: 'Historical demo', logo: null, initialPrice: '2', listingAt: LISTING_AT,
      displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'hist-20261101-synthetic', tradable: false,
      simulationProgram: { ...base, stages: [...base.stages, { type: 'pullback', durationHours: 24, targetPrice: '10' }],
        afterGrowth: 'historical', historical: { version: 1, clips: [importHistoricalHourlyCsv(csv(96), 'BTC/USDT')] } },
    });
    await db.user.createMany({ data: [admin, user].map((id, i) => ({ id, email: `${id}@contour.invalid`, referralCode: id, passwordHash: 'fixture', role: i ? 'USER' : 'ADMIN' })) });
    await db.balance.createMany({ data: [
      { userId: admin, asset: 'USDT', available: '1000' }, { userId: admin, asset: 'BTC', available: '0.5' },
      { userId: user, asset: 'USDT', available: '500', locked: '25' },
    ] });
    await db.demoBalance.create({ data: { userId: admin, asset: 'USDT', available: '100' } });
    await db.futuresBalance.create({ data: { userId: user, asset: 'USDT', available: '75' } });
    // As if the catalogue ever carried it, after its replay began.
    setManagedListingAssets([listingSimulationConfig(config)]);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(LISTING_AT) + 200 * HOUR);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Every row another module keeps for these users, plus anything at all recorded for the simulated asset. */
  async function ledger() {
    const ids = [admin, user];
    const mine = { where: { userId: { in: ids } }, orderBy: { id: 'asc' as const } };
    return JSON.stringify(await Promise.all([
      db.balance.findMany({ where: { userId: { in: ids } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }),
      db.order.findMany(mine), db.trade.findMany({ where: { OR: [{ takerUserId: { in: ids } }, { makerUserId: { in: ids } }] } }),
      db.demoBalance.findMany({ where: { userId: { in: ids } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }),
      db.demoOrder.findMany(mine), db.demoTrade.findMany({ where: { OR: [{ takerUserId: { in: ids } }, { makerUserId: { in: ids } }] } }),
      db.deposit.findMany(mine), db.withdrawal.findMany(mine),
      db.futuresBalance.findMany({ where: { userId: { in: ids } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }),
      db.portfolioSnapshot.findMany(mine), db.auditLog.findMany(mine),
      db.balance.count({ where: { asset: symbol } }), db.order.count({ where: { pair: `${symbol}/USDT` } }),
      db.trade.count({ where: { pair: `${symbol}/USDT` } }), db.demoBalance.count({ where: { asset: symbol } }),
    ]));
  }

  test('every real-money entry point refuses it and no other module changes', async () => {
    const before = await ledger();
    const pair = `${symbol}/USDT`;
    const orders = new OrderService(db, new MatchingEngine(), { getTicker: jest.fn(async () => ({ lastPrice: '1' })) });
    const one = new BigNumber(1);
    const restricted = TEST_ASSET_NOT_TRADABLE_MESSAGE;
    const refusals: [Promise<unknown>, string][] = [
      [orders.placeOrder({ userId: user, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber('5'), quantity: one }), HISTORICAL_DEMO_MESSAGE],
      // The owner's simulation sale path: the gate comes first.
      [orders.placeOrder({ userId: admin, pair, side: 'SELL', type: 'MARKET', quantity: one }), HISTORICAL_DEMO_MESSAGE],
      [orders.placeOrder({ userId: user, pair, side: 'BUY', type: 'STOP_LIMIT', price: new BigNumber('5'), triggerPrice: new BigNumber('4'), quantity: one }), HISTORICAL_DEMO_MESSAGE],
      [orders.placeOcoOrder({ userId: admin, pair, side: 'SELL', quantity: one, takeProfitPrice: new BigNumber('9'), stopTriggerPrice: new BigNumber('3'), stopLimitPrice: new BigNumber('2.9') }), HISTORICAL_DEMO_MESSAGE],
      [new DemoTradingService(db, new MatchingEngine()).placeOrder({ userId: admin, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber('5'), quantity: one }), restricted],
      [new BalanceAdjustmentService(db).adjust({ userId: user, asset: symbol, amount: '10', reason: 'contour test', performedByAdminId: admin }), restricted],
      [new WithdrawalService(db).requestWithdrawal({ userId: user, asset: symbol, network: 'ethereum', toAddress: '0x0000000000000000000000000000000000000001', amount: '1' }), restricted],
      [new DepositService(db, { chain: 'ethereum' } as any).recordObservation({ txHash: '0x' + 'a'.repeat(64), asset: symbol, source: 'admin_check' }), restricted],
      [allocateListingOwner(db, { id: 'hist-1', version: 1, publishedAt: LISTING_AT, config: { ...config, ownerAllocation: '1000' } }, admin), 'historical simulation'],
    ];
    for (const [attempt, reason] of refusals) await expect(attempt).rejects.toThrow(reason);

    // The admin's private preview is pure computation over the same model.
    expect(listingScenarioPreview(config, '1h', 'afterGrowth').candles.length).toBeGreaterThan(0);

    // A wallet view of the same accounts values nothing of it and writes nothing.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: 'BTC/USDT', lastPrice: '100000' }, { pair: `${symbol}/USDT`, lastPrice: '777' }]) } as any,
      { isConfigured: () => false } as any);
    expect((await wallet.pricesFor([symbol])).get(symbol)).toBeNull();
    await wallet.overview({ id: admin, role: 'ADMIN', email: `${admin}@contour.invalid` });

    expect(await ledger()).toBe(before);
  });
});
