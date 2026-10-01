import { WithdrawalService, WithdrawalRequestError } from '../WithdrawalService';
import { walletDelegate } from '../../test-utils/walletDelegate';

function makePrisma(opts: {
  balance?: { available: string; locked: string } | null;
  withdrawal?: { id: string; userId: string; asset: string; amount: string; status: string; balanceHeld?: boolean } | null;
  claimed?: string | null;
}) {
  const balance = walletDelegate(new Map(opts.balance ? [['u1:USDT', { ...opts.balance }]] : []));
  const withdrawalCreated: any = { id: 'w-new', status: 'PENDING' };
  const withdrawal = {
    create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...withdrawalCreated, ...data })),
    findUnique: jest.fn().mockResolvedValue(opts.withdrawal ?? null),
    update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...opts.withdrawal, ...data })),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.claimed ?? null } }),
  };
  const auditLog = { create: jest.fn() };
  const $queryRaw = jest.fn().mockResolvedValue([]);

  const tx = { balance, withdrawal, auditLog, $queryRaw };
  return {
    balance,
    withdrawal,
    auditLog,
    $queryRaw,
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
      expect(prisma.balance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', asset: 'USDT', available: { gte: '40' } },
          data: { available: { increment: '-40' }, locked: { increment: '40' } } })
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

  describe('approveWithdrawal', () => {
    it('marks it APPROVED and leaves the hold locked', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const service = new WithdrawalService(prisma);

      const result = await service.approveWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' });

      expect(result.status).toBe('APPROVED');
      expect(prisma.balance.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_APPROVED' }) })
      );
    });

    it('throws when the withdrawal does not exist', async () => {
      const prisma = makePrisma({ withdrawal: null });
      const service = new WithdrawalService(prisma);

      await expect(service.approveWithdrawal({ withdrawalId: 'nope', performedByAdminId: 'admin-1' })).rejects.toThrow(
        'not found'
      );
    });

    it('refuses to approve a withdrawal that is not PENDING', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'APPROVED' },
      });
      const service = new WithdrawalService(prisma);

      await expect(service.approveWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' })).rejects.toThrow(
        'already APPROVED'
      );
    });
  });

  describe('markSent', () => {
    it('releases the locked hold without returning anything to available, and records the txHash', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'APPROVED' },
      });
      const service = new WithdrawalService(prisma);

      const result = await service.markSent({ withdrawalId: 'w1', performedByAdminId: 'admin-1', txHash: 'abc123' });

      expect(result.status).toBe('SENT');
      expect(result.txHash).toBe('abc123');
      expect(prisma.balance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { available: { increment: '0' }, locked: { increment: '-40' } } }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_SENT', metadata: expect.objectContaining({ txHash: 'abc123' }) }) })
      );
    });

    it('refuses to mark a withdrawal sent before it has been approved', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const service = new WithdrawalService(prisma);

      await expect(
        service.markSent({ withdrawalId: 'w1', performedByAdminId: 'admin-1', txHash: 'abc123' })
      ).rejects.toThrow('already PENDING');
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
      expect(prisma.balance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { available: { increment: '40' }, locked: { increment: '-40' } } })
      );
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rejectionReason: 'wrong address format' }) })
      );
    });

    it('also allows rejecting an already-approved withdrawal', async () => {
      const prisma = makePrisma({
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'APPROVED' },
      });
      const service = new WithdrawalService(prisma);

      const result = await service.rejectWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' });

      expect(result.status).toBe('REJECTED');
    });

    it('refuses to reject a withdrawal that has already been sent', async () => {
      const prisma = makePrisma({
        balance: { available: '100', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '40', status: 'SENT' },
      });
      const service = new WithdrawalService(prisma);

      await expect(
        service.rejectWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin-1' })
      ).rejects.toThrow('already SENT');
    });
  });

  describe('unheld requests from a Cross trading account', () => {
    const params = { userId: 'u1', asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '300', available: '1000' };

    it('records a PENDING request, balanceHeld false, and moves nothing', async () => {
      const prisma = makePrisma({ balance: { available: '0', locked: '0' } });
      const result = await new WithdrawalService(prisma).requestUnheldWithdrawal(params);

      expect(result).toMatchObject({ status: 'PENDING', amount: '300', balanceHeld: false });
      expect(prisma.balance.findUnique).not.toHaveBeenCalled();
      expect(prisma.balance.update).not.toHaveBeenCalled();
      // Serialized per user, so two requests at once cannot both pass the check.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'WITHDRAWAL_REQUESTED', metadata: expect.objectContaining({ balanceHeld: false }) }) })
      );
    });

    it('counts open and already-paid requests against what is available', async () => {
      const prisma = makePrisma({ claimed: '800' });
      await expect(new WithdrawalService(prisma).requestUnheldWithdrawal(params)).rejects.toThrow('Insufficient USDT balance');
      expect(prisma.withdrawal.aggregate).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', asset: 'USDT', balanceHeld: false, status: { in: ['PENDING', 'APPROVED', 'SENT'] } }),
      }));
      expect(prisma.withdrawal.create).not.toHaveBeenCalled();
    });

    it('accepts exactly the remaining amount', async () => {
      const prisma = makePrisma({ claimed: '700' });
      await expect(new WithdrawalService(prisma).requestUnheldWithdrawal(params)).resolves.toMatchObject({ amount: '300' });
    });

    it('marking one sent releases no lock', async () => {
      const prisma = makePrisma({
        balance: { available: '5', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '300', status: 'APPROVED', balanceHeld: false },
      });
      await new WithdrawalService(prisma).markSent({ withdrawalId: 'w1', performedByAdminId: 'admin', txHash: '0xabc' });
      expect(prisma.balance.update).not.toHaveBeenCalled();
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', txHash: '0xabc' }) }));
    });

    it('rejecting one gives nothing back, because nothing was taken', async () => {
      const prisma = makePrisma({
        balance: { available: '5', locked: '0' },
        withdrawal: { id: 'w1', userId: 'u1', asset: 'USDT', amount: '300', status: 'PENDING', balanceHeld: false },
      });
      await new WithdrawalService(prisma).rejectWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin', reason: 'test' });
      expect(prisma.balance.update).not.toHaveBeenCalled();
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    });
  });
});
