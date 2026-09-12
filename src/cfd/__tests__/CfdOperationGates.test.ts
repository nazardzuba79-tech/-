import BigNumber from 'bignumber.js';
import express from 'express';
import request from 'supertest';
import { CfdPositionService } from '../CfdPositionService';
import { CfdLiquidationEngine } from '../CfdLiquidationEngine';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { cfdRouter } from '../../api/routes/cfd';
import { CfdQuoteUnavailable } from '../../services/marketData/cfd/CfdQuote';

jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (req: any, _res: any, next: any) => { req.userId = 'u'; next(); },
  requireTradePermission: (_req: any, _res: any, next: any) => next(),
}));

const at = Date.UTC(2026, 8, 12);
beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(at));
afterEach(() => jest.useRealTimers());

function provider(symbol = 'XAUUSD', enabled = false, raw: Record<string, unknown> = {}) {
  const providerSymbol = symbol === 'WTIUSD' ? 'WTI/USD' : 'XAU/USD';
  const fetchFn = jest.fn(async (_url: Parameters<typeof fetch>[0]) => ({ ok: true, status: 200, json: async () => ({
    [providerSymbol]: { close: '1800', timestamp: Date.now() / 1000, is_market_open: true, ...raw },
  }) }) as Response);
  const data = new CfdMarketDataService('test-key', fetchFn, undefined, { retries: 0 }, {
    entitledSymbols: [symbol], executionSymbols: enabled ? [symbol] : [],
    creditsPerMinute: 100, creditsPerDay: 10000,
  });
  return { data, fetchFn };
}

/** Transactional persistence double: writes are staged and published only on
 * callback success. A rejection discards the actual mutated working balance.
 * This tests service rollback signalling, not PostgreSQL's implementation. */
function database(symbol = 'XAUUSD', afterBalanceWrite = () => {}) {
  const initial = {
    balance: { available: '9800', locked: '200' },
    position: { id: 'p', userId: 'u', symbol, status: 'OPEN', side: 'LONG', size: '1',
      entryPrice: '2000', initialMargin: '200', liquidationPrice: '1810', leverage: 10,
      realizedPnl: '0', openedAt: new Date(at), closedAt: null as Date | null },
  };
  let committed = structuredClone(initial);
  const events: string[] = [];
  const prisma = {
    cfdPosition: { findMany: jest.fn(async () => [structuredClone(committed.position)]) },
    $transaction: jest.fn(async (fn: any) => {
      const working = structuredClone(committed);
      const writeBalance = async ({ data, update }: any) => {
        Object.assign(working.balance, data ?? update);
        events.push('balance');
        afterBalanceWrite();
      };
      const tx = {
        user: { findUnique: async () => ({ createdAt: new Date(at - 365 * 86400000) }) },
        futuresBalance: { findUnique: async () => ({ ...working.balance }), update: writeBalance, upsert: writeBalance },
        cfdPosition: {
          findUnique: async () => structuredClone(working.position),
          findFirst: async () => null,
          create: async ({ data }: any) => { events.push('position'); return data; },
          update: async ({ data }: any) => {
            events.push('position'); Object.assign(working.position, data); return structuredClone(working.position);
          },
        },
      };
      try {
        const result = await fn(tx);
        committed = working; events.push('commit'); return result;
      } catch (error) { events.push('rollback'); throw error; }
    }),
  };
  return { prisma: prisma as any, initial, state: () => committed, events };
}

test.each(['XAUUSD', 'WTIUSD'])('%s: opening disabled rejects OPEN but allows fresh CLOSE and risk liquidation', async (symbol) => {
  const { data, fetchFn } = provider(symbol);
  const quote = await data.getFreshQuote(symbol);
  expect(quote).toMatchObject({ status: 'live', entitlementVerified: true, executionAllowed: false, last: 1800, bid: null, ask: null });
  expect(data.catalog().find(i => i.symbol === symbol)).toMatchObject({ entitlement: 'verified', executionAllowed: false });
  expect(String(fetchFn.mock.calls[0][0])).toContain(encodeURIComponent(symbol === 'WTIUSD' ? 'WTI/USD' : 'XAU/USD'));

  const openDb = database(symbol);
  await expect(new CfdPositionService(openDb.prisma, data).open({ userId: 'u', symbol, side: 'BUY', quantity: new BigNumber(1), leverage: 10 }))
    .rejects.toMatchObject({ reason: 'new_positions_disabled' });
  expect(openDb.events).toEqual([]); expect(openDb.state()).toEqual(openDb.initial);

  const closeDb = database(symbol);
  await new CfdPositionService(closeDb.prisma, data).close({ userId: 'u', positionId: 'p' });
  expect(closeDb.state().position).toMatchObject({ status: 'CLOSED', realizedPnl: '-200' });
  expect(closeDb.state().balance).toEqual({ available: '9800', locked: '0' });
  expect(closeDb.events).toEqual(['balance', 'position', 'commit']);

  const riskDb = database(symbol);
  expect(await new CfdLiquidationEngine(riskDb.prisma, data).checkAndLiquidate()).toBe(1);
  expect(riskDb.state().position).toMatchObject({ status: 'LIQUIDATED', realizedPnl: '-200' });
  expect(riskDb.state().balance).toEqual({ available: '9800', locked: '0' });
  expect(riskDb.events).toEqual(['balance', 'position', 'commit']);
});

