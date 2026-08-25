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
  return {
    deposit: {
      findUnique: jest.fn().mockResolvedValue(depositExists),
      create: jest.fn(),
    },
    balance: { upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      deposit: { create: jest.fn().mockResolvedValue({ id: 'dep1' }) },
      balance: {
        upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ referredById: null }) },
      referralReward: { create: jest.fn() },
      ...txOverrides,
    })),
  } as any;
}

// Stablecoin asset (ETH's chainConfig.nativeAsset used across these tests
// is ETH, not a stablecoin) — a price source is required by the new
// minimum-deposit check. Defaults to a price well above $1000/ETH so
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

  it('credits balance when confirmations meet the threshold', async () => {
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

    expect(result.status).toBe('CREDITED');
    expect(result.amount).toBe('2.5');
  });

  it('is idempotent: replaying the same tx hash does not re-verify or double count', async () => {
    const prisma = makePrismaMock({ status: 'CREDITED', amount: '2.5', confirmations: 5 });
    const service = new DepositService(prisma, chainConfig, makePriceSource());
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '3'.repeat(64), asset: 'ETH' });

    expect(result.status).toBe('CREDITED');
    expect(prisma.deposit.findUnique).toHaveBeenCalled();
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
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
        user: { findUnique: jest.fn().mockResolvedValue({ referredById: 'referrer-1' }) },
        balance: {
          upsert: jest.fn().mockResolvedValue({ available: '10', locked: '0' }),
          update: referrerBalanceUpdate,
        },
        referralReward: { create: referralRewardCreate },
      });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + 'a'.repeat(64), asset: 'ETH' });

      expect(result.status).toBe('CREDITED');
      // Depositor's own credit (2 ETH) then the referrer's reward (0.1 ETH,
      // 5% of 2) — both go through the same balance.update mock here since
      // this test overrides it for both calls, so assert the second (last)
      // call is the referrer's.
      expect(referrerBalanceUpdate).toHaveBeenCalledTimes(2);
      expect(referrerBalanceUpdate.mock.calls[1][0]).toMatchObject({
        where: { userId_asset: { userId: 'referrer-1', asset: 'ETH' } },
        data: { available: '10.1' },
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
        user: { findUnique: jest.fn().mockResolvedValue({ referredById: null }) },
        balance: { upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }), update: balanceUpdate },
        referralReward: { create: referralRewardCreate },
      });

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + 'b'.repeat(64), asset: 'ETH' });

      expect(result.status).toBe('CREDITED');
      // Only the depositor's own credit — no second call for a referrer.
      expect(balanceUpdate).toHaveBeenCalledTimes(1);
      expect(referralRewardCreate).not.toHaveBeenCalled();
    });
  });

  describe('minimum deposit ($1000 USD-equivalent)', () => {
    it('does not credit a confirmed deposit worth less than $1000', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('0.1') }), // 0.1 ETH
      }));

      const prisma = makePrismaMock();
      // 0.1 ETH @ $3000/ETH = $300, below the $1000 minimum.
      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '5'.repeat(64), asset: 'ETH' });

      expect(result.status).toBe('BELOW_MINIMUM');
      expect(result.minDepositUsd).toBe(1000);
    });

    it('still credits a confirmed deposit at or above $1000', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }), // 1 ETH
      }));

      // 1 ETH @ $3000/ETH = $3000, above the minimum.
      const service = new DepositService(makePrismaMock(), chainConfig, makePriceSource('3000'));
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '6'.repeat(64), asset: 'ETH' });

      expect(result.status).toBe('CREDITED');
    });

    it('records performedByAdminId in the audit log when an admin credits on the user\'s behalf', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }),
      }));

      const auditLogCreate = jest.fn();
      const prisma = {
        deposit: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        $transaction: jest.fn(async (fn: any) =>
          fn({
            deposit: { create: jest.fn().mockResolvedValue({ id: 'dep1' }) },
            balance: { upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }), update: jest.fn() },
            auditLog: { create: auditLogCreate },
            user: { findUnique: jest.fn().mockResolvedValue({ referredById: null }) },
            referralReward: { create: jest.fn() },
          })
        ),
      } as any;

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

    it('omits performedByAdminId from the audit log for a normal self-claim', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('1') }),
      }));

      const auditLogCreate = jest.fn();
      const prisma = {
        deposit: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        $transaction: jest.fn(async (fn: any) =>
          fn({
            deposit: { create: jest.fn().mockResolvedValue({ id: 'dep1' }) },
            balance: { upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }), update: jest.fn() },
            auditLog: { create: auditLogCreate },
            user: { findUnique: jest.fn().mockResolvedValue({ referredById: null }) },
            referralReward: { create: jest.fn() },
          })
        ),
      } as any;

      const service = new DepositService(prisma, chainConfig, makePriceSource('3000'));
      await service.claimDeposit({ userId: 'u1', txHash: '0x' + '9'.repeat(64), asset: 'ETH' });

      const metadata = auditLogCreate.mock.calls[0][0].data.metadata;
      expect(metadata.performedByAdminId).toBeUndefined();
    });

    it('does not block a deposit when the price feed is unavailable', async () => {
      mockJsonRpcProvider.mockImplementation(() => ({
        getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [] }),
        getBlockNumber: jest.fn().mockResolvedValue(102),
        getTransaction: jest.fn().mockResolvedValue({ to: TREASURY, value: ethers.parseEther('0.001') }),
      }));

      const priceSource = { getTicker: jest.fn().mockResolvedValue(null) }; // feed down
      const service = new DepositService(makePrismaMock(), chainConfig, priceSource);
      const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '7'.repeat(64), asset: 'ETH' });

      // Can't verify the value is below minimum, so it errs toward crediting
      // rather than silently withholding a possibly-large legitimate deposit.
      expect(result.status).toBe('CREDITED');
    });
  });
});
