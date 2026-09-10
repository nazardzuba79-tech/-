import BigNumber from 'bignumber.js';
import { LiquidationEngine } from '../LiquidationEngine';
import { MarkPriceService } from '../MarkPriceService';

/**
 * @param onFirstPositionOp fires once, immediately after the FIRST
 *   futuresPosition operation inside a liquidation transaction. That is the
 *   window a concurrent reduce-only close actually commits in, and modelling
 *   it is what makes the double-settlement tests discriminating: an
 *   implementation that reads the row and then checks it in JS has already
 *   taken its snapshot by then, while one that claims the row with a
 *   conditional write has already changed the row the close would look at.
 */
function makeFakePrisma(
  positions: any[],
  balances: Record<string, { available: string; locked: string }> = {},
  onFirstPositionOp?: () => void
) {
  let positionOps = 0;
  const afterPositionOp = () => {
    positionOps++;
    if (positionOps === 1) onFirstPositionOp?.();
  };
  const positionMap = new Map(positions.map((p) => [p.id, { realizedPnl: '0', ...p }]));
  const balanceMap = new Map(Object.entries(balances));
  const insuranceFund = new Map<string, string>();
  const insuranceLedger: any[] = [];

  const tx = {
    futuresPosition: {
      findUnique: jest.fn(async ({ where: { id } }: any) => {
        const snapshot = positionMap.has(id) ? { ...positionMap.get(id) } : null;
        afterPositionOp();
        return snapshot;
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positionMap.get(id), data);
        return { ...positionMap.get(id) };
      }),
      // The engine claims a position with a CONDITIONAL write rather than a
      // read-then-check, because under READ COMMITTED a snapshot read can
      // still say OPEN after somebody else closed the position. This models
      // that faithfully: the predicate is evaluated against the CURRENT row
      // with no gap between the check and the write, exactly as PostgreSQL
      // does under the row lock. A fake that ignored the predicate would
      // make the double-settlement tests below vacuous.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = positionMap.get(where.id);
        const eligible = row && Object.entries(where).every(([key, value]) => key === 'id' || (row as any)[key] === value);
        if (!eligible) {
          afterPositionOp();
          return { count: 0 };
        }
        Object.assign(row, data);
        afterPositionOp();
        return { count: 1 };
      }),
    },
    futuresBalance: {
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balanceMap.has(key)) balanceMap.set(key, { available: create.available, locked: create.locked });
        return { ...balanceMap.get(key)! };
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balanceMap.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
    },
    insuranceFund: {
      upsert: jest.fn(async ({ where: { asset }, create }: any) => {
        if (!insuranceFund.has(asset)) insuranceFund.set(asset, create.balance);
        return { asset, balance: insuranceFund.get(asset)! };
      }),
      update: jest.fn(async ({ where: { asset }, data }: any) => {
        insuranceFund.set(asset, data.balance);
      }),
    },
    insuranceFundLedger: {
      create: jest.fn(async ({ data }: any) => {
        insuranceLedger.push(data);
      }),
    },
  };

  const findManyOpen = jest.fn(async () => Array.from(positionMap.values()).filter((p) => p.status === 'OPEN'));
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    futuresPosition: { findMany: findManyOpen },
  } as any;

  return { prisma, positionMap, balanceMap, insuranceFund, insuranceLedger };
}

function makeMarkPriceService(price: string) {
  const svc = new MarkPriceService({} as any);
  jest.spyOn(svc, 'getMarkPrice').mockResolvedValue(new BigNumber(price));
  return svc;
}

