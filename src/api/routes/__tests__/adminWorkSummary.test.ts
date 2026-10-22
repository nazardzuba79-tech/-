process.env.JWT_SECRET = 'admin-summary-fixture-no-production';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { adminDepositsRouter } from '../adminDeposits';
import { DepositQueueService } from '../../../services/deposits/DepositQueueService';

afterEach(() => jest.restoreAllMocks());
function fixture() {
  const queue = jest.spyOn(DepositQueueService.prototype, 'load').mockResolvedValue({ counts: { truncated: false }, packageCounts: { READY: 2, AWAITING_TOPUP: 3, NEEDS_REVIEW: 1 } } as any);
  const prisma: any = { user: { findUnique: jest.fn(async () => ({ id: 'admin', role: 'ADMIN' })), count: jest.fn(async () => 4) },
    deposit: { count: jest.fn(async () => 7), findFirst: jest.fn(async () => ({ id: 'deposit' })) },
    withdrawal: { count: jest.fn(async () => 5), findFirst: jest.fn(async () => ({ id: 'withdrawal' })) },
    kycSubmission: { findFirst: jest.fn(async () => ({ id: 'kyc' })) }, otcCashRequest: { count: jest.fn(async () => 6) } };
  const app = express(); app.use('/api/v1', adminDepositsRouter(prisma, {} as any));
  const auth = `Bearer ${jwt.sign({ sub: 'admin' }, process.env.JWT_SECRET!)}`;
  return { app, prisma, queue, auth };
}
test('compact work summary counts packages separately from unlinked transfers; no history payload', async () => {
  const { app, auth, prisma, queue } = fixture();
  const r = await request(app).get('/api/v1/admin/work-summary').set('Authorization', auth);
  expect(r.status).toBe(200);
  expect(r.body.widgets.readyPackages).toMatchObject({ value: 2, status: 'ready', unit: 'packages' });
  expect(r.body.widgets.pendingPackages.value).toBe(6);
  expect(r.body.widgets.unlinkedTransfers).toMatchObject({ value: 7, unit: 'transfers' });
  expect(r.body.widgets.activeWithdrawals).toMatchObject({ value: 5, unit: 'withdrawals' });
  expect(prisma.withdrawal.count).toHaveBeenCalledWith({ where: { status: { in: ['PENDING', 'APPROVED'] } } });
  expect(queue).toHaveBeenCalledWith({ customerActivityOnly: true });
  expect(r.body.packages).toBeUndefined(); expect(r.body.rows).toBeUndefined();
  expect(r.headers['cache-control']).toBe('private, no-store');
  expect(r.body.alerts).toEqual({ depositId: 'deposit', withdrawalId: 'withdrawal', kycId: 'kyc' });
});
test('a widget failure is unknown not zero, preserves independent counters and server recovers', async () => {
  const { app, auth, prisma } = fixture();
  prisma.withdrawal.count.mockRejectedValueOnce(new Error('fixture unavailable'));
  const r = await request(app).get('/api/v1/admin/work-summary').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body.widgets.activeWithdrawals).toMatchObject({ value: null, status: 'unavailable' });
  expect(r.body.widgets.readyPackages.value).toBe(2);
  expect((await request(app).get('/api/v1/admin/work-summary').set('Authorization', auth)).body.widgets.activeWithdrawals.value).toBe(5);
});
test('truncated deposit queue never presents a partial package count as exact', async () => {
  const { app, auth, queue } = fixture();
  queue.mockResolvedValueOnce({ counts: { truncated: true }, packageCounts: { READY: 999, AWAITING_TOPUP: 1, NEEDS_REVIEW: 0 } } as any);
  const r = await request(app).get('/api/v1/admin/work-summary').set('Authorization', auth);
  expect(r.body.widgets.readyPackages).toMatchObject({ value: null, status: 'unavailable' });
  expect(r.body.widgets.unlinkedTransfers.value).toBe(7);
});
test('an unavailable notification cursor does not replay or erase a known cursor', async () => {
  const { app, auth, prisma } = fixture();
  prisma.kycSubmission.findFirst.mockRejectedValueOnce(new Error('fixture unavailable'));
  const r = await request(app).get('/api/v1/admin/work-summary').set('Authorization', auth);
  expect(r.body.alerts).toBeNull(); expect(r.body.widgets.readyPackages.value).toBe(2);
});
