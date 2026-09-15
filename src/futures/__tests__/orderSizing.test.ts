import BigNumber from 'bignumber.js';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { FuturesPositionService } from '../FuturesPositionService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { MarkPriceService } from '../MarkPriceService';
import { futuresRouter } from '../../api/routes/futures';
import { LEVERAGE_TIERS } from '../../config/futuresConfig';
import {
  maxAffordableNotional,
  floorToDecimals,
  QUANTITY_DECIMALS,
} from '../../../frontend/src/lib/futuresMath';

/**
 * Order sizing across the whole listed futures universe.
 *
 * The terminal sizes an order and the server decides whether to take it.
 * That seam is what this suite covers: it computes a size with the SAME
 * functions the order panel calls, then places it through the real route,
 * the real FuturesPositionService and the real matching engine, and
 * requires the server to accept it.
 *
 * The two defects it pins:
 *
 *  1. Sizing at `margin × leverage` ignores that the leverage a position
 *     may use is a function of its own size. At 100x, 10 000 USDT of free
 *     margin was offered as a 1 000 000 USDT order — which falls in a 10x
 *     tier and therefore needs 100 000 USDT of margin. The server rejected
 *     it with "Insufficient USDT margin balance". Same at 100 000 (50x
 *     tier) and 500 000 (20x tier); only 50 000 happened to survive,
 *     because it is exactly the first tier's cap.
 *
 *  2. `toFixed(8)` rounds to NEAREST, so a quantity of 10 000 / 60 000
 *     came back fractionally larger than the margin that bought it and was
 *     rejected for insufficient margin on roughly a third of the listed
 *     contracts — at every notional, not just large ones.
 *
 * The universe below spans the real listed range: BTC at five figures down
 * to a meme contract at 8.2e-6, where a 1 000 000 USDT order is ~1.2e11
 * units and double arithmetic starts to matter.
 */

jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (req: any, _res: any, next: any) => { req.userId = 'taker'; next(); },
  requireTradePermission: (_req: any, _res: any, next: any) => next(),
}));

const UNIVERSE: [string, string][] = [
  ['BTC/USDT', '60000'],
  ['ETH/USDT', '2500'],
  ['SOL/USDT', '143.27'],
  ['BNB/USDT', '612.5'],
  ['XRP/USDT', '0.5234'],
  ['DOGE/USDT', '0.08517'],
  ['ADA/USDT', '0.3891'],
  ['1000PEPE/USDT', '0.0000082'],
];
const SYMBOLS = UNIVERSE.map(([symbol]) => symbol);

/** Free margin chosen so that `margin × 100x` is exactly the headline
 *  notional the trader was trying to open. */
const CASES: [number, number][] = [
  [50_000, 500],
  [100_000, 1_000],
  [500_000, 5_000],
  [1_000_000, 10_000],
];

const TIERS = JSON.parse(JSON.stringify(LEVERAGE_TIERS));

function makeFakePrisma(available: string) {
  const balances = new Map<string, { available: string; locked: string }>([
    ['taker:USDT', { available, locked: '0' }],
    ['maker:USDT', { available: '1000000000', locked: '0' }],
  ]);
  const orders = new Map<string, any>();
  const positions = new Map<string, any>();
  const tx = {
    $queryRaw: jest.fn(async (q: any) =>
      q.strings.join('').includes('pg_current_xact_id') ? [{ id: '1' }] : [{ locked: null }]),
    user: { findUnique: jest.fn(async () => ({ id: 'u', createdAt: new Date(Date.now() - 365 * 864e5) })) },
    futuresBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const row = balances.get(`${userId}:${asset}`);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balances.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked });
        return { ...balances.get(key)! };
      }),
    },
    futuresOrder: {
      create: jest.fn(async ({ data }: any) => { orders.set(data.id, { createdAt: new Date(), ...data }); }),
      update: jest.fn(async ({ where: { id }, data }: any) => { Object.assign(orders.get(id), data); }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
      findMany: jest.fn(async ({ where }: any) => Array.from(orders.values()).filter((order) =>
        (where.userId === undefined || order.userId === where.userId)
        && order.symbol === where.symbol
        && (where.marginType === undefined || order.marginType === where.marginType)
        && where.status.in.includes(order.status)
        && (where.reduceOnly === undefined || order.reduceOnly === where.reduceOnly)).map((o) => ({ ...o }))),
    },
    futuresPositionProtection: { findFirst: jest.fn(async () => null), update: jest.fn() },
    futuresPosition: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const p of positions.values()) {
          if (p.userId === where.userId && p.symbol === where.symbol
            && p.marginType === where.marginType && p.status === where.status) return { ...p };
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = uuidv4(); const row = { id, realizedPnl: '0', ...data };
        positions.set(id, row); return { ...row };
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positions.get(id), data); return { ...positions.get(id) };
      }),
    },
    trade: { create: jest.fn(async () => {}) },
  };
  const prisma = {
    $queryRaw: jest.fn(async () => [{ status: 'committed' }]),
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
  return { prisma, balances, orders, positions };
}

