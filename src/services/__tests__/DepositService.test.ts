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
  rpcUrl: 'http://mock',
  treasuryAddress: TREASURY,
  minConfirmations: 3,
  nativeAsset: 'ETH',
  tokens: {},
};

function makePrismaMock(depositExists: any = null) {
  return {
    deposit: {
      findUnique: jest.fn().mockResolvedValue(depositExists),
      create: jest.fn(),
    },
    balance: { upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      deposit: { create: jest.fn() },
      balance: {
        upsert: jest.fn().mockResolvedValue({ available: '0', locked: '0' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    })),
  } as any;
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

    const service = new DepositService(makePrismaMock(), chainConfig);
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
    const service = new DepositService(prisma, chainConfig);
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '2'.repeat(64), asset: 'ETH' });

    expect(result.status).toBe('CREDITED');
    expect(result.amount).toBe('2.5');
  });

  it('is idempotent: replaying the same tx hash does not re-verify or double count', async () => {
    const prisma = makePrismaMock({ status: 'CREDITED', amount: '2.5', confirmations: 5 });
    const service = new DepositService(prisma, chainConfig);
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

    const service = new DepositService(makePrismaMock(), chainConfig);
    const result = await service.claimDeposit({ userId: 'u1', txHash: '0x' + '4'.repeat(64), asset: 'ETH' });
    expect(result.status).toBe('PENDING');
  });
});
