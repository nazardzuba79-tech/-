import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import { DepositService, DepositVerificationError, applyProof, recordProofFailure } from '../DepositService';
import { ProviderUnavailableError, TransferNotFoundError } from '../deposit-verifiers';
import { valueInUsd, meetsMinimum, packageToken, isPackageEligible, baseRowState } from '../deposits/depositPolicy';
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


function evmTransfer(value = '2.5', blockNumber = 100, head = 102, to = TREASURY) {
  mockJsonRpcProvider.mockImplementation(() => ({
    getTransactionReceipt: jest.fn().mockResolvedValue({ status: 1, blockNumber, logs: [] }),
    getBlockNumber: jest.fn().mockResolvedValue(head),
    getTransaction: jest.fn().mockResolvedValue({ to, value: ethers.parseEther(value) }),
  }));
}

function makePrisma(existing: any = null) {
  let row = existing;
  return {
    deposit: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async ({ create }: any) => (row = { id: 'dep1', revision: 0, verifyAttempts: 0, createdAt: new Date(), ...create })),
      updateMany: jest.fn(async ({ data }: any) => { row = { ...row, ...data }; return { count: 1 }; }),
      update: jest.fn(),
    },
    depositClaim: { upsert: jest.fn().mockResolvedValue({}) },
    treasuryAddressHistory: { upsert: jest.fn().mockResolvedValue({}) },
    balance: { upsert: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    referralReward: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

const noFinancialWrites = (prisma: any) => {
  expect(prisma.balance.upsert).not.toHaveBeenCalled();
  expect(prisma.balance.update).not.toHaveBeenCalled();
  expect(prisma.referralReward.create).not.toHaveBeenCalled();
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
};

describe('DepositService — detection and claims never credit', () => {
  it('rejects a transaction that does not pay the treasury address', async () => {
    evmTransfer('1', 100, 103, '0x000000000000000000000000000000000000bb');
    const prisma = makePrisma();
    await expect(new DepositService(prisma, chainConfig).recordObservation({ txHash: '0x' + '1'.repeat(64), asset: 'ETH', source: 'admin_check' }))
      .rejects.toThrow(DepositVerificationError);
    expect(prisma.deposit.upsert).not.toHaveBeenCalled();
  });

  it('stores a proven transfer UNATTRIBUTED with its measured proof — no balance, audit, referral or owner', async () => {
    evmTransfer('2.5', 100, 102);
    const prisma = makePrisma();
    const result = await new DepositService(prisma, chainConfig).recordObservation({ txHash: '0x' + '2'.repeat(64), asset: 'ETH', source: 'admin_check' });
    expect(result).toMatchObject({ recorded: true, amount: '2.5', confirmations: 3, finalized: true, status: 'PENDING' });
    const create = prisma.deposit.upsert.mock.calls[0][0].create;
    expect(create.userId).toBeUndefined();
    expect(create).toMatchObject({ chain: 'ethereum', asset: 'ETH', amount: '2.5', status: 'PENDING', source: 'admin_check', recipientAddress: TREASURY });
    expect(create.verifiedAt).toBeInstanceOf(Date);
    noFinancialWrites(prisma);
  });

  it('never re-verifies or touches a CREDITED transfer', async () => {
    const prisma = makePrisma({ id: 'd', asset: 'ETH', status: 'CREDITED', amount: '1', confirmations: 9, finalized: true, recipientAddress: TREASURY, blockTimestamp: null });
    await new DepositService(prisma, chainConfig).recordObservation({ txHash: '0x' + '3'.repeat(64), asset: 'ETH', source: 'incoming_feed' });
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
    expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
    noFinancialWrites(prisma);
  });

  it('a client claim stores a hint only: no chain call, no attribution, no deposit write', async () => {
    const prisma = makePrisma();
    const result = await new DepositService(prisma, chainConfig).submitClaim({ userId: 'u1', txHash: '0x' + 'A'.repeat(64), asset: 'eth' });
    expect(result).toEqual({ status: 'SUBMITTED' });
    expect(prisma.depositClaim.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: 'u1', chain: 'ethereum', txHash: '0x' + 'a'.repeat(64), asset: 'ETH' } }));
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
    expect(prisma.deposit.upsert).not.toHaveBeenCalled();
    noFinancialWrites(prisma);
  });
});

