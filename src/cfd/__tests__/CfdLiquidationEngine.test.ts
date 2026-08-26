import BigNumber from 'bignumber.js';
import { CfdLiquidationEngine } from '../CfdLiquidationEngine';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';

function makeFakePrisma(positions: any[], balances: Record<string, { available: string; locked: string }>) {
  const positionMap = new Map(positions.map((p) => [p.id, { ...p }]));
  const balanceMap = new Map(Object.entries(balances));

  const tx = {
    cfdPosition: {
      findUnique: jest.fn(async ({ where: { id } }: any) => (positionMap.has(id) ? { ...positionMap.get(id) } : null)),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positionMap.get(id), data);
        return { ...positionMap.get(id) };
      }),
    },
    futuresBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balanceMap.get(`${userId}:${asset}`);
        return b ? { ...b } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balanceMap.set(`${userId}:${asset}`, { available: data.available ?? balanceMap.get(`${userId}:${asset}`)!.available, locked: data.locked });
      }),
    },
  };

  return {
    cfdPosition: { findMany: jest.fn(async () => Array.from(positionMap.values())) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    _positionMap: positionMap,
    _balanceMap: balanceMap,
  } as any;
}

function mockCfdMarketData(prices: Record<string, string> | null): CfdMarketDataService {
  return {
    isConfigured: () => prices !== null,
    getTickers: jest.fn().mockResolvedValue(prices ? Object.entries(prices).map(([symbol, price]) => ({ symbol, name: symbol, price, changePercent24h: '0' })) : []),
  } as unknown as CfdMarketDataService;
}

describe('CfdLiquidationEngine', () => {
  it('liquidates a LONG position whose mark price fell to/below its liquidation price', async () => {
    const position = { id: 'p1', userId: 'u', symbol: 'XAUUSD', side: 'LONG', size: '1', entryPrice: '2000', leverage: '10', initialMargin: '200', liquidationPrice: '1810', status: 'OPEN', realizedPnl: '0' };
    const prisma = makeFakePrisma([position], { 'u:USDT': { available: '9800', locked: '200' } });
    const engine = new CfdLiquidationEngine(prisma, mockCfdMarketData({ XAUUSD: '1800' }));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(prisma._positionMap.get('p1').status).toBe('LIQUIDATED');
    expect(prisma._balanceMap.get('u:USDT').locked).toBe('0');
  });

  it('does not liquidate a position still above its liquidation price', async () => {
    const position = { id: 'p1', userId: 'u', symbol: 'XAUUSD', side: 'LONG', size: '1', entryPrice: '2000', leverage: '10', initialMargin: '200', liquidationPrice: '1810', status: 'OPEN', realizedPnl: '0' };
    const prisma = makeFakePrisma([position], { 'u:USDT': { available: '9800', locked: '200' } });
    const engine = new CfdLiquidationEngine(prisma, mockCfdMarketData({ XAUUSD: '1950' }));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(prisma._positionMap.get('p1').status).toBe('OPEN');
  });

  it('liquidates a SHORT position whose mark price rose to/above its liquidation price', async () => {
    const position = { id: 'p1', userId: 'u', symbol: 'XAUUSD', side: 'SHORT', size: '1', entryPrice: '2000', leverage: '10', initialMargin: '200', liquidationPrice: '2190', status: 'OPEN', realizedPnl: '0' };
    const prisma = makeFakePrisma([position], { 'u:USDT': { available: '9800', locked: '200' } });
    const engine = new CfdLiquidationEngine(prisma, mockCfdMarketData({ XAUUSD: '2200' }));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(1);
    expect(prisma._positionMap.get('p1').status).toBe('LIQUIDATED');
  });

  it('skips checking entirely when Twelve Data is not configured (no key set)', async () => {
    const position = { id: 'p1', userId: 'u', symbol: 'XAUUSD', side: 'LONG', size: '1', entryPrice: '2000', leverage: '10', initialMargin: '200', liquidationPrice: '1810', status: 'OPEN', realizedPnl: '0' };
    const prisma = makeFakePrisma([position], { 'u:USDT': { available: '9800', locked: '200' } });
    const engine = new CfdLiquidationEngine(prisma, mockCfdMarketData(null));

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
  });

  it('skips a symbol missing from the price feed rather than liquidating off no data', async () => {
    const position = { id: 'p1', userId: 'u', symbol: 'NAS100', side: 'LONG', size: '1', entryPrice: '20000', leverage: '10', initialMargin: '2000', liquidationPrice: '18100', status: 'OPEN', realizedPnl: '0' };
    const prisma = makeFakePrisma([position], { 'u:USDT': { available: '9800', locked: '2000' } });
    const engine = new CfdLiquidationEngine(prisma, mockCfdMarketData({ XAUUSD: '1800' })); // NAS100 absent

    const count = await engine.checkAndLiquidate();

    expect(count).toBe(0);
    expect(prisma._positionMap.get('p1').status).toBe('OPEN');
  });
});