function terminal(symbol: string, price: string, available: string) {
  const engine = new MatchingEngine();
  const state = makeFakePrisma(available);
  const mark = new MarkPriceService({ getTicker: jest.fn().mockResolvedValue({ lastPrice: price }) } as any);
  const service = new FuturesPositionService(state.prisma, engine, mark);
  const app = express();
  app.use(express.json());
  app.use(futuresRouter(state.prisma, engine, service, mark,
    { list: () => SYMBOLS, has: (s: string) => SYMBOLS.includes(s) } as any,
    { activeProtectionByPosition: async () => new Map() } as any));
  return { app, service, engine, ...state };
}

/** Exactly what the order panel's size slider computes at `pct`. */
function sizeAt(pct: number, freeMargin: number, selectedLeverage: number, price: string) {
  const { notional, leverage } = maxAffordableNotional({
    tiers: TIERS,
    freeMargin: freeMargin * (pct / 100),
    selectedLeverage,
    existingExposure: 0,
  });
  const quantity = floorToDecimals(notional / Number(price), QUANTITY_DECIMALS).toFixed(QUANTITY_DECIMALS);
  return { quantity, leverage };
}

describe('the size slider produces an order the server accepts', () => {
  /** Place one order through the real route and report what the server did. */
  async function place(symbol: string, price: string, available: number, quantity: string, leverage: number) {
    const { app, balances } = terminal(symbol, price, String(available));
    const res = await request(app).post('/futures/orders')
      .send({ symbol, side: 'BUY', type: 'LIMIT', price, quantity, leverage, marginType: 'ISOLATED' });
    return { res, locked: new BigNumber(balances.get('taker:USDT')!.locked) };
  }

  /**
   * The size the slider offers is accepted, costs no more than the budget
   * it was sized from, and is MAXIMAL — a millionth more is refused.
   *
   * Maximality is what makes this a test of the fixed point rather than of
   * caution: returning zero would satisfy every other assertion here. The
   * bump is relative (1e-6) rather than one quantity step, because one
   * step of a 0.0000082 USDT contract is 8e-14 USDT of notional and lands
   * inside the rounding guard the sizing deliberately keeps.
   */
  async function expectMaximal(symbol: string, price: string, budget: number, selected: number) {
    const { quantity, leverage } = sizeAt(100, budget, selected, price);
    const { res, locked } = await place(symbol, price, budget, quantity, leverage);
    expect(res.body.error ?? null).toBeNull();
    expect(res.status).toBe(201);
    expect(locked.isLessThanOrEqualTo(budget)).toBe(true);

    const bumped = new BigNumber(quantity).times(1.000001).toFixed(QUANTITY_DECIMALS);
    const over = await place(symbol, price, budget, bumped, leverage);
    expect(over.res.status).toBe(400);
    expect(over.locked.isZero()).toBe(true);
  }

  describe.each(UNIVERSE)('%s at %s', (symbol, price) => {
    it.each(CASES)('100%% of the margin behind a %d USDT order, at 100x', async (_headline, freeMargin) => {
      await expectMaximal(symbol, price, freeMargin, 100);
    });

    it.each([1, 5, 10, 20, 50, 100])('100%% of 10 000 USDT at %sx', async (selected) => {
      await expectMaximal(symbol, price, 10_000, selected);
    });

    it('partial slider steps size against their own share of the margin', async () => {
      const freeMargin = 10_000;
      for (const pct of [25, 50, 75]) {
        const { quantity, leverage } = sizeAt(pct, freeMargin, 20, price);
        const { res, locked } = await place(symbol, price, freeMargin, quantity, leverage);
        expect(res.body.error ?? null).toBeNull();
        expect(res.status).toBe(201);
        // A share of the budget, and — since 20x keeps every one of these
        // inside the 250 000 tier — the whole of that share.
        expect(locked.dividedBy(freeMargin * (pct / 100)).toNumber()).toBeCloseTo(1, 5);
      }
    });
  });
});