test.each(['open', 'close', 'liquidation'])('%s: quote expiry after balance write rolls back the transaction', async (operation) => {
  const db = database('XAUUSD', () => jest.setSystemTime(at + 6000));
  // Only OPEN needs approval. CLOSE/LIQUIDATION prove rollback with it disabled.
  const { data } = provider('XAUUSD', operation === 'open');
  const service = new CfdPositionService(db.prisma, data);
  if (operation === 'liquidation') {
    expect(await new CfdLiquidationEngine(db.prisma, data).checkAndLiquidate()).toBe(0);
  } else {
    const action = operation === 'open'
      ? service.open({ userId: 'u', symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber(1), leverage: 10 })
      : service.close({ userId: 'u', positionId: 'p' });
    await expect(action).rejects.toBeInstanceOf(CfdQuoteUnavailable);
  }
  expect(db.events).toEqual(['balance', 'rollback']);
  expect(db.state()).toEqual(db.initial);
});

test('a quote expiring inside one liquidation transaction does not prevent the next fresh position being checked', async () => {
  const first = database('XAUUSD', () => jest.setSystemTime(at + 6000));
  const second = database('WTIUSD');
  const { data: gold } = provider('XAUUSD');
  const { data: oil } = provider('WTIUSD');
  const firstQuote = await gold.getFreshQuote('XAUUSD');
  jest.setSystemTime(at + 4000);
  const secondQuote = await oil.getFreshQuote('WTIUSD');
  const prisma = {
    cfdPosition: { findMany: async () => [first.initial.position, second.initial.position] },
    $transaction: jest.fn().mockImplementationOnce(first.prisma.$transaction).mockImplementationOnce(second.prisma.$transaction),
  } as any;
  const engine = new CfdLiquidationEngine(prisma, { maxQuoteAgeMs: 5000, isConfigured: () => true,
    getQuotes: async () => [firstQuote, secondQuote], getFreshQuote: async () => firstQuote });
  expect(await engine.checkAndLiquidate()).toBe(1);
  expect(first.events).toEqual(['balance', 'rollback']); expect(first.state()).toEqual(first.initial);
  expect(second.state().position.status).toBe('LIQUIDATED');
});

test('liquidation still propagates unrelated transaction errors', async () => {
  const db = database('XAUUSD', () => { throw new Error('database offline'); });
  const { data } = provider();
  await expect(new CfdLiquidationEngine(db.prisma, data).checkAndLiquidate()).rejects.toThrow('database offline');
  expect(db.state()).toEqual(db.initial);
});

test('API: disabled OPEN leaves existing-position mark/PnL and safe CLOSE available', async () => {
  const db = database(), { data } = provider();
  const service = new CfdPositionService(db.prisma, data);
  const app = express().use(express.json()).use(cfdRouter(db.prisma, data, service));
  const open = await request(app).post('/cfd/positions').send({ symbol: 'XAUUSD', side: 'BUY', quantity: '1', leverage: 10 }).expect(503);
  expect(open.body.code).toBe('cfd_quote_temporarily_unavailable');
  expect(open.body.error).toContain('new_positions_disabled');
  const positions = await request(app).get('/cfd/positions').expect(200);
  expect(positions.body[0]).toMatchObject({ markPrice: '1800', unrealizedPnl: '-200', roe: '-100' });
  await request(app).post('/cfd/positions/p/close').send({}).expect(200);
  expect(db.state().position.status).toBe('CLOSED');
});

test.each([
  ['stale', { timestamp: (at - 60000) / 1000 }],
  ['unavailable', { status: 'error' }],
  ['malformed', { close: 'invalid' }],
  ['zero', { close: '0' }],
  ['null', { close: null }],
] as const)('disabled openings never bypass %s provider safety for CLOSE/LIQUIDATION', async (_name, raw) => {
  const db = database(), { data } = provider('XAUUSD', false, raw);
  const service = new CfdPositionService(db.prisma, data);
  const app = express().use(express.json()).use(cfdRouter(db.prisma, data, service));
  await request(app).post('/cfd/positions/p/close').send({}).expect(503);
  expect(await new CfdLiquidationEngine(db.prisma, data).checkAndLiquidate()).toBe(0);
  expect(db.state()).toEqual(db.initial);
  expect(db.events).not.toContain('balance'); expect(db.events).not.toContain('position');
});

test('removing provider entitlement still blocks CLOSE and LIQUIDATION even if OPEN is enabled', async () => {
  const db = database(), { fetchFn } = provider();
  const data = new CfdMarketDataService('test-key', fetchFn, undefined, { retries: 0 }, {
    entitledSymbols: [], executionSymbols: ['XAUUSD'], creditsPerMinute: 100, creditsPerDay: 10000,
  });
  await expect(new CfdPositionService(db.prisma, data).close({ userId: 'u', positionId: 'p' })).rejects.toBeInstanceOf(CfdQuoteUnavailable);
  expect(await new CfdLiquidationEngine(db.prisma, data).checkAndLiquidate()).toBe(0);
  expect(db.state()).toEqual(db.initial); expect(db.events).not.toContain('balance');
});
