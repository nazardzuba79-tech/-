import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import BigNumber from 'bignumber.js';

// The real API-key middleware requires a server encryption key at import.
// This fixture never decrypts a key or connects to a database/provider.
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
const { futuresRouter } = require('../futures') as typeof import('../futures');

const USER = 'refusal-code-trader';
const bearer = () => `Bearer ${jwt.sign({ sub: USER, sid: 'fixture-session' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;

/**
 * 2026-10-13 audit: a market close against a thin book came back as
 * `400 { error: 'Insufficient market liquidity…' }` with no code, and the
 * client — which shows only sentences it composed — read it as the
 * generic «Не удалось закрыть позицию». The sentence stays; a known
 * refusal now carries a code beside it. Unknown refusals stay code-less.
 */
function fixture(placeOrder: jest.Mock) {
  const db = {
    session: { findUnique: jest.fn(async () => ({ id: 'fixture-session', userId: USER, revokedAt: null, lastSeenAt: new Date() })) },
    apiKey: { findUnique: jest.fn() },
    futuresPosition: {
      findUnique: jest.fn(async () => ({ id: 'pos-1', userId: USER, status: 'OPEN', symbol: 'BTC/USDT', side: 'LONG', size: new BigNumber('0.01'), leverage: 10, marginType: 'ISOLATED' })),
    },
  };
  const positions = { placeOrder };
  const app = express().use(express.json()).use('/api/v1', futuresRouter(
    db as any, {} as any, positions as any, {} as any,
    { list: () => ['BTC/USDT'], has: (symbol: string) => symbol === 'BTC/USDT' } as any, {} as any
  ));
  return { app, placeOrder };
}

const liquidity = () => new Error('Insufficient market liquidity for requested quantity');

it('a quick close refused for a thin book answers 400 with the sentence AND the code', async () => {
  const f = fixture(jest.fn(async () => { throw liquidity(); }));
  const response = await request(f.app).post('/api/v1/futures/positions/pos-1/close').set('Authorization', bearer());
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: 'Insufficient market liquidity for requested quantity', code: 'INSUFFICIENT_LIQUIDITY' });
  // The close is the same reduce-only MARKET path as every other order.
  expect(f.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, symbol: 'BTC/USDT', side: 'SELL', type: 'MARKET', reduceOnly: true }));
});

it('a market order refused for a thin book carries the same code', async () => {
  const f = fixture(jest.fn(async () => { throw liquidity(); }));
  const response = await request(f.app).post('/api/v1/futures/orders').set('Authorization', bearer())
    .send({ symbol: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: '0.01', leverage: 10, marginType: 'ISOLATED' });
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: 'Insufficient market liquidity for requested quantity', code: 'INSUFFICIENT_LIQUIDITY' });
});

it('a self-match is named too, and an unknown refusal keeps its sentence with no code', async () => {
  const self = fixture(jest.fn(async () => { throw new Error('Futures self-match is not allowed'); }));
  expect((await request(self.app).post('/api/v1/futures/positions/pos-1/close').set('Authorization', bearer())).body)
    .toEqual({ error: 'Futures self-match is not allowed', code: 'SELF_MATCH' });
  const other = fixture(jest.fn(async () => { throw new Error('Invalid staged Futures match'); }));
  const response = await request(other.app).post('/api/v1/futures/positions/pos-1/close').set('Authorization', bearer());
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: 'Invalid staged Futures match' });
});
