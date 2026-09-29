import { PrismaClient } from '@prisma/client';
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

  test('non-admin or unknown owner, another owner after the first, unexplained inventory, zero quantity: fail closed', async () => {
    await expect(allocateListingOwner(db, listing, other)).rejects.toThrow('ADMIN');
    await expect(allocateListingOwner(db, listing, randomUUID())).rejects.toThrow('ADMIN');
    await expect(allocateListingOwner(db, { ...listing, config: config({ ownerAllocation: '0' }) }, owner)).rejects.toThrow('no owner allocation');
    await db.balance.create({ data: { userId: owner, asset: listing.config.symbol, available: '1' } });
    await expect(allocateListingOwner(db, listing, owner)).rejects.toThrow('manual review');
    expect((await balance(owner, listing.config.symbol))!.available.toString()).toBe('1');
  });
});
