process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import { ApiKeyService, encryptApiSecret, decryptApiSecret } from '../ApiKeyService';

describe('encryptApiSecret / decryptApiSecret', () => {
  it('round-trips a secret', () => {
    const encrypted = encryptApiSecret('my-plaintext-secret');
    expect(encrypted).not.toContain('my-plaintext-secret');
    expect(decryptApiSecret(encrypted)).toBe('my-plaintext-secret');
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptApiSecret('same-secret')).not.toBe(encryptApiSecret('same-secret'));
  });
});

describe('ApiKeyService', () => {
  function makePrismaMock() {
    const store = new Map<string, any>();
    return {
      apiKey: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `key-${store.size + 1}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data };
          store.set(row.id, row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          Array.from(store.values()).filter((k) => k.userId === where.userId && k.revokedAt === where.revokedAt)
        ),
        findUnique: jest.fn(async ({ where }: any) => store.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = store.get(where.id);
          Object.assign(row, data);
          return row;
        }),
      },
    } as any;
  }

  it('creates a key and returns the plaintext secret exactly once', async () => {
    const prisma = makePrismaMock();
    const service = new ApiKeyService(prisma);

    const created = await service.createKey('user-1', 'My bot', true);

    expect(created.apiKey).toMatch(/^ak_[0-9a-f]{32}$/);
    expect(created.apiSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.canTrade).toBe(true);

    const stored = prisma.apiKey.create.mock.calls[0][0].data;
    expect(stored.encryptedSecret).not.toContain(created.apiSecret);
  });

  it('lists only the caller\'s own non-revoked keys, without the secret', async () => {
    const prisma = makePrismaMock();
    const service = new ApiKeyService(prisma);
    await service.createKey('user-1', 'Bot A', false);
    await service.createKey('user-2', 'Someone else\'s bot', false);

    const list = await service.listKeys('user-1');

    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('Bot A');
    expect((list[0] as any).apiSecret).toBeUndefined();
    expect((list[0] as any).encryptedSecret).toBeUndefined();
  });

  it('revokes a key owned by the caller', async () => {
    const prisma = makePrismaMock();
    const service = new ApiKeyService(prisma);
    const created = await service.createKey('user-1', 'Bot A', false);

    const revoked = await service.revokeKey('user-1', created.id);

    expect(revoked).toBe(true);
    expect((await service.listKeys('user-1'))).toHaveLength(0);
  });

  it('refuses to revoke a key belonging to a different user', async () => {
    const prisma = makePrismaMock();
    const service = new ApiKeyService(prisma);
    const created = await service.createKey('user-1', 'Bot A', false);

    const revoked = await service.revokeKey('user-2', created.id);

    expect(revoked).toBe(false);
    expect((await service.listKeys('user-1'))).toHaveLength(1);
  });
});
