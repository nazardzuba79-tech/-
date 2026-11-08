import { BalanceAdjustmentService, BalanceAdjustmentError } from '../BalanceAdjustmentService';
import { walletDelegate } from '../../test-utils/walletDelegate';

function makePrisma(opts: { balance?: { available: string; locked: string } | null }) {
  const balance = walletDelegate(new Map(opts.balance ? [['u1:USDT', { ...opts.balance }]] : []));
  const auditLog = { create: jest.fn() };
  const tx = { balance, auditLog };
  return {
    balance,
    auditLog,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
}

describe('BalanceAdjustmentService', () => {
  it.each(['TRC', 'trc', ' TRC '])('rejects ambiguous %s before opening a financial transaction', async asset => {
    const prisma = makePrisma({ balance: null });
    await expect(new BalanceAdjustmentService(prisma).adjust({ userId: 'u1', asset, amount: '1684', reason: 'Native TRON deposit', performedByAdminId: 'admin-1' })).rejects.toThrow('For native TRON use TRX');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('preserves the exact native TRX ticker and quantity', async () => {
    const prisma = makePrisma({ balance: null });
    const result = await new BalanceAdjustmentService(prisma).adjust({ userId: 'u1', asset: 'TRX', amount: '1684', reason: 'Native TRON deposit', performedByAdminId: 'admin-1' });
    expect(result).toMatchObject({ asset: 'TRX', available: '1684' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ asset: 'TRX', delta: '1684' }) }) }));
  });
  it('credits available and logs the delta, reason, and acting admin', async () => {
    const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
    const service = new BalanceAdjustmentService(prisma);

    const result = await service.adjust({
      userId: 'u1',
      asset: 'USDT',
      amount: '25',
      reason: 'Reconciliation credit for missed deposit',
      performedByAdminId: 'admin-1',
    });

    expect(result).toEqual({ asset: 'USDT', available: '125', locked: '0' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          action: 'BALANCE_ADJUSTED',
          metadata: expect.objectContaining({
            asset: 'USDT',
            delta: '25',
            newAvailable: '125',
            reason: 'Reconciliation credit for missed deposit',
            performedByAdminId: 'admin-1',
          }),
        }),
      })
    );
  });

  it('debits available with a negative amount', async () => {
    const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
    const service = new BalanceAdjustmentService(prisma);

    const result = await service.adjust({
      userId: 'u1',
      asset: 'USDT',
      amount: '-40',
      reason: 'Correcting duplicate credit',
      performedByAdminId: 'admin-1',
    });

    expect(result.available).toBe('60');
  });

  it('creates a balance row from zero when the user holds none of this asset yet', async () => {
    const prisma = makePrisma({ balance: null });
    const service = new BalanceAdjustmentService(prisma);

    const result = await service.adjust({
      userId: 'u1',
      asset: 'ETH',
      amount: '1.5',
      reason: 'Manual credit',
      performedByAdminId: 'admin-1',
    });

    expect(result.available).toBe('1.5');
  });

  it('refuses to push available balance negative', async () => {
    const prisma = makePrisma({ balance: { available: '10', locked: '0' } });
    const service = new BalanceAdjustmentService(prisma);

    await expect(
      service.adjust({ userId: 'u1', asset: 'USDT', amount: '-50', reason: 'oops', performedByAdminId: 'admin-1' })
    ).rejects.toThrow(BalanceAdjustmentError);
    expect(prisma.balance.upsert).not.toHaveBeenCalled();
  });

  it('rejects a zero amount', async () => {
    const prisma = makePrisma({ balance: { available: '10', locked: '0' } });
    const service = new BalanceAdjustmentService(prisma);

    await expect(
      service.adjust({ userId: 'u1', asset: 'USDT', amount: '0', reason: 'oops', performedByAdminId: 'admin-1' })
    ).rejects.toThrow('non-zero');
  });

  it('rejects a blank reason', async () => {
    const prisma = makePrisma({ balance: { available: '10', locked: '0' } });
    const service = new BalanceAdjustmentService(prisma);

    await expect(
      service.adjust({ userId: 'u1', asset: 'USDT', amount: '5', reason: '   ', performedByAdminId: 'admin-1' })
    ).rejects.toThrow('reason is required');
  });
});