describe('LiquidationEngine.checkAndLiquidate', () => {
  it('liquidates a LONG position whose mark price has fallen to/through its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap, balanceMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '4000', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000')); // through the liq price

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(positionMap.get('p1').status).toBe('LIQUIDATED');
    // locked margin fully released from the user's wallet either way
    expect(balanceMap.get('u1:USDT')!.locked).toBe('0');
  });

  it('does not liquidate a LONG position whose mark price is still above its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '4000', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('58000'));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(positionMap.get('p1').status).toBe('OPEN');
  });

  it('routes a surplus (execution better than bankruptcy price) to the insurance fund as a contribution', async () => {
    // entry 60000, 10x -> bankruptcy price = 54000. Liquidated at 54300
    // (worse than entry, better than bankruptcy) leaves leftover margin.
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, insuranceFund, insuranceLedger } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54300'));

    await engine.checkAndLiquidate();

    // realized pnl = (54300 - 60000) * 1 = -5700; marginBalance = 6000 - 5700 = 300 (surplus)
    expect(new BigNumber(insuranceFund.get('USDT')!).toNumber()).toBeCloseTo(300, 6);
    expect(insuranceLedger[0].reason).toBe('LIQUIDATION_SURPLUS');
  });

  it('routes a shortfall (execution worse than bankruptcy price) to the insurance fund as a payout', async () => {
    // Liquidated at 50000 — well past bankruptcy (54000) — a real loss beyond margin.
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, insuranceFund, insuranceLedger } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('50000'));

    await engine.checkAndLiquidate();

    // realized pnl = (50000 - 60000) * 1 = -10000; marginBalance = 6000 - 10000 = -4000 (shortfall)
    expect(new BigNumber(insuranceFund.get('USDT')!).toNumber()).toBeCloseTo(-4000, 6);
    expect(insuranceLedger[0].reason).toBe('LIQUIDATION_SHORTFALL');
  });

  it('skips a symbol instead of liquidating when mark price is unavailable', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'LONG',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '54300',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const markPriceService = { getMarkPrice: jest.fn().mockResolvedValue(null) } as any;
    const engine = new LiquidationEngine(prisma, markPriceService);

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(positionMap.get('p1').status).toBe('OPEN');
  });

  it('liquidates a SHORT position whose mark price has risen to/through its liquidation price', async () => {
    const positions = [
      {
        id: 'p1',
        userId: 'u1',
        symbol: 'BTC/USDT',
        side: 'SHORT',
        size: '1',
        entryPrice: '60000',
        leverage: 10,
        initialMargin: '6000',
        liquidationPrice: '65700',
        status: 'OPEN',
      },
    ];
    const { prisma, positionMap } = makeFakePrisma(positions, { 'u1:USDT': { available: '0', locked: '6000' } });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('66000'));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(positionMap.get('p1').status).toBe('LIQUIDATED');
  });
});

/**
 * The race a stop loss makes routine.
 *
 * The liquidation sweep runs on its own timer at the PostgreSQL default
 * isolation and holds none of the `futures-book` advisory lock that
 * serializes order placement — so a reduce-only close can commit between
 * the sweep reading a position and the sweep settling it. That was already
 * true of the manual Close button; TP/SL simply makes it happen far more
 * often, because a stop loss and a liquidation are triggered by the SAME
 * mark price moving the SAME way, moments apart.
 *
 * The claim is what decides it. Exactly one closer settles.
 */
