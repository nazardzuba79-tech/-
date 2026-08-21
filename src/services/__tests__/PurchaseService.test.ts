import { PurchaseService, PurchaseError } from '../PurchaseService';

function makePrismaMock(overrides: Partial<any> = {}) {
  const base = {
    product: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1', name: 'Consulting hour', priceAmount: { toString: () => '50' }, priceAsset: 'USDT', active: true,
      }),
    },
    balance: {
      findUnique: jest.fn().mockResolvedValue({ available: { toString: () => '100' }, locked: { toString: () => '0' } }),
      update: jest.fn(),
    },
    purchase: { create: jest.fn().mockResolvedValue({ id: 'purchase1', status: 'PENDING_FULFILLMENT' }) },
    auditLog: { create: jest.fn() },
    ...overrides,
  };
  return { ...base, $transaction: jest.fn((fn: any) => fn(base)) } as any;
}

describe('PurchaseService', () => {
  it('deducts balance and creates a pending purchase when funds are sufficient', async () => {
    const prisma = makePrismaMock();
    const service = new PurchaseService(prisma);

    const purchase = await service.purchaseProduct('user1', 'p1');

    expect(prisma.balance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { available: '50' } }) // 100 - 50
    );
    expect(purchase.status).toBe('PENDING_FULFILLMENT');
  });

  it('rejects the purchase when balance is insufficient', async () => {
    const prisma = makePrismaMock({
      balance: {
        findUnique: jest.fn().mockResolvedValue({ available: { toString: () => '10' }, locked: { toString: () => '0' } }),
        update: jest.fn(),
      },
    });
    const service = new PurchaseService(prisma);

    await expect(service.purchaseProduct('user1', 'p1')).rejects.toThrow(PurchaseError);
    expect(prisma.balance.update).not.toHaveBeenCalled();
  });

  it('rejects when the product is inactive', async () => {
    const prisma = makePrismaMock({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1', priceAmount: { toString: () => '50' }, priceAsset: 'USDT', active: false,
        }),
      },
    });
    const service = new PurchaseService(prisma);

    await expect(service.purchaseProduct('user1', 'p1')).rejects.toThrow(PurchaseError);
  });

  it('rejects when the product does not exist', async () => {
    const prisma = makePrismaMock({ product: { findUnique: jest.fn().mockResolvedValue(null) } });
    const service = new PurchaseService(prisma);

    await expect(service.purchaseProduct('user1', 'missing')).rejects.toThrow(PurchaseError);
  });

  it('treats a zero balance record (no prior deposit) as insufficient rather than throwing', async () => {
    const prisma = makePrismaMock({ balance: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    const service = new PurchaseService(prisma);

    await expect(service.purchaseProduct('user1', 'p1')).rejects.toThrow(PurchaseError);
  });
});
