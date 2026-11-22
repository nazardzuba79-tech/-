import { WithdrawalService, WithdrawalRequestError, DemoFundsNotWithdrawableError } from '../WithdrawalService';
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
  const auditLog = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
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

  // Issue #617: a demo-valued request (one that holds no Balance) is refused permanently — never filed, approved or
  // paid, whatever the demo switches, including requests filed before the fence. It can still be rejected.
  describe('demo-valued (unheld) requests are refused permanently', () => {
    const unheld = (status: string) => ({ id: 'w1', userId: 'u1', asset: 'USDT', amount: '300', status, balanceHeld: false });
    const held = (status: string) => ({ id: 'w2', userId: 'u1', asset: 'USDT', amount: '40', status, balanceHeld: true });
    const SWITCHES = ['DEMO_SPOT_ENABLED', 'DEMO_LIQUIDITY_ENABLED', 'DEMO_WITHDRAWAL_GUARD_ENABLED'] as const;
    const COMBOS: (typeof SWITCHES[number])[][] = [[], ['DEMO_SPOT_ENABLED'], ['DEMO_LIQUIDITY_ENABLED'], ['DEMO_WITHDRAWAL_GUARD_ENABLED'], [...SWITCHES]];
    const saved = Object.fromEntries(SWITCHES.map(key => [key, process.env[key]]));
    const set = (combo: readonly string[]) => { for (const key of SWITCHES) delete process.env[key]; for (const key of combo) process.env[key] = 'true'; };
    afterEach(() => { for (const key of SWITCHES) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
    const label = (combo: readonly string[]) => combo.length ? combo.join('+') : 'every demo switch off';

    it.each(COMBOS.map(c => [label(c), c]))('%s: a new unheld request is refused before anything is read or written', async (_name, combo) => {
      set(combo);
      const prisma = makePrisma({});
      const error = await new WithdrawalService(prisma).requestUnheldWithdrawal({ userId: 'u1', asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '1', available: '1000' }).catch(e => e);
      expect(error).toBeInstanceOf(DemoFundsNotWithdrawableError); expect(error.code).toBe('DEMO_FUNDS_NOT_WITHDRAWABLE');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.withdrawal.create).not.toHaveBeenCalled();
    });

    it.each(COMBOS.map(c => [label(c), c]))('%s: an existing PENDING unheld request cannot be approved; it stays PENDING, no audit row', async (_name, combo) => {
      set(combo);
      const prisma = makePrisma({ withdrawal: unheld('PENDING') });
      const error = await new WithdrawalService(prisma).approveWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin' }).catch(e => e);
      expect(error).toBeInstanceOf(DemoFundsNotWithdrawableError); expect(error.code).toBe('DEMO_FUNDS_NOT_WITHDRAWABLE');
      // Decided on the row locked FOR UPDATE inside the same transaction as the status change.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.withdrawal.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it.each(COMBOS.map(c => [label(c), c]))('%s: an existing APPROVED unheld request cannot be marked sent', async (_name, combo) => {
      set(combo);
      const prisma = makePrisma({ balance: { available: '5', locked: '0' }, withdrawal: unheld('APPROVED') });
      await expect(new WithdrawalService(prisma).markSent({ withdrawalId: 'w1', performedByAdminId: 'admin', txHash: '0xabc' })).rejects.toBeInstanceOf(DemoFundsNotWithdrawableError);
      expect(prisma.withdrawal.update).not.toHaveBeenCalled();
      expect(prisma.balance.update).not.toHaveBeenCalled();
      expect(prisma.balance.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'APPROVED'])('an existing %s unheld request can still be rejected; nothing is given back, nothing was taken', async status => {
      set([]);
      const prisma = makePrisma({ balance: { available: '5', locked: '0' }, withdrawal: unheld(status) });
      await expect(new WithdrawalService(prisma).rejectWithdrawal({ withdrawalId: 'w1', performedByAdminId: 'admin', reason: 'demo funds' })).resolves.toMatchObject({ status: 'REJECTED' });
      expect(prisma.balance.update).not.toHaveBeenCalled();
      expect(prisma.balance.updateMany).not.toHaveBeenCalled();
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    });

    it.each(COMBOS.map(c => [label(c), c]))('%s: held (Balance) requests are approved and sent exactly as before', async (_name, combo) => {
      set(combo);
      const approve = makePrisma({ balance: { available: '0', locked: '40' }, withdrawal: held('PENDING') });
      await expect(new WithdrawalService(approve).approveWithdrawal({ withdrawalId: 'w2', performedByAdminId: 'admin' })).resolves.toMatchObject({ status: 'APPROVED' });
      const sent = makePrisma({ balance: { available: '0', locked: '40' }, withdrawal: held('APPROVED') });
      await expect(new WithdrawalService(sent).markSent({ withdrawalId: 'w2', performedByAdminId: 'admin', txHash: '0xdef' })).resolves.toMatchObject({ status: 'SENT' });
      expect(sent.balance.updateMany).toHaveBeenCalled();
    });
  });
});
