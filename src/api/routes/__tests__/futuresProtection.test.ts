process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import BigNumber from 'bignumber.js';
import { futuresRouter } from '../futures';
import { NotFound, Conflict, MarkPriceUnavailable } from '../../../futures/FuturesProtectionService';

/**
 * The HTTP contract for futures TP/SL, and the two things a REST surface
 * over other people's money has to get right: nobody may read or change
 * another account's protection, and a position that is not yours must be
 * indistinguishable from one that does not exist.
 *
 * The routes are exercised through the real router with the real auth
 * middleware. Only the services behind them are doubled.
 */

const authHeader = (userId: string) => `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;

const POSITION = {
  id: 'pos-1',
  userId: 'owner',
  symbol: 'BTC/USDT',
  side: 'LONG',
  size: '2',
  entryPrice: '100000',
  leverage: 10,
  marginType: 'ISOLATED',
  initialMargin: '20000',
  liquidationPrice: '91000',
  status: 'OPEN',
  realizedPnl: '0',
  openedAt: new Date('2026-09-10T00:00:00Z'),
};

const TRIGGER = {
  id: 'prot-1',
  kind: 'TAKE_PROFIT',
  triggerPrice: '110000',
  status: 'PENDING',
  lastError: null,
  attempts: 0,
  createdAt: new Date('2026-09-10T00:00:00Z'),
  updatedAt: new Date('2026-09-10T00:00:00Z'),
};

function makeApp(overrides: { protection?: any } = {}) {
  const prisma = {
    apiKey: { findUnique: jest.fn(async () => null), update: jest.fn() },
    futuresPosition: {
      findMany: jest.fn(async ({ where }: any) => (where.userId === 'owner' ? [{ ...POSITION }] : [])),
      findUnique: jest.fn(async ({ where: { id } }: any) => (id === 'pos-1' ? { ...POSITION } : null)),
    },
    futuresBalance: { findMany: jest.fn(async () => []) },
  } as any;

  const markPriceService = { getMarkPrice: jest.fn(async () => new BigNumber('105000')), getIndexPrice: jest.fn(async () => new BigNumber('105000')) } as any;
  const positionService = { placeOrder: jest.fn() } as any;
  const marketRegistry = { list: () => ['BTC/USDT'], has: () => true } as any;

  const own = (userId: string, positionId: string) => userId === 'owner' && positionId === 'pos-1';
  const protectionService = {
    getProtection: jest.fn(async (userId: string, positionId: string) =>
      own(userId, positionId) ? { positionId, takeProfit: { ...TRIGGER }, stopLoss: null } : null
    ),
    setProtection: jest.fn(async (userId: string, positionId: string, input: any) => {
      if (!own(userId, positionId)) throw new NotFound('Position not found or not open');
      if (input.takeProfit && input.takeProfit.isLessThan(new BigNumber('105000'))) {
        throw new Error('takeProfit must be above the current mark price for a LONG position');
      }
      return {
        positionId,
        takeProfit: input.takeProfit ? { ...TRIGGER, triggerPrice: input.takeProfit.toString() } : null,
        stopLoss: input.stopLoss ? { ...TRIGGER, id: 'prot-2', kind: 'STOP_LOSS', triggerPrice: input.stopLoss.toString() } : null,
      };
    }),
    clearProtection: jest.fn(async (userId: string, positionId: string) => {
      if (!own(userId, positionId)) throw new NotFound('Position not found');
    }),
    activeProtectionByPosition: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { takeProfit: { ...TRIGGER }, stopLoss: null }]))),
    ...overrides.protection,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1', futuresRouter(prisma, {} as any, positionService, markPriceService, marketRegistry, protectionService as any));
  return { app, protectionService, positionService };
}

const URL = '/api/v1/futures/positions/pos-1/protection';

describe('GET protection', () => {
  it('returns the owner’s real server-held triggers', async () => {
    const { app } = makeApp();
    const res = await request(app).get(URL).set('Authorization', authHeader('owner'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ positionId: 'pos-1', takeProfit: { triggerPrice: '110000', status: 'PENDING' }, stopLoss: null });
  });

  it('is 401 without a session', async () => {
    const { app, protectionService } = makeApp();
    expect((await request(app).get(URL)).status).toBe(401);
    expect(protectionService.getProtection).not.toHaveBeenCalled();
  });

  it('is 404 for another user, exactly as for a position that does not exist', async () => {
    const { app } = makeApp();
    const other = await request(app).get(URL).set('Authorization', authHeader('intruder'));
    const missing = await request(app)
      .get('/api/v1/futures/positions/no-such-position/protection')
      .set('Authorization', authHeader('owner'));

    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    // Identical, so the status code cannot be used to probe for positions.
    expect(other.body).toEqual(missing.body);
  });
});

describe('PUT protection', () => {
  it('sets take profit and stop loss together', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).put(URL).set('Authorization', authHeader('owner'))
      .send({ takeProfit: '120000', stopLoss: '95000' });

    expect(res.status).toBe(200);
    expect(res.body.takeProfit.triggerPrice).toBe('120000');
    expect(res.body.stopLoss.triggerPrice).toBe('95000');
    const [, , input] = protectionService.setProtection.mock.calls[0];
    expect(input.takeProfit.toString()).toBe('120000');
    expect(input.stopLoss.toString()).toBe('95000');
  });

  it('sets one side only, and an omitted side is an explicit null', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).put(URL).set('Authorization', authHeader('owner')).send({ stopLoss: '95000' });

    expect(res.status).toBe(200);
    expect(res.body.takeProfit).toBeNull();
    // PUT replaces the whole protection, so leaving a side out removes it.
    expect(protectionService.setProtection.mock.calls[0][2].takeProfit).toBeNull();
  });

  it('removes one side with an explicit null', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).put(URL).set('Authorization', authHeader('owner'))
      .send({ takeProfit: null, stopLoss: '95000' });

    expect(res.status).toBe(200);
    expect(res.body.takeProfit).toBeNull();
    expect(protectionService.setProtection.mock.calls[0][2].takeProfit).toBeNull();
  });

  it('rejects a non-positive price at the schema, before any service call', async () => {
    const { app, protectionService } = makeApp();
    for (const bad of ['0', '-5']) {
      const res = await request(app).put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: bad });
      expect(res.status).toBe(400);
    }
    expect(protectionService.setProtection).not.toHaveBeenCalled();
  });

  it('surfaces a domain rejection as 400 with its reason', async () => {
    const { app } = makeApp();
    const res = await request(app).put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: '90000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/above the current mark price/);
  });

  it('is 404 for another user, and their input never reaches the service twice', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).put(URL).set('Authorization', authHeader('intruder')).send({ takeProfit: '120000' });
    expect(res.status).toBe(404);
    expect(protectionService.setProtection).toHaveBeenCalledTimes(1);
    expect(protectionService.setProtection.mock.calls[0][0]).toBe('intruder');
  });

  it('is 401 without a session', async () => {
    const { app, protectionService } = makeApp();
    expect((await request(app).put(URL).send({ takeProfit: '120000' })).status).toBe(401);
    expect(protectionService.setProtection).not.toHaveBeenCalled();
  });
});

describe('DELETE protection', () => {
  it('removes both sides for the owner', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).delete(URL).set('Authorization', authHeader('owner'));
    expect(res.status).toBe(204);
    expect(protectionService.clearProtection).toHaveBeenCalledWith('owner', 'pos-1');
  });

  it('is 404 for another user and 401 with no session', async () => {
    const { app, protectionService } = makeApp();
    expect((await request(app).delete(URL).set('Authorization', authHeader('intruder'))).status).toBe(404);
    expect((await request(app).delete(URL)).status).toBe(401);
    expect(protectionService.clearProtection).toHaveBeenCalledTimes(1);
  });
});

describe('the positions list carries protection so the client needs no second poll', () => {
  it('every row has a protection object', async () => {
    const { app, protectionService } = makeApp();
    const res = await request(app).get('/api/v1/futures/positions').set('Authorization', authHeader('owner'));

    expect(res.status).toBe(200);
    expect(res.body[0].protection).toMatchObject({ takeProfit: { triggerPrice: '110000' }, stopLoss: null });
    // ONE lookup for the whole list, not one per row.
    expect(protectionService.activeProtectionByPosition).toHaveBeenCalledTimes(1);
    expect(protectionService.activeProtectionByPosition).toHaveBeenCalledWith(['pos-1']);
  });

  it('a row with no protection reports both sides null rather than omitting the field', async () => {
    const { app } = makeApp({ protection: { activeProtectionByPosition: jest.fn(async () => new Map()) } });
    const res = await request(app).get('/api/v1/futures/positions').set('Authorization', authHeader('owner'));
    expect(res.body[0].protection).toEqual({ takeProfit: null, stopLoss: null });
  });

  it('and every pre-existing position field is still there, unchanged', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/futures/positions').set('Authorization', authHeader('owner'));
    expect(res.body[0]).toMatchObject({
      id: 'pos-1', symbol: 'BTC/USDT', side: 'LONG', size: '2', entryPrice: '100000',
      leverage: 10, marginType: 'ISOLATED', initialMargin: '20000', liquidationPrice: '91000',
      markPrice: '105000',
    });
    expect(res.body[0].unrealizedPnl).toBe('10000');
  });
});

describe('the error contract carries a machine-readable code', () => {
  const failing = (error: Error) => makeApp({
    protection: {
      setProtection: jest.fn(async () => { throw error; }),
      clearProtection: jest.fn(async () => { throw error; }),
    },
  });

  it('a trigger mid-execution is 409 PROTECTION_TRIGGERING, on PUT and DELETE alike', async () => {
    const conflict = new Conflict("This position's stop loss is executing right now; protection cannot be changed until it settles");

    const put = await request(failing(conflict).app).put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: '120000' });
    expect(put.status).toBe(409);
    expect(put.body).toMatchObject({ code: 'PROTECTION_TRIGGERING' });
    expect(put.body.error).toMatch(/executing right now/);

    const del = await request(failing(conflict).app).delete(URL).set('Authorization', authHeader('owner'));
    expect(del.status).toBe(409);
    expect(del.body).toMatchObject({ code: 'PROTECTION_TRIGGERING' });
    // A DELETE that conflicts must NOT answer 204 — that would tell the
    // trader their protection was cancelled when it is firing.
    expect(del.status).not.toBe(204);
  });

  it('no mark price is 503 MARK_PRICE_UNAVAILABLE, not a 400 that blames the trader', async () => {
    const unavailable = new MarkPriceUnavailable('No authoritative mark price for BTC/USDT; protection was not changed');
    const res = await request(failing(unavailable).app).put(URL).set('Authorization', authHeader('owner')).send({ stopLoss: '95000' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'MARK_PRICE_UNAVAILABLE' });
  });

  it('not-found stays 404, and a bad instruction stays 400 — each with its own code', async () => {
    const missing = await request(failing(new NotFound('Position not found or not open')).app)
      .put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: '120000' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });

    const bad = await request(failing(new Error('takeProfit must be above the current mark price for a LONG position')).app)
      .put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: '120000' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: 'INVALID_PROTECTION' });
  });

  it('all four codes are distinct, so a client can branch on them', async () => {
    const codes = new Set<string>();
    for (const [error] of [[new NotFound('x')], [new Conflict('x')], [new MarkPriceUnavailable('x')], [new Error('x')]] as const) {
      const res = await request(failing(error as Error).app).put(URL).set('Authorization', authHeader('owner')).send({ takeProfit: '120000' });
      codes.add(res.body.code);
    }
    expect(codes.size).toBe(4);
  });
});

describe('the protection routes are futures-only', () => {
  const source = require('fs').readFileSync(require('path').resolve(__dirname, '../futures.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the router never touches the spot conditional-order surface', () => {
    for (const spot of ['PENDING_TRIGGER', 'updateOrderTrigger', 'ocoGroupId', "'/orders/me'", 'orderRouter']) {
      expect(code).not.toContain(spot);
    }
  });

  it('the protection paths are under /futures/positions', () => {
    expect(code).toContain("'/futures/positions/:positionId/protection'");
    expect(code.match(/futures\/positions\/:positionId\/protection/g)).toHaveLength(3);
  });
});
