/**
 * THE OWNER ACCOUNT CANNOT REACH THE REAL MATCHING ENGINE.
 *
 * The account has no Real/Demo switch and no `?demo=1` to drop, so the only
 * thing standing between it and a real futures order is a SERVER policy. An
 * edited frontend, a replayed request or a hand-written curl all arrive at
 * the same routes these tests exercise.
 *
 * The real service is deliberately a throwing stub: if any guarded route
 * ever reaches it, the test fails loudly rather than quietly asserting a
 * status code that happened to match.
 */
import express from 'express';
import request from 'supertest';
import { futuresRouter } from '../../api/routes/futures';
import { isSimulationOnlyUser } from '../access';

const OWNER = 'owner-user-id';
const OTHER = 'ordinary-user-id';

jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (req: any, _res: any, next: any) => { req.userId = req.headers['x-test-user']; next(); },
  requireTradePermission: (_req: any, _res: any, next: any) => next(),
}));

const reached: string[] = [];
const explode = (name: string) => (..._args: unknown[]) => {
  reached.push(name);
  throw new Error(`REAL ENGINE REACHED: ${name}`);
};

function app() {
  const positionService: any = {
    placeOrder: explode('placeOrder'), cancelOrder: explode('cancelOrder'),
    closePosition: explode('closePosition'), transfer: explode('transfer'),
  };
  const protection: any = {
    setProtection: explode('setProtection'), clearProtection: explode('clearProtection'),
    activeProtectionByPosition: async () => new Map(),
  };
  const prisma: any = new Proxy({}, { get: () => new Proxy({}, { get: () => explode('prisma') }) });
  const registry: any = { list: () => ['BTC/USDT'], has: (s: string) => s === 'BTC/USDT' };
  const marks: any = { getMarkPrice: async () => null };
  const server = express();
  server.use(express.json());
  server.use(futuresRouter(prisma, {} as any, positionService, marks, registry, protection));
  return server;
}

const WRITES = [
  ['post', '/futures/orders', { symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1', leverage: 10, marginType: 'CROSS' }],
  ['delete', '/futures/orders/some-order-id', undefined],
  ['post', '/futures/positions/some-position-id/close', {}],
  ['put', '/futures/positions/some-position-id/protection', { takeProfit: '70000' }],
  ['delete', '/futures/positions/some-position-id/protection', undefined],
  ['post', '/futures/transfer', { direction: 'SPOT_TO_FUTURES', asset: 'USDT', amount: '10' }],
] as const;

beforeEach(() => {
  reached.length = 0;
  process.env.PRIVATE_TRADING_ENABLED = 'true';
  process.env.PRIVATE_TRADING_OWNER_ID = OWNER;
});
afterAll(() => { delete process.env.PRIVATE_TRADING_ENABLED; delete process.env.PRIVATE_TRADING_OWNER_ID; });

describe('the simulation-only account never reaches the real futures engine', () => {
  test.each(WRITES)('%s %s is refused for the pinned owner', async (method, path, body) => {
    const call = (request(app()) as any)[method](path).set('x-test-user', OWNER);
    const res = await (body ? call.send(body) : call);
    expect(res.status).toBe(403);
    // The refusal happened BEFORE any service call: nothing was written.
    expect(reached).toEqual([]);
  });

  test('the refusal does not depend on the request body, so a crafted payload cannot pass', async () => {
    for (const body of [{}, { symbol: 'BTC/USDT' }, { demo: false }, { simulation: false }]) {
      const res = await request(app()).post('/futures/orders').set('x-test-user', OWNER).send(body as any);
      expect(res.status).toBe(403);
    }
    expect(reached).toEqual([]);
  });

  test('an ordinary user is NOT blocked — the guard reaches the real engine for everyone else', async () => {
    const res = await request(app()).post('/futures/orders').set('x-test-user', OTHER)
      .send({ symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1', leverage: 10, marginType: 'CROSS' });
    // It got past the guard: the stub threw, which is the proof.
    expect(res.status).not.toBe(403);
    expect(reached).toContain('placeOrder');
  });
});

describe('the policy itself', () => {
  test('only the pinned owner, and only while the feature is enabled', () => {
    expect(isSimulationOnlyUser(OWNER)).toBe(true);
    expect(isSimulationOnlyUser(OTHER)).toBe(false);
    expect(isSimulationOnlyUser(undefined)).toBe(false);
    expect(isSimulationOnlyUser('')).toBe(false);
    process.env.PRIVATE_TRADING_ENABLED = 'false';
    expect(isSimulationOnlyUser(OWNER)).toBe(false);
    process.env.PRIVATE_TRADING_ENABLED = 'true';
    process.env.PRIVATE_TRADING_OWNER_ID = '';
    // An unset owner must not turn every user into a simulation account.
    expect(isSimulationOnlyUser(OWNER)).toBe(false);
    expect(isSimulationOnlyUser('')).toBe(false);
  });
});
