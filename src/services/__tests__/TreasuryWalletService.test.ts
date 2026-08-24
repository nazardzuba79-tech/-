import { TreasuryWalletService } from '../TreasuryWalletService';
import { ChainConfig } from '../../config/chains';

function makePrismaMock() {
  const store = new Map<string, any>();
  return {
    treasuryWallet: {
      findMany: jest.fn(async () => Array.from(store.values()).sort((a, b) => a.chain.localeCompare(b.chain))),
      findUnique: jest.fn(async ({ where }: any) => store.get(where.chain) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = store.get(where.chain);
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { ...create, updatedAt: new Date(), createdAt: new Date() };
        store.set(where.chain, row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const existed = store.has(where.chain);
        store.delete(where.chain);
        return { count: existed ? 1 : 0 };
      }),
    },
    _store: store,
  } as any;
}

const baseConfig: ChainConfig = {
  chain: 'bitcoin',
  type: 'bitcoin',
  treasuryAddress: 'bc1qenv-default',
  minConfirmations: 2,
  nativeAsset: 'BTC',
  tokens: {},
};

describe('TreasuryWalletService', () => {
  it('returns the config unchanged when no override exists', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);

    const result = await service.applyOverride(baseConfig);

    expect(result).toEqual(baseConfig);
  });

  it('overrides the treasury address once a row exists for that chain', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);

    await service.upsert('bitcoin', 'bc1qadmin-set', 'admin-1');
    const result = await service.applyOverride(baseConfig);

    expect(result).toEqual({ ...baseConfig, treasuryAddress: 'bc1qadmin-set' });
  });

  it('leaves every other config field untouched when overriding', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);
    const evmConfig: ChainConfig = {
      chain: 'ethereum',
      type: 'evm',
      treasuryAddress: '0xenv',
      minConfirmations: 12,
      nativeAsset: 'ETH',
      tokens: { USDT: { contractAddress: '0xusdt', decimals: 6 } },
      rpcUrl: 'https://rpc.example',
    };

    await service.upsert('ethereum', '0xadmin', 'admin-1');
    const result = await service.applyOverride(evmConfig);

    expect(result).toEqual({ ...evmConfig, treasuryAddress: '0xadmin' });
  });

  it('upsert updates an existing row instead of creating a duplicate', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);

    await service.upsert('bitcoin', 'bc1qfirst', 'admin-1');
    await service.upsert('bitcoin', 'bc1qsecond', 'admin-2');

    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chain: 'bitcoin', address: 'bc1qsecond', updatedByAdminId: 'admin-2' });
  });

  it('remove() reverts a chain back to no override, harmlessly if none existed', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);

    await service.upsert('bitcoin', 'bc1qset', 'admin-1');
    await service.remove('bitcoin');
    await expect(service.remove('bitcoin')).resolves.toBeUndefined();

    const result = await service.applyOverride(baseConfig);
    expect(result).toEqual(baseConfig);
  });

  it('list() returns every override sorted by chain', async () => {
    const prisma = makePrismaMock();
    const service = new TreasuryWalletService(prisma);

    await service.upsert('tron', 'Ttron', 'admin-1');
    await service.upsert('bitcoin', 'bc1qbtc', 'admin-1');

    const rows = await service.list();
    expect(rows.map((r) => r.chain)).toEqual(['bitcoin', 'tron']);
  });

  describe('resolve()', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
      delete process.env.BITCOIN_TREASURY_ADDRESS;
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    });
    afterAll(() => {
      process.env = OLD_ENV;
    });

    it('throws when there is no treasury address anywhere — env or override', async () => {
      const prisma = makePrismaMock();
      const service = new TreasuryWalletService(prisma);

      await expect(service.resolve('bitcoin')).rejects.toThrow('No treasury address configured');
    });

    it('resolves using the env-var address when no override exists', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qenv-default';
      const prisma = makePrismaMock();
      const service = new TreasuryWalletService(prisma);

      const config = await service.resolve('bitcoin');

      expect(config.treasuryAddress).toBe('bc1qenv-default');
    });

    // The actual bug this guards against: an admin sets a treasury address
    // purely through the admin panel, on a deployment where the
    // *_TREASURY_ADDRESS env var was never set. That must work — the whole
    // point of TreasuryWalletService is "no redeploy, no env var edit".
    it('resolves using the admin override even when the env var was never set', async () => {
      const prisma = makePrismaMock();
      const service = new TreasuryWalletService(prisma);
      await service.upsert('bitcoin', 'bc1qadmin-set', 'admin-1');

      const config = await service.resolve('bitcoin');

      expect(config.treasuryAddress).toBe('bc1qadmin-set');
      expect(config.nativeAsset).toBe('BTC');
    });
  });
});
