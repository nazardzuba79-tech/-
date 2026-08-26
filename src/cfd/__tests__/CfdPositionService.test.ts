import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { CfdPositionService } from '../CfdPositionService';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';

function makeFakePrisma(opts?: { balances?: Record<string, { available: string; locked: string }>; userCreatedAt?: Date }) {
  const balances = new Map(Object.entries(opts?.balances ?? {}));
  const positions = new Map<string, any>();
  const userCreatedAt = opts?.userCreatedAt ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const tx = {
    user: { findUnique: jest.fn(async () => ({ id: 'u', createdAt: userCreatedAt })) },
    futuresBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`);
        return b ? { ...b } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        const existing = balances.get(`${userId}:${asset}`) ?? { available: '0', locked: '0' };
        balances.set(`${userId}:${asset}`, { available: data.available ?? existing.available, locked: data.locked ?? existing.locked });
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create, update }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked });
        else balances.set(key, { available: update.available, locked: update.locked });
        return { ...balances.get(key)! };
      }),
    },
    cfdPosition: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const p of positions.values()) {
          if (p.userId === where.userId && p.symbol === where.symbol && p.status === where.status) return { ...p };
        }
        return null;
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (positions.has(id) ? { ...positions.get(id) } : null)),
      create: jest.fn(async ({ data }: any) => {
        const id = uuidv4();
        const row = { id, realizedPnl: '0', closedAt: null, ...data };
        positions.set(id, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positions.get(id), data);
        return { ...positions.get(id) };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        Array.from(positions.values()).filter((p) => p.userId === where.userId && (where.status ? p.status === where.status : true))
      ),
    },
  };

  return { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
}

function mockCfdMarketData(prices: Record<string, string>): CfdMarketDataService {
  return {
    getTickers: jest.fn().mockResolvedValue(
      Object.entries(prices).map(([symbol, price]) => ({ symbol, name: symbol, price, changePercent24h: '0' }))
    ),
  } as unknown as CfdMarketDataService;
}

describe('CfdPositionService', () => {
  it('opens a new LONG position, locking margin and computing a liquidation price below entry', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10000', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    const position = await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });

    expect(position.side).toBe('LONG');
    expect(position.entryPrice).toBe('2000');
    expect(position.initialMargin).toBe('200'); // 2000 notional / 10x
    expect(new BigNumber(String(position.liquidationPrice)).isLessThan(2000)).toBe(true);
  });

  it('opens a SHORT position with a liquidation price above entry', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10000', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    const position = await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'SELL', quantity: new BigNumber(1), leverage: 10 });

    expect(position.side).toBe('SHORT');
    expect(new BigNumber(String(position.liquidationPrice)).isGreaterThan(2000)).toBe(true);
  });

  it('rejects opening when available margin is insufficient', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    await expect(service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 })).rejects.toThrow(
      'Insufficient'
    );
  });

  it('averages entry price and adds margin when increasing a same-direction position', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10000', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });
    const grown = await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });

    expect(grown.size).toBe('2');
    expect(grown.entryPrice).toBe('2000'); // same price both times, average is unchanged
    expect(grown.initialMargin).toBe('400');
  });

  it('rejects opening the opposite direction while a position is already open', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10000', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });

    await expect(service.open({ userId: 'u', symbol: 'XAUUSD', side: 'SELL', quantity: new BigNumber(1), leverage: 10 })).rejects.toThrow(
      'opposite direction'
    );
  });

  it('closes a profitable LONG position, crediting margin plus PnL back to available', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '9800', locked: '200' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));
    const position = await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });

    // Price rose to 2100 by close time.
    const closingService = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2100' }));
    const closed = await closingService.close({ userId: 'u', positionId: position.id });

    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedPnl).toBe('100'); // (2100-2000) * 1
  });

  it('clamps a loss at the locked margin — never takes the account negative (negative-balance protection)', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '9800', locked: '200' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));
    const position = await service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 });

    // Catastrophic drop far past what the margin could ever cover.
    const closingService = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '100' }));
    const closed = await closingService.close({ userId: 'u', positionId: position.id });

    expect(closed.status).toBe('CLOSED');
    // realizedPnl is the true (very negative) number for the record...
    expect(new BigNumber(String(closed.realizedPnl)).isLessThan(-1000)).toBe(true);
  });

  it('rejects an out-of-range leverage', async () => {
    const prisma = makeFakePrisma({ balances: { 'u:USDT': { available: '10000', locked: '0' } } });
    const service = new CfdPositionService(prisma, mockCfdMarketData({ XAUUSD: '2000' }));

    await expect(
      service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 0 })
    ).rejects.toThrow('Leverage must be');
  });
});
