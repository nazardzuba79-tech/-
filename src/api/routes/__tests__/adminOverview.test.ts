process.env.JWT_SECRET = 'test-secret-at-least-this-long';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminRouter } from '../admin';
import { adminWalletsRouter } from '../adminWallets';

const authorization = `Bearer ${jwt.sign({ sub: 'admin' }, process.env.JWT_SECRET!)}`;
const mockDb = () => ({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), count: jest.fn().mockResolvedValueOnce(83).mockResolvedValueOnce(4) }, withdrawal: { count: jest.fn().mockResolvedValue(2) }, auditLog: { count: jest.fn().mockResolvedValue(7) } });
const appFor = (db: any) => express().use('/api/v1', adminRouter(db));

test('overview requires authentication and an admin before aggregate reads', async () => {
  const db = mockDb();
  expect((await request(appFor(db)).get('/api/v1/admin/overview')).status).toBe(401);
  db.user.findUnique.mockResolvedValue({ role: 'USER' });
  expect((await request(appFor(db)).get('/api/v1/admin/overview').set('Authorization', authorization)).status).toBe(403);
  expect(db.user.count).not.toHaveBeenCalled();
});
test('real aggregate counts, UTC credit-event window, no incoming zero invented', async () => {
  const db = mockDb();
  const res = await request(appFor(db)).get('/api/v1/admin/overview').set('Authorization', authorization);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ totalUsers: 83, pendingKyc: 4, pendingWithdrawals: 2, creditedDepositsToday: 7, unmatchedIncoming: null });
  expect(db.user.count).toHaveBeenNthCalledWith(2, { where: { kycStatus: 'PENDING' } });
  expect(db.withdrawal.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
  expect(db.auditLog.count).toHaveBeenCalledWith({ where: { action: 'DEPOSIT_CREDITED', createdAt: { gte: new Date(res.body.dayStart), lte: new Date(res.body.asOf) } } });
  expect(res.body.dayStart).toMatch(/T00:00:00.000Z$/);
  expect(Object.keys(res.body).sort()).toEqual(['totalUsers', 'pendingKyc', 'pendingWithdrawals', 'creditedDepositsToday', 'unmatchedIncoming', 'unmatchedIncomingReason', 'dayStart', 'asOf'].sort());
});
test('database failure is unavailable, never zero or exception/secret output', async () => {
  const db = mockDb(); db.auditLog.count.mockRejectedValue(new Error('private-db-url'));
  const res = await request(appFor(db)).get('/api/v1/admin/overview').set('Authorization', authorization);
  expect(res.status).toBe(503);
  expect(res.body).toEqual({ error: 'Admin overview temporarily unavailable' });
});
test('wallet display config exposes public reset target and actual native capability only', async () => {
  const saved = { ...process.env };
  try {
    process.env.TRON_NATIVE_ASSET = 'TRX'; process.env.TRON_TOKENS = 'USDT:contract:6';
    process.env.TRON_TREASURY_ADDRESS = 'public-default'; process.env.TRON_API_KEY = 'hidden-api-key';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC'; process.env.BITCOIN_TOKENS = 'FAKE:contract:6';
    const db: any = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) }, treasuryWallet: { findMany: jest.fn().mockResolvedValue([{ chain: 'tron', address: 'public-override' }]) } };
    const res = await request(express().use('/api/v1', adminWalletsRouter(db))).get('/api/v1/admin/wallets').set('Authorization', authorization);
    expect(res.body.find((w: any) => w.chain === 'tron')).toMatchObject({ address: 'public-override', defaultAddress: 'public-default', nativeDepositsSupported: false, tokens: ['USDT'] });
    expect(res.body.find((w: any) => w.chain === 'bitcoin')).toMatchObject({ nativeDepositsSupported: true, tokens: [] });
    expect(res.text).not.toContain('hidden-api-key'); expect(res.text).not.toContain('contract');
  } finally { process.env = saved; }
});
