import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { allocateListingOwner, allocationReceiptId } from '../ownerAllocation';
import type { ListingConfig, PublishedListing } from '../listingConfig';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Listing allocation tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const config = (extra: Partial<ListingConfig> = {}): ListingConfig => ({
  schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt: '2026-10-01T12:00:00Z',
  displayTimeZone: 'Europe/Kyiv', ownerAllocation: '1000.5', seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true, ...extra,
});

pg('managed listing owner allocation on disposable PostgreSQL', () => {
  let db: PrismaClient, owner: string, other: string, listing: PublishedListing;
  const balance = (userId: string, asset: string) => db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    owner = randomUUID(); other = randomUUID();
    listing = { id: `qax-${randomUUID().slice(0, 8)}`, version: 1, publishedAt: '2026-10-01T10:00:00Z', config: config({ symbol: `Q${randomUUID().replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()}`.replace(/^Q\d/, 'QA') }) };
    await db.user.createMany({ data: [owner, other].map((id, i) => ({ id, email: `${id}@listing.invalid`, referralCode: id, passwordHash: 'fixture', role: i ? 'USER' : 'ADMIN' })) });
    await db.balance.create({ data: { userId: owner, asset: 'USDT', available: '1000' } });
  });

  test('exact configured quantity to the verified ADMIN, no USDT created or debited, audited once', async () => {
    const usdt = await balance(owner, 'USDT');
    expect(await allocateListingOwner(db, listing, owner)).toMatchObject({ applied: true, quantity: '1000.5', asset: listing.config.symbol });
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('1000.5');
    expect(await balance(owner, 'USDT')).toEqual(usdt);
    expect(await balance(other, listing.config.symbol)).toBeNull();
    const receipt = await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } });
    expect(receipt).toMatchObject({ userId: owner, action: 'LISTING_OWNER_ALLOCATION' });
    expect((receipt!.metadata as any).usdtDebit).toBe('0');
  });

  test('concurrent and repeated calls credit once, even after trading changed the inventory', async () => {
    const results = await Promise.all([1, 2, 3].map(() => allocateListingOwner(db, listing, owner)));
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    await db.balance.update({ where: { userId_asset: { userId: owner, asset: listing.config.symbol } }, data: { available: '10' } });
    expect((await allocateListingOwner(db, listing, owner)).applied).toBe(false);
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('10');
  });

  test('a receipt emitted before the safeguard remains valid after display-only republish and equivalent decimal formatting', async () => {
    await allocateListingOwner(db, listing, owner);
    const receipt = await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } });
    const changedDisplay = { ...listing, version: 2, config: { ...listing.config, name: 'QA Renamed', ownerAllocation: '1000.50000000' } };
    expect(await allocateListingOwner(db, changedDisplay, owner)).toEqual({
      applied: false, userId: owner, asset: listing.config.symbol, quantity: '1000.5',
    });
    expect(await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } })).toEqual(receipt);
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('1000.5');
  });

  test('changed exact quantity or asset cannot reinterpret a prior allocation receipt', async () => {
    listing = { ...listing, config: { ...listing.config, ownerAllocation: '9007199254740993.00000001' } };
    await allocateListingOwner(db, listing, owner);
    const assetBefore = await balance(owner, listing.config.symbol);
    const usdtBefore = await balance(owner, 'USDT');
    const receiptBefore = await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } });
    for (const extra of [{ ownerAllocation: '9007199254740993.00000002' }, { symbol: 'QAOTHER' }]) {
      await expect(allocateListingOwner(db, { ...listing, config: { ...listing.config, ...extra } }, owner))
        .rejects.toThrow('Allocation receipt conflicts');
    }
    expect(await balance(owner, listing.config.symbol)).toEqual(assetBefore);
    expect(await balance(owner, 'QAOTHER')).toBeNull();
    expect(await balance(owner, 'USDT')).toEqual(usdtBefore);
    expect(await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } })).toEqual(receiptBefore);
  });

  test.each(['foreign action', 'foreign listing', 'foreign asset', 'numeric quantity', 'malformed quantity', 'null metadata', 'array metadata'])
  ('a %s receipt fails closed without changing any balance or receipt', async (kind) => {
    await allocateListingOwner(db, listing, owner);
    const receiptId = allocationReceiptId(listing.id);
    const prior = (await db.auditLog.findUnique({ where: { id: receiptId } }))!;
    const metadata = prior.metadata as Prisma.JsonObject;
    const changes: Record<string, Prisma.AuditLogUpdateInput> = {
      'foreign action': { action: 'ANOTHER_ALLOCATION' },
      'foreign listing': { metadata: { ...metadata, listingId: 'qa-foreign-listing' } },
      'foreign asset': { metadata: { ...metadata, asset: 'QAOTHER' } },
      'numeric quantity': { metadata: { ...metadata, quantity: 1000.5 } },
      'malformed quantity': { metadata: { ...metadata, quantity: 'NaN' } },
      'null metadata': { metadata: Prisma.JsonNull },
      'array metadata': { metadata: [] },
    };
    await db.auditLog.update({ where: { id: receiptId }, data: changes[kind] });
    const receiptBefore = await db.auditLog.findUnique({ where: { id: receiptId } });
    const balancesBefore = await db.balance.findMany({ where: { userId: owner }, orderBy: { asset: 'asc' } });
    await expect(allocateListingOwner(db, listing, owner)).rejects.toThrow('Allocation receipt conflicts');
    expect(await db.balance.findMany({ where: { userId: owner }, orderBy: { asset: 'asc' } })).toEqual(balancesBefore);
    expect(await db.auditLog.findUnique({ where: { id: receiptId } })).toEqual(receiptBefore);
  });

  test('another verified ADMIN cannot reuse the owner receipt', async () => {
    await allocateListingOwner(db, listing, owner);
    await db.user.update({ where: { id: other }, data: { role: 'ADMIN' } });
    await expect(allocateListingOwner(db, listing, other)).rejects.toThrow('Allocation belongs to another owner');
    expect(await balance(other, listing.config.symbol)).toBeNull();
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('1000.5');
  });

  test('an audit write failure rolls the credit back in the actual database transaction', async () => {
    const failingReceipt = {
      $transaction: (fn: (tx: Prisma.TransactionClient) => unknown) => db.$transaction(async (tx) => fn(new Proxy(tx, {
        get: (target, prop) => prop === 'auditLog'
          ? { findUnique: target.auditLog.findUnique.bind(target.auditLog), create: async () => { throw new Error('receipt failure'); } }
          : target[prop as keyof typeof target],
      }))),
    } as unknown as PrismaClient;
    const usdtBefore = await balance(owner, 'USDT');
    await expect(allocateListingOwner(failingReceipt, listing, owner)).rejects.toThrow('receipt failure');
    expect(await balance(owner, listing.config.symbol)).toBeNull();
    expect(await balance(owner, 'USDT')).toEqual(usdtBefore);
    expect(await db.auditLog.findUnique({ where: { id: allocationReceiptId(listing.id) } })).toBeNull();
  });

  test('non-admin or unknown owner, another owner after the first, unexplained inventory, zero quantity: fail closed', async () => {
    await expect(allocateListingOwner(db, listing, other)).rejects.toThrow('ADMIN');
    await expect(allocateListingOwner(db, listing, randomUUID())).rejects.toThrow('ADMIN');
    await expect(allocateListingOwner(db, { ...listing, config: config({ ownerAllocation: '0' }) }, owner)).rejects.toThrow('no owner allocation');
    await db.balance.create({ data: { userId: owner, asset: listing.config.symbol, available: '1' } });
    await expect(allocateListingOwner(db, listing, owner)).rejects.toThrow('manual review');
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('1');
  });
});