describe('maxAffordableNotional solves the size/leverage fixed point', () => {
  it('never offers a size the tier table will not fund', () => {
    for (const freeMargin of [500, 1_000, 5_000, 10_000, 50_000, 250_000]) {
      for (const selected of [1, 2, 5, 10, 20, 50, 100]) {
        const { notional, leverage } = maxAffordableNotional({ tiers: TIERS, freeMargin, selectedLeverage: selected });
        const tier = TIERS.find((t: any) => t.notionalCap === null || notional <= t.notionalCap)!;
        // The leverage returned is one the resulting exposure may use...
        expect(leverage).toBeLessThanOrEqual(Math.min(selected, tier.maxLeverage));
        // ...and the margin it costs is inside the budget.
        expect(notional / leverage).toBeLessThanOrEqual(freeMargin);
      }
    }
  });

  it('caps a 100x request at the largest tier the margin can actually fund', () => {
    // 10 000 USDT at 100x is NOT 1 000 000: that lands in the 10x tier and
    // would need 100 000. The reachable maximum is the 250 000 cap at 50x.
    const { notional, leverage } = maxAffordableNotional({ tiers: TIERS, freeMargin: 10_000, selectedLeverage: 100 });
    expect(Math.round(notional)).toBe(250_000);
    expect(leverage).toBe(50);
  });

  it('leaves room for exposure already in the bucket', () => {
    const open = maxAffordableNotional({ tiers: TIERS, freeMargin: 10_000, selectedLeverage: 100 }).notional;
    const added = maxAffordableNotional({
      tiers: TIERS, freeMargin: 10_000, selectedLeverage: 100, existingExposure: open,
    });
    // The bucket is already at the 250k cap it can fund, so the next tier
    // up is the only room left — and it is a 20x tier, so 10 000 buys
    // 200 000 more rather than another 250 000.
    expect(Math.round(added.notional)).toBe(200_000);
    expect(added.leverage).toBe(20);
  });

  it('refuses to size on an unknown or empty budget rather than guessing', () => {
    for (const freeMargin of [0, -1, NaN, Infinity]) {
      expect(maxAffordableNotional({ tiers: TIERS, freeMargin, selectedLeverage: 10 }).notional).toBe(0);
    }
    expect(maxAffordableNotional({ tiers: TIERS, freeMargin: 1_000, selectedLeverage: 0 }).notional).toBe(0);
  });
});

describe('floorToDecimals never rounds a size up', () => {
  it('truncates instead of rounding to nearest', () => {
    expect(floorToDecimals(0.166666666666, 8)).toBe(0.16666666);   // toFixed gives 0.16666667
    expect(floorToDecimals(1.999999999, 8)).toBe(1.99999999);
    expect(floorToDecimals(2, 8)).toBe(2);
  });

  it('holds at the low-priced end of the universe, where 10**8 scaling does not', () => {
    // 1 000 000 USDT of a 0.0000082 contract is ~1.2e11 units; scaling
    // that by 1e8 exceeds 2**53, so Math.floor on it is a no-op.
    const value = 1_000_000 / 0.0000082;
    expect(floorToDecimals(value, 8)).toBeLessThanOrEqual(value);
    expect(floorToDecimals(value, 8)).toBeCloseTo(value, 6);
  });

  it('is safe on values that cannot be sized', () => {
    for (const value of [0, -1, NaN, Infinity]) expect(floorToDecimals(value, 8)).toBe(0);
  });
});
