import { ethers } from 'ethers';
import { DepositService, DepositVerificationError } from '../DepositService';
import { ChainConfig } from '../../config/chains';

// Mock ethers.JsonRpcProvider so tests don't hit a real RPC endpoint.
// ethers v6 exports both flat named exports AND a nested `ethers` namespace
// object containing the same members — both need the override to point at
// the same mock function, or `import { ethers } from 'ethers'` resolves to
// the untouched nested copy. The mock fn is created inside the factory
// (not a hoisted outer const) to avoid a jest.mock hoisting TDZ error.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const mockFn = jest.fn();
  return {
    ...actual,
    JsonRpcProvider: mockFn,
    ethers: { ...actual.ethers, JsonRpcProvider: mockFn },
  };
});

const mockJsonRpcProvider = ethers.JsonRpcProvider as unknown as jest.Mock;

beforeEach(() => {
  mockJsonRpcProvider.mockClear();
});

const TREASURY = '0x000000000000000000000000000000000000aa';
const chainConfig: ChainConfig = {
  chain: 'ethereum',
  type: 'evm',
  rpcUrl: 'http://mock',
  treasuryAddress: TREASURY,
  minConfirmations: 3,
  nativeAsset: 'ETH',
  tokens: {},
};

// referredById defaults to null (not referred) — tests that care about the
// referral-reward path pass their own tx mock in via txOverrides instead of
// reaching into this helper.
function makePrismaMock(depositExists: any = null, txOverrides: any = {}) {
  let row = depositExists;
  const deposit = {
    findUnique: jest.fn(async () => row),
    upsert: jest.fn(async ({ create }: any) => row ?? (row = { id: 'dep1', ...create })),
    update: jest.fn(async ({ data }: any) => (row = { ...row, ...data })),
  };
  const tx = { deposit, balance: { upsert: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() }, user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', referredById: null }) },
    referralReward: { create: jest.fn() }, ...txOverrides };
  return { deposit, ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
}

// Stablecoin asset (ETH's chainConfig.nativeAsset used across these tests
// is ETH, not a stablecoin) — a price source is required by the new
// minimum-deposit check. Defaults to a price well above $300/ETH so
// existing tests (written before that check existed) keep passing; tests
// for the new behavior override it explicitly.
function makePriceSource(lastPrice = '3000') {
  return { getTicker: jest.fn().mockResolvedValue({ lastPrice }) };
}

describe('DepositService', () => {
  it('rejects a transaction that does not pay the treasury address', async () => {
    mockJsonRpcProvider.mockImplementation(() => ({
      getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
      getBlockNumber: jest.fn().mockResolvedValue(103),
      getTransaction: jest.fn().mockResolvedValue({
        to: '0x000000000000000000000000000000000000bb', // wrong address
        value: ethers.parseEther('1'),
      }),
    }));

    const service = new DepositService(makePrismaMock(), chainConfig, makePriceSource());
    await expect(
      service.claimDeposit({ userId: 'u1', txHash: '0x' + '1'.repeat(64), asset: 'ETH' })
    ).rejects.toThrow(DepositVerificationError);
  });

  it('keeps a fully confirmed self-claim pending without balance or referral writes', async () => {
    mockJsonRpcProvider.mockImplementation(() => ({
      getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
      getBlockNumber: jest.fn().mockResolvedValue(102), // 3 confirmations, meets minConfirmations
      getTransaction: jest.fn().mockResolvedValue({
        to: TREASURY,
        value: ethers.parseEther('2.5'),
      }),
    }));

    const prisma = makePrismaMock();
    const service = new DepositService(prisma, chainConfig, makePriceSource());
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '2'.repeat(64), asset: 'ETH' });

    expect(result.status).toBe('PENDING');
    expect(result.amount).toBe('2.5');
    expect(prisma.balance.upsert).not.toHaveBeenCalled();
    expect(prisma.referralReward.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent: replaying the same tx hash does not re-verify or double count', async () => {
    const prisma = makePrismaMock({ userId: 'u1', asset: 'ETH', status: 'CREDITED', amount: '2.5', confirmations: 5 });
    const service = new DepositService(prisma, chainConfig, makePriceSource());
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '3'.repeat(64), asset: 'ETH' });

    expect(result.status).toBe('CREDITED');
    expect(prisma.deposit.findUnique).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('marks as PENDING when confirmations are below threshold', async () => {
    mockJsonRpcProvider.mockImplementation(() => ({
      getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
      getBlockNumber: jest.fn().mockResolvedValue(101), // only 2 confirmations, threshold is 3
      getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }),
    }));

    const service = new DepositService(makePrismaMock(), chainConfig, makePriceSource());
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '4'.repeat(64), asset: 'ETH' });
    expect(result.status).toBe('PENDING');
  });

  describe('referral rewards', () => {
    it('credits the referrer 5% of a credited deposit, in the same asset', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('2') }), // 2 ETH
      }));

      const referrerBalanceUpdate = jest.fn();
      const referralRewardCreate = jest.fn();
      const prisma = makePrismaMock(null, {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', referredById: 'referrer-1' }) },
        balance: {
          upsert: referrerBalanceUpdate,
          update: referrerBalanceUpdate,
        },
        referralReward: { create: referralRewardCreate },
      });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const pending = await service.claimDeposit({ userId: 'u1', txHash: '0x' + 'a'.repeat(64), asset: 'ETH' });
      expect(pending.status).toBe('PENDING');
      expect(referrerBalanceUpdate).not.toHaveBeenCalled();
      expect(referralRewardCreate).not.toHaveBeenCalled();
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + 'a'.repeat(64), asset: 'ETH', performedByAdminId: 'admin-1' });

      expect(result.status).toBe('CREDITED');
      // Depositor's own credit (2 ETH) then the referrer's reward (0.1 ETH,
      // 5% of 2) — both go through the same balance.upsert mock here since
      // this test overrides it for both calls, so assert the second (last)
      // call is the referrer's.
      expect(referrerBalanceUpdate).toHaveBeenCalledTimes(2);
      expect(referrerBalanceUpdate.mock.calls[1][0]).toMatchObject({
        where: { userId_asset: { userId: 'referrer-1', asset: 'ETH' } },
        update: { available: { increment: '0.1' } },
      });
      expect(referralRewardCreate).toHaveBeenCalledWith({
        data: {
          referrerId: 'referrer-1',
          referredUserId: 'u1',
          depositId: 'dep1',
          asset: 'ETH',
          amount: '0.1',
        },
      });
    });

    it('does not create a reward or touch any other balance for a non-referred user', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('2') }),
      }));

      const balanceUpdate = jest.fn();
      const referralRewardCreate = jest.fn();
      const prisma = makePrismaMock(null, {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', referredById: null }) },
        balance: { upsert: balanceUpdate },
        referralReward: { create: referralRewardCreate },
      });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + 'b'.repeat(64), asset: 'ETH', performedByAdminId: 'admin-1' });

      expect(result.status).toBe('CREDITED');
      // Only the depositor's own credit — no second call for a referrer.
      expect(balanceUpdate).toHaveBeenCalledTimes(1);
      expect(referralRewardCreate).not.toHaveBeenCalled();
    });
  });

  describe('minimum deposit ($300 USD-equivalent)', () => {
    it('does not credit a confirmed deposit worth less than $300', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('0.099') }), // 0.099 ETH
      }));

      const prisma = makePrismaMock();
      // 0.099 ETH @ $3000/ETH = $297, below the $300 minimum.
      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '5'.repeat(64), asset: 'ETH' });

      expect(result.status).toBe('BELOW_MINIMUM');
      expect(result.minDepositUsd).toBe(300);
    });

    it.each(['100', '299', '300', '5000', '10000'])('self-claim of %s USDT never credits even with sufficient confirmations', async (amount) => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther(amount) }),
      }));

      const prisma = makePrismaMock();
      const service = new DepositService(prisma, { ...chainConfig, nativeAsset: 'USDT' }, makePriceSource());
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '6'.repeat(64), asset: 'USDT' });

      expect(result.status).toBe(Number(amount) < 300 ? 'BELOW_MINIMUM' : 'PENDING');
      expect(result.amount).toBe(amount);
      expect(prisma.balance.upsert).not.toHaveBeenCalled();
      expect(prisma.referralReward.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create.mock.calls.some(([args]: any[]) => args.data.action === 'DEPOSIT_CREDITED')).toBe(false);
    });

    it('records performedByAdminId in the audit log when an admin credits on the user\'s behalf', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }),
      }));

      const auditLogCreate = jest.fn();
      const prisma = makePrismaMock(null, { auditLog: { create: auditLogCreate } });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      await service.claimDeposit({
        userId: 'u1',
        txHash: '0x' + '8'.repeat(64),
        asset: 'ETH',
        performedByAdminId: 'admin-1',
      });

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ performedByAdminId: 'admin-1' }) }) })
      );
    });

    it('does not write a credit audit for a normal self-claim', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }),
      }));

      const auditLogCreate = jest.fn();
      const prisma = makePrismaMock(null, { auditLog: { create: auditLogCreate } });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      await service.claimDeposit({ userId: 'u1', txHash: '0x' + '9'.repeat(64), asset: 'ETH' });

      expect(auditLogCreate).not.toHaveBeenCalled();
    });

    it('records without automatic credit when the price feed is unavailable', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('0.001') }),
      }));

      const priceSource = { getTicker: jest.fn().mockResolvedValue(null) }; // feed down
      const service = new DepositService(makePrismaMock(), chainConfig, priceSource);
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '7'.repeat(64), asset: 'ETH' });

      // Unknown USD value cannot authorize automatic credit.
      expect(result.status).toBe('PENDING');
    });
  });
});