describe('applyProof / recordProofFailure', () => {
  const base = { id: 'd', revision: 4, status: 'PENDING', batchId: null, amount: '15', confirmations: 3, finalized: false,
    verifiedAt: new Date(), verifyError: null, verifyAttempts: 0, createdAt: new Date(Date.now() - 3600_000), blockNumber: null, blockTimestamp: null } as any;
  const proof = (amount: string, extra: any = {}) => ({ amount: new BigNumber(amount), confirmations: 25, blockNumber: 10, blockTimestamp: null, finalized: true, recipient: 'T', ...extra });

  it('a proven amount that later differs is flagged for review, never rewritten', async () => {
    const prisma = makePrisma(base);
    await applyProof(prisma, base, proof('16'));
    const { where, data } = prisma.deposit.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: 'd', revision: 4, status: { not: 'CREDITED' }, batchId: null });
    expect(data.verifyError).toMatch(/differs/);
    expect(data.amount).toBeUndefined();
  });

  it('an unproven (listed) amount is replaced by the proven one', async () => {
    const prisma = makePrisma({ ...base, verifiedAt: null });
    await applyProof(prisma, { ...base, verifiedAt: null }, proof('15.5'));
    expect(prisma.deposit.updateMany.mock.calls[0][0].data).toMatchObject({ amount: '15.5', finalized: true, confirmations: 25 });
  });

  it('provider trouble records nothing; not-found retries before flagging; a definitive answer flags at once', async () => {
    const prisma = makePrisma(base);
    expect(await recordProofFailure(prisma, base, new ProviderUnavailableError('HTTP 503'))).toBe('provider');
    expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
    expect(await recordProofFailure(prisma, base, new TransferNotFoundError('unknown'))).toBe('retry');
    expect(await recordProofFailure(prisma, { ...base, verifyAttempts: 4, createdAt: new Date(Date.now() - 3 * 3600_000) }, new TransferNotFoundError('unknown'))).toBe('flagged');
    expect(await recordProofFailure(prisma, base, new DepositVerificationError('Transaction failed on chain'))).toBe('flagged');
  });
});

describe('deposit policy', () => {
  const fresh = (price: string, ageMs = 0, stale = false) => ({ getTicker: jest.fn(), getTickerWithMeta: jest.fn().mockResolvedValue({ value: { lastPrice: price }, fetchedAt: Date.now() - ageMs, stale }) });

  it('USDT uses the explicit 1:1 minimum-evaluation policy; the minimum is exact', async () => {
    const v = await valueInUsd('USDT', new BigNumber('299.999999'), { getTicker: jest.fn() });
    expect(v.policy).toBe('USD_PEGGED_POLICY');
    expect(meetsMinimum(v.usd)).toBe(false);
    expect(meetsMinimum(new BigNumber('300'))).toBe(true);
    expect(meetsMinimum(null)).toBe(false);
  });

  it('other assets need a fresh, non-stale price; otherwise review, never an assumed pass', async () => {
    expect((await valueInUsd('BTC', new BigNumber('0.01'), { getTicker: jest.fn() })).reason).toBe('PRICE_UNAVAILABLE');
    expect((await valueInUsd('BTC', new BigNumber('0.01'), fresh('60000', 10 * 60_000))).reason).toBe('PRICE_STALE');
    expect((await valueInUsd('BTC', new BigNumber('0.01'), fresh('60000', 0, true))).reason).toBe('PRICE_STALE');
    const ok = await valueInUsd('BTC', new BigNumber('0.01'), fresh('60000'));
    expect(ok).toMatchObject({ policy: 'MARKET_PRICE', reason: null });
    expect(ok.usd!.toString()).toBe('600');
  });

  it('eligibility needs owner + proof + finality + depth; credited/batched rows never count', () => {
    const row = { id: 'x', userId: 'u', chain: 'tron', asset: 'USDT', amount: '1', confirmations: 20, status: 'PENDING', verifiedAt: new Date(), finalized: true, verifyError: null, batchId: null, revision: 0 };
    expect(isPackageEligible(row, 19)).toBe(true);
    expect(isPackageEligible({ ...row, userId: null }, 19)).toBe(false);
    expect(isPackageEligible({ ...row, finalized: false }, 19)).toBe(false);
    expect(isPackageEligible({ ...row, confirmations: 3 }, 19)).toBe(false);
    expect(isPackageEligible({ ...row, verifiedAt: null }, 19)).toBe(false);
    expect(isPackageEligible({ ...row, status: 'CREDITED' }, 19)).toBe(false);
    expect(isPackageEligible({ ...row, batchId: 'b' }, 19)).toBe(false);
    expect(baseRowState({ ...row, verifyError: 'x' }, 19)).toBe('NEEDS_REVIEW');
    expect(baseRowState({ ...row, userId: null }, 19)).toBe('UNATTRIBUTED');
  });

  it('the package fingerprint changes with composition, amount, owner or revision', () => {
    const rows = [{ id: 'a', revision: 1, amount: '15' }, { id: 'b', revision: 2, amount: '285' }];
    const t = packageToken('u', 'tron', 'USDT', rows);
    expect(packageToken('u', 'tron', 'usdt', [...rows].reverse())).toBe(t);
    expect(packageToken('u', 'tron', 'USDT', [rows[0]])).not.toBe(t);
    expect(packageToken('u', 'tron', 'USDT', [rows[0], { ...rows[1], revision: 3 }])).not.toBe(t);
    expect(packageToken('v', 'tron', 'USDT', rows)).not.toBe(t);
  });
});
