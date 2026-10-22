import { BalanceAdjustmentService, BalanceAdjustmentConflict, BalanceAdjustmentError } from '../BalanceAdjustmentService';
import { walletDelegate } from '../../test-utils/walletDelegate';

const KEY = '7f30c36e-3c3c-4c21-8d59-d3b53895b39f';
function fixture() {
  const balance = walletDelegate(new Map([['user-1:USDT', { available: '100', locked: '7' }]]));
  const receipts = new Map<string, any>();
  const auditLog = {
    findUnique: jest.fn(async ({ where }: any) => receipts.get(where.id) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { ...data, id: data.id ?? `legacy-${receipts.size}`, createdAt: new Date('2026-10-03T10:00:00Z') }; receipts.set(row.id, row); return row; }),
  };
  const tx = { balance, auditLog, $executeRaw: jest.fn(async () => 1) };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  return { service: new BalanceAdjustmentService(prisma), prisma, receipts };
}
const request = { userId: 'user-1', asset: 'USDT', amount: '10', reason: 'Synthetic correction', performedByAdminId: 'admin-1', idempotencyKey: KEY };

test('lost-response retry of one manual correction must not apply its signed delta twice', async () => {
  const { service, prisma } = fixture();
  await service.adjustOnce(request);
  await service.adjustOnce(request);
  const balance = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: request.userId, asset: request.asset } } });
  expect(balance.available.toString()).toBe('110');
  expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
});

test('receipt retains exact original before/after despite subsequent corrections', async () => {
  const { service } = fixture();
  const original = await service.adjustOnce(request);
  await service.adjust({ ...request, amount: '25' });
  expect(await service.adjustOnce({ ...request, amount: '+10.000' })).toEqual(original);
  expect(await service.findReceipt(request.userId, KEY, request.performedByAdminId)).toEqual(original);
  expect(original).toMatchObject({ status: 'APPLIED', account: 'SPOT', operationId: KEY, availableBefore: '100', available: '110', locked: '7', amount: '10' });
});

test.each([
  { amount: '11' }, { reason: 'Different reason' }, { asset: 'ETH' }, { userId: 'user-2' }, { performedByAdminId: 'admin-2' },
])('one key cannot silently apply a different intent: %j', async changed => {
  const { service, prisma } = fixture();
  await service.adjustOnce(request);
  await expect(service.adjustOnce({ ...request, ...changed })).rejects.toBeInstanceOf(BalanceAdjustmentConflict);
  expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
});

test('receipt lookup does not expose a different target or administrator', async () => {
  const { service } = fixture(); await service.adjustOnce(request);
  expect(await service.findReceipt('user-2', KEY, 'admin-1')).toBeNull();
  expect(await service.findReceipt('user-1', KEY, 'admin-2')).toBeNull();
  expect(await service.findReceipt('user-1', 'e9a642ea-fca2-415d-87c0-05682998b86b', 'admin-1')).toBeNull();
});

test.each(['0', '-101', 'NaN', '0.0000000000000000001'])('invalid or insufficient delta %s causes no receipt', async amount => {
  const { service, prisma } = fixture();
  await expect(service.adjustOnce({ ...request, amount })).rejects.toBeInstanceOf(BalanceAdjustmentError);
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});

test('negative correction only debits available; locked is unchanged', async () => {
  const { service } = fixture();
  expect(await service.adjustOnce({ ...request, amount: '-10.125' })).toMatchObject({ availableBefore: '100', available: '89.875', locked: '7' });
});

test('test assets remain forbidden on real spot corrections', async () => {
  const { service, prisma } = fixture();
  await expect(service.adjustOnce({ ...request, asset: 'VTA' })).rejects.toBeInstanceOf(BalanceAdjustmentError);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test('a key colliding with an unrelated audit event is rejected without a mutation', async () => {
  const { service, prisma, receipts } = fixture();
  receipts.set(KEY, { id: KEY, userId: 'user-1', action: 'UNRELATED', metadata: {}, createdAt: new Date() });
  await expect(service.adjustOnce(request)).rejects.toBeInstanceOf(BalanceAdjustmentConflict);
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});
