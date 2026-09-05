process.env.JWT_SECRET = 'test-secret-at-least-this-long';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { CardApplicationService } from '../../../services/CardApplicationService';
import { cardRouter } from '../card';

const userId = 'user-1';
const authHeader = () => `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
const deposit = (amount: string, asset = 'USDT') => ({ asset, amount });
const trade = (notional: string, extra = {}) => ({ pair: 'BTC/USDT', price: notional, quantity: '1', takerUserId: userId, makerUserId: 'counterparty', ...extra });

function fixture({ kyc = 'APPROVED', deposits = [] as any[], trades = [] as any[], application = null as any, quotes = new Map<string, number | null>([['USDT', 1], ['USD', 1]]) } = {}) {
  const state = { application };
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: userId, kycStatus: kyc, blockedAt: null, cardWaitlistJoinedAt: new Date('2025-01-01') }), update: jest.fn() },
    deposit: { findMany: jest.fn().mockResolvedValue(deposits) },
    trade: { findMany: jest.fn().mockResolvedValue(trades) },
    cardApplication: {
      findUnique: jest.fn().mockImplementation(async () => state.application),
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (state.application) throw Object.assign(new Error('Unique user'), { code: 'P2002' });
        state.application = { id: 'application-1', submittedAt: new Date('2026-09-05T12:00:00Z'), ...data };
        return state.application;
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    session: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  prisma.$transaction = jest.fn().mockImplementation((callback) => callback(prisma));
  const priceSource = { pricesFor: jest.fn().mockResolvedValue(quotes) };
  const service = new CardApplicationService(prisma, priceSource);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', cardRouter(prisma, priceSource));
  app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'Internal server error' }));
  return { prisma, priceSource, service, app, state };
}

describe('real card eligibility', () => {
  test.each([
    ['A', 'PENDING', '4999', '49999', false], ['B', 'APPROVED', '4999', '49999', false],
    ['C', 'APPROVED', '5000', '0', true], ['D', 'APPROVED', '0', '50000', true],
    ['E', 'APPROVED', '5000', '50000', true], ['F', 'PENDING', '5000', '50000', false],
  ])('%s: KYC=%s deposit=%s volume=%s gives eligible=%s', async (_case, kyc, amount, volume, expected) => {
    const { service } = fixture({ kyc, deposits: [deposit(amount)], trades: volume === '0' ? [] : [trade(volume)] });
    const result = await service.getSnapshot(userId);
    expect(result.eligibility.eligible).toBe(expected);
    expect(result.application).toBeNull(); // legacy interest is never an application
  });

  it('never rounds an amount immediately below a threshold into eligibility', async () => {
    const { service } = fixture({ deposits: [deposit('4999.999999999999999999')], trades: [trade('49999.999999999999999999')] });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: false, depositEligible: false, tradingVolumeEligible: false, qualifyingDepositUsd: 4999.99, qualifyingTradingVolumeUsd: 49999.99 });
  });

  it('uses all credited deposits and executed trades without inventing a date window', async () => {
    const { service, prisma } = fixture({ deposits: [deposit('3000'), deposit('2000')], trades: [trade('25000'), trade('25000', { makerUserId: userId, takerUserId: 'counterparty' })] });
    const result = await service.getSnapshot(userId);
    expect(result.eligibility).toMatchObject({ qualifyingDepositUsd: 5000, qualifyingTradingVolumeUsd: 50000, eligible: true });
    expect(prisma.deposit.findMany.mock.calls[0][0].where).toEqual({ userId, status: 'CREDITED' });
    expect(prisma.trade.findMany.mock.calls[0][0].where).toEqual({ OR: [
      { takerUserId: userId, makerUserId: { not: userId } }, { makerUserId: userId, takerUserId: { not: userId } },
    ] });
    expect(result.eligibility.valuation).toMatchObject({ depositBasis: 'CUMULATIVE_CREDITED_DEPOSITS', tradingVolumeBasis: 'ALL_PERSISTED_EXECUTED_TRADES', conversion: 'CURRENT_USD_QUOTES' });
  });

  it('excludes self-trades and unrelated counterparties defensively', async () => {
    const { service } = fixture({ trades: [trade('500000', { makerUserId: userId }), trade('100000', { makerUserId: 'other', takerUserId: 'someone' }), trade('17')] });
    expect((await service.getSnapshot(userId)).eligibility.qualifyingTradingVolumeUsd).toBe(17);
  });

  it('values asset quantities and executed quote notionals using injected real quotes', async () => {
    const { service, priceSource } = fixture({ deposits: [deposit('0.1', 'BTC')], trades: [trade('40000', { pair: 'BTC/EUR' })], quotes: new Map([['BTC', 50000], ['EUR', 1.25]]) });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ qualifyingDepositUsd: 5000, qualifyingTradingVolumeUsd: 50000, depositValuationComplete: true, tradingVolumeValuationComplete: true });
    expect(priceSource.pricesFor).toHaveBeenCalledWith(expect.arrayContaining(['BTC', 'EUR']));
  });

  test.each([null, 0, -1, NaN, Infinity])('unavailable/invalid price %s never qualifies an unknown amount', async (price) => {
    const { service, prisma } = fixture({ deposits: [deposit('100000', 'BTC')], trades: [trade('100000', { pair: 'BTC/EUR' })], quotes: new Map([['BTC', price], ['EUR', price]]) });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: false, qualifyingDepositUsd: 0, qualifyingTradingVolumeUsd: 0, depositValuationComplete: false, tradingVolumeValuationComplete: false });
    await expect(service.submit(userId, 'TITANIUM')).rejects.toMatchObject({ statusCode: 503, code: 'CARD_VALUATION_UNAVAILABLE' });
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });

  it('known qualifying deposits satisfy OR while unknown volume is incomplete', async () => {
    const { service } = fixture({ deposits: [deposit('5000')], trades: [trade('500000', { pair: 'BTC/UNKNOWN' })] });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: true, tradingVolumeValuationComplete: false, qualifyingTradingVolumeUsd: 0 });
  });

  it('fails closed on an upstream price provider failure', async () => {
    const { service, priceSource } = fixture({ deposits: [deposit('5000')] });
    priceSource.pricesFor.mockRejectedValue(new Error('feed unavailable'));
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: false, depositValuationComplete: false });
  });

  it('zero credited quantity is conclusively zero without an asset price', async () => {
    const { service } = fixture({ deposits: [deposit('0', 'UNKNOWN')] });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: false, qualifyingDepositUsd: 0, depositValuationComplete: true });
  });

  it('excludes invalid/negative ledger amounts and negative × negative trade notional', async () => {
    const { service } = fixture({ deposits: [deposit('-5000')], trades: [trade('-50000', { quantity: '-1' }), trade('99999', { pair: 'BROKEN' })] });
    expect((await service.getSnapshot(userId)).eligibility).toMatchObject({ eligible: false, qualifyingDepositUsd: 0, qualifyingTradingVolumeUsd: 0 });
  });
});

describe('persisted card applications', () => {
  it('writes a submitted request plus audit in a serializable transaction and replays unchanged', async () => {
    const { service, prisma, state } = fixture({ deposits: [deposit('5000')] });
    const first = await service.submit(userId, 'TITANIUM');
    expect((await service.submit(userId, 'TITANIUM')).application).toEqual(first.application);
    expect(first.application).toMatchObject({ id: 'application-1', product: 'TITANIUM', status: 'SUBMITTED' });
    expect(prisma.cardApplication.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(state.application.eligibilitySnapshot.eligible).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not mutate the product on a replay with a different product', async () => {
    const { service } = fixture({ deposits: [deposit('5000')] });
    await service.submit(userId, 'TITANIUM');
    await expect(service.submit(userId, 'BLACK_SIGNATURE')).rejects.toMatchObject({ statusCode: 409, code: 'CARD_APPLICATION_ALREADY_EXISTS', snapshot: { application: { product: 'TITANIUM' } } });
  });

  it('concurrent submits return one request and one audit event', async () => {
    const { service, prisma, state } = fixture({ deposits: [deposit('5000')] });
    const results = await Promise.all([service.submit(userId, 'TITANIUM'), service.submit(userId, 'TITANIUM')]);
    expect(results[0].application).toEqual(results[1].application);
    expect(state.application.id).toBe('application-1');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('retries serialization conflict with a bounded retry limit', async () => {
    const { service, prisma } = fixture({ deposits: [deposit('5000')] });
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('retry'), { code: 'P2034' }));
    expect((await service.submit(userId, 'TITANIUM')).application?.status).toBe('SUBMITTED');
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('retry'), { code: 'P2034' }));
    await expect(service.submit(userId, 'TITANIUM')).rejects.toMatchObject({ code: 'P2034' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('rechecks KYC inside the transaction after the earlier price read', async () => {
    const { service, prisma } = fixture({ deposits: [deposit('5000')] });
    prisma.user.findUnique.mockResolvedValueOnce({ id: userId, kycStatus: 'APPROVED', blockedAt: null });
    prisma.user.findUnique.mockResolvedValue({ id: userId, kycStatus: 'REJECTED', blockedAt: null });
    await expect(service.submit(userId, 'TITANIUM')).rejects.toMatchObject({ code: 'CARD_NOT_ELIGIBLE' });
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });
});

describe('card API authorization and validation', () => {
  it('rejects anonymous and revoked sessions before loading financial data', async () => {
    const { app, prisma } = fixture();
    expect((await request(app).get('/api/v1/card/application/me')).status).toBe(401);
    expect((await request(app).post('/api/v1/card/application').send({ product: 'TITANIUM' })).status).toBe(401);
    const revoked = `Bearer ${jwt.sign({ sub: userId, sid: 'revoked' }, process.env.JWT_SECRET!)}`;
    expect((await request(app).get('/api/v1/card/application/me').set('Authorization', revoked)).status).toBe(401);
    expect(prisma.deposit.findMany).not.toHaveBeenCalled();
  });

  it('rejects a signed token without an account subject before any user lookup', async () => {
    const { app, prisma } = fixture();
    const token = `Bearer ${jwt.sign({}, process.env.JWT_SECRET!)}`;
    expect((await request(app).get('/api/v1/card/application/me').set('Authorization', token)).status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test.each([{}, { product: 'ICY_WHITE' }, { product: 'TITANIUM', userId: 'another-user' }, { product: 'TITANIUM', eligible: true }, { product: ['TITANIUM'] }])('rejects invalid/forged body %j', async (body) => {
    const { app, prisma } = fixture({ deposits: [deposit('5000')] });
    expect((await request(app).post('/api/v1/card/application').set('Authorization', authHeader()).send(body)).status).toBe(400);
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });

  it('persists only for the authenticated account and returns that request via GET', async () => {
    const { app, prisma } = fixture({ trades: [trade('50000')] });
    const post = await request(app).post('/api/v1/card/application').set('Authorization', authHeader()).send({ product: 'BLACK_SIGNATURE' });
    expect(post.status).toBe(200);
    expect(post.body.application.status).toBe('SUBMITTED');
    const get = await request(app).get('/api/v1/card/application/me').set('Authorization', authHeader());
    expect(get.body.application).toEqual(post.body.application);
    expect(get.headers['cache-control']).toBe('no-store');
    expect(prisma.cardApplication.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId }) }));
  });

  it('returns eligibility when denying an ineligible application without persisting', async () => {
    const { app, prisma } = fixture();
    const result = await request(app).post('/api/v1/card/application').set('Authorization', authHeader()).send({ product: 'TITANIUM' });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: 'CARD_NOT_ELIGIBLE', application: null, eligibility: { eligible: false } });
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });

  it('does not treat a blocked/missing account as eligible', async () => {
    const { app, prisma } = fixture({ deposits: [deposit('5000')] });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).get('/api/v1/card/application/me').set('Authorization', authHeader())).status).toBe(404);
    prisma.user.findUnique.mockResolvedValue({ id: userId, kycStatus: 'APPROVED', blockedAt: new Date() });
    expect((await request(app).post('/api/v1/card/application').set('Authorization', authHeader()).send({ product: 'TITANIUM' })).status).toBe(403);
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });

  it('retains old interest history without converting it to a request', async () => {
    const { app, prisma } = fixture();
    const legacy = await request(app).get('/api/v1/card/waitlist/me').set('Authorization', authHeader());
    expect(legacy.body.joined).toBe(true);
    const current = await request(app).get('/api/v1/card/application/me').set('Authorization', authHeader());
    expect(current.body.application).toBeNull();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.cardApplication.create).not.toHaveBeenCalled();
  });
});
