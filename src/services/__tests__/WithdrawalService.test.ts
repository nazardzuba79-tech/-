import { WithdrawalService, WithdrawalRequestError } from '../WithdrawalService';

function makePrisma(opts: {
  balance?: { available: string; locked: string } | null;
  withdrawal?: { id: string; userId: string; asset: string; amount: string; status: string } | null;
}) {
  const balanceState = opts.balance ? { ...opts.balance } : null;
  const balance = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(balanceState)),
    update: jest.fn().mockImplementation(({ data }: any) => {
      if (balanceState) Object.assign(balanceState, data);
      return Promise.resolve(balanceState);
    }),
  };
  const withdrawalCreated: any = { id: 'w-new', status: 'PENDING' };
  const withdrawal = {
    create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...withdrawalCreated, ...data })),
    findUnique: jest.fn().mockResolvedValue(opts.withdrawal ?? null),
    update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...opts.withdrawal, ...data })),
  };
  const auditLog = { create: jest.fn() };

  const tx = { balance, withdrawal, auditLog };
  return {
    balance,
    withdrawal,
    auditLog,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
}

describe('WithdrawalService', () => {
  describe('requestWithdrawal', () => {
    it('locks the requested amount and creates a PENDING withdrawal', async () => {
      const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
      const service = new WithdrawalService(prisma);

      const result = await service.requestWithdrawal({
        userId: 'u1',
        asset: 'USDT',
        network: 'TRC20',
        toAddress: 'Tsomeaddress',
        amount: '40',
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.balance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { available: '60', locked: '40' } })
      );
      expect(prisma.withdrawal.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', amount: '40' }) })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_REQUESTED' }) })
      );
    });

    it('rejects a request larger than the available balance', async () => {
      const prisma = makePrisma({ balance: { available: '10', locked: '0' } });
      const service = new WithdrawalService(prisma);

      await expect(
        service.requestWithdrawal({ userId: 'u1', asset: 'USDT', network: 'TRC20', toAddress: 'T...', amount: '40' })
      ).rejects.toThrow('Insufficient USDT balance');
      expect(prisma.balance.update).not.toHaveBeenCalled();
    });

    it('rejects a zero or negative amount', async () => {
      const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
      const service = new WithdrawalService(prisma);

      await expect(
        service.requestWithdrawal({ userId: 'u1', asset: 'USDT', network: 'TRC20', toAddress: 'T...', amount: '0' })
      ).rejects.toThrow(WithdrawalRequestError);
    });

    it('treats no balance row at all as zero available', async () => {
      const prisma = makePrisma({ balance: null });
      const service = new WithdrawalService(prisma);

      await expect(
        service.requestWithdrawal({ userId: 'u1', asset: 'USDT', network: 'TRC20', toAddress: 'T...', amount: '1' })
      ).rejects.toThrow('Insufficient USDT balance');
    });
  });

  describe('completeWithdrawal', () => {
    it('releases the locked hold without returning anything to available', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const service = new WithdrawalService(prisma);

      const result = await service.completeWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' });

      expect(result.status).toBe('COMPLETED');
      expect(prisma.balance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { locked: '0' } }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_COMPLETED' }) })
      );
    });

    it('throws when the withdrawal does not exist', async () => {
      const prisma = makePrisma({ withdrawal: null });
      const service = new WithdrawalService(prisma);

      await expect(service.completeWithdrawal({ withdrawalId: 'nope', performedByAdminId: 'admin-1' })).rejects.toThrow(
        'not found'
      );
    });

    it('refuses to complete a withdrawal that is already resolved', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'COMPLETED' },
      });
      const service = new WithdrawalService(prisma);

      await expect(service.completeWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' })).rejects.toThrow(
        'already COMPLETED'
      );
    });
  });

  describe('rejectWithdrawal', () => {
    it('returns the locked amount to available and records the reason', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const service = new WithdrawalService(prisma);

      const result = await service.rejectWithdrawal({
        withdrawalId: 'w1',
        performedByAdminId: 'admin-1',
        reason: 'wrong address format',
      });

      expect(result.status).toBe('REJECTED');
      expect(prisma.balance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { available: '100', locked: '0' } })
      );
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rejectionReason: 'wrong address format' }) })
      );
    });

    it('refuses to reject a withdrawal that is already resolved', async () => {
      const prisma = makePrisma({
        balance: { available: '100', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'REJECTED' },
      });
      const service = new WithdrawalService(prisma);

      await expect(
        service.rejectWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' })
      ).rejects.toThrow('already REJECTED');
    });
  });
});