describe('a position closed underneath the sweep is never settled twice', () => {
  const LONG_AT_RISK = [
    {
      id: 'p1',
      userId: 'u1',
      symbol: 'BTC/USDT',
      side: 'LONG',
      size: '1',
      entryPrice: '60000',
      leverage: 10,
      initialMargin: '6000',
      liquidationPrice: '54300',
      status: 'OPEN',
    },
  ];

  it('a stop loss that already closed the position means NO liquidation at all', async () => {
    const { prisma, positionMap, balanceMap, insuranceLedger } = makeFakePrisma(LONG_AT_RISK, {
      'u1:USDT': { available: '4000', locked: '6000' },
    });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000'));

    // The stop loss won outright: the reduce-only fill closed the position
    // and already released its margin and realized its PnL.
    const position = positionMap.get('p1');
    position.status = 'CLOSED';
    position.size = '0';
    position.realizedPnl = '-5700';
    balanceMap.set('u1:USDT', { available: '4300', locked: '0' });

    expect(await engine.liquidatePosition('p1', new BigNumber('54000'))).toBe(false);
    expect(positionMap.get('p1').status).toBe('CLOSED');
    expect(positionMap.get('p1').realizedPnl).toBe('-5700');
    expect(balanceMap.get('u1:USDT')).toEqual({ available: '4300', locked: '0' });
    expect(insuranceLedger).toHaveLength(0);
  });

  it('a stop loss closing it INSIDE the sweep settles exactly one of the two', async () => {
    // The window that matters, and the one a read-then-check guard cannot
    // survive: the sweep is already inside its transaction when the trigger's
    // reduce-only close commits.
    let closeSucceeded: boolean | null = null;
    const state: any = {};
    const stopLossCommits = () => {
      const position = state.positionMap.get('p1');
      // A reduce-only close can only settle an OPEN position — with none, the
      // preflight refuses it and nothing moves. That is the real constraint,
      // so the fake honours it rather than letting both sides win.
      if (position.status !== 'OPEN') {
        closeSucceeded = false;
        return;
      }
      position.status = 'CLOSED';
      position.size = '0';
      position.realizedPnl = '-5700';
      state.balanceMap.set('u1:USDT', { available: '4300', locked: '0' });
      closeSucceeded = true;
    };
    const { prisma, positionMap, balanceMap, insuranceLedger } = makeFakePrisma(
      LONG_AT_RISK,
      { 'u1:USDT': { available: '4000', locked: '6000' } },
      stopLossCommits
    );
    state.positionMap = positionMap;
    state.balanceMap = balanceMap;

    const liquidated = await engine(prisma).liquidatePosition('p1', new BigNumber('54000'));

    // Exactly one closer settled — whichever it was.
    expect(closeSucceeded === true ? liquidated : !liquidated).toBe(closeSucceeded === true);
    expect([liquidated, closeSucceeded]).toContain(true);
    expect(liquidated && closeSucceeded).toBeFalsy();

    // Whoever won, the books balance ONCE: margin fully released, never twice
    // (which would drive locked below zero), and one settlement recorded.
    expect(balanceMap.get('u1:USDT')!.locked).toBe('0');
    expect(Number(balanceMap.get('u1:USDT')!.available)).toBeGreaterThanOrEqual(0);
    expect(positionMap.get('p1').realizedPnl).toBe(liquidated ? '-6000' : '-5700');
    expect(insuranceLedger).toHaveLength(liquidated ? 1 : 0);
  });

  const engine = (prisma: any) => new LiquidationEngine(prisma, makeMarkPriceService('54000'));

  it('two liquidation passes over the same position settle it once', async () => {
    const { prisma, positionMap, balanceMap, insuranceLedger } = makeFakePrisma(LONG_AT_RISK, {
      'u1:USDT': { available: '4000', locked: '6000' },
    });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000'));

    const first = await engine.liquidatePosition('p1', new BigNumber('54000'));
    const second = await engine.liquidatePosition('p1', new BigNumber('54000'));

    expect([first, second]).toEqual([true, false]);
    expect(positionMap.get('p1').status).toBe('LIQUIDATED');
    expect(positionMap.get('p1').realizedPnl).toBe('-6000');
    expect(balanceMap.get('u1:USDT')!.locked).toBe('0');
    expect(insuranceLedger).toHaveLength(1);
  });

  it('two concurrent sweeps liquidate it once', async () => {
    const { prisma, positionMap, balanceMap, insuranceLedger } = makeFakePrisma(LONG_AT_RISK, {
      'u1:USDT': { available: '4000', locked: '6000' },
    });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000'));

    const [a, b] = await Promise.all([engine.checkAndLiquidate(), engine.checkAndLiquidate()]);

    expect(a + b).toBe(1);
    expect(balanceMap.get('u1:USDT')!.locked).toBe('0');
    expect(insuranceLedger).toHaveLength(1);
  });

  it('the claim reads the position AFTER taking it, so a partial reduce is not settled at a stale size', async () => {
    const { prisma, positionMap, balanceMap } = makeFakePrisma(LONG_AT_RISK, {
      'u1:USDT': { available: '4000', locked: '6000' },
    });
    const engine = new LiquidationEngine(prisma, makeMarkPriceService('54000'));

    // Half the position was closed by hand first; margin halved with it.
    const position = positionMap.get('p1');
    position.size = '0.5';
    position.initialMargin = '3000';
    balanceMap.set('u1:USDT', { available: '7000', locked: '3000' });

    expect(await engine.liquidatePosition('p1', new BigNumber('54000'))).toBe(true);
    // Settled against 0.5 at 3000 margin, not the 1 / 6000 the scan saw.
    expect(positionMap.get('p1').realizedPnl).toBe('-3000');
    expect(balanceMap.get('u1:USDT')).toEqual({ available: '7000', locked: '0' });
  });
});
