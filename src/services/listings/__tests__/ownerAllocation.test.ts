import type { PrismaClient } from '@prisma/client';
import { allocateListingOwner, allocationReceiptId } from '../ownerAllocation';
import type { PublishedListing } from '../listingConfig';

const ownerId = 'qa-verified-owner';
const listing: PublishedListing = {
  id: 'qa-receipt-review', version: 1, publishedAt: '2026-09-29T16:00:00Z',
  config: {
    schemaVersion: 1, symbol: 'QAREPLAY', name: 'QA Receipt Review', logo: null,
    initialPrice: '0.25', listingAt: '2026-10-01T12:00:00Z', displayTimeZone: 'UTC',
    ownerAllocation: '9007199254740993.00000001', seedMode: 'manual', seed: 'qa-receipt-review', tradable: true,
  },
};

/** The exact shape written by the released helper before this safeguard. */
const receipt = () => ({
  id: allocationReceiptId(listing.id), userId: ownerId, action: 'LISTING_OWNER_ALLOCATION',
  metadata: {
    listingId: listing.id, version: 1, asset: listing.config.symbol, quantity: listing.config.ownerAllocation,
    initialPriceUsdt: '0.25', initialValueUsdt: '2251799813685248.2500000025', usdtDebit: '0', usdtCredit: '0',
  },
});

function fixture(prior: unknown) {
  const writes = jest.fn();
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findUnique: jest.fn().mockResolvedValue({ id: ownerId, role: 'ADMIN' }) },
    auditLog: { findUnique: jest.fn().mockResolvedValue(prior), create: writes },
    balance: { findUnique: writes, upsert: writes },
  };
  const db = { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  return { db, writes };
}

test('replays a receipt emitted by main exactly, including after a display-only version change', async () => {
  const { db, writes } = fixture(receipt());
  const renamed = { ...listing, version: 2, config: { ...listing.config, name: 'QA Renamed' } };
  await expect(allocateListingOwner(db, renamed, ownerId)).resolves.toEqual({
    applied: false, userId: ownerId, asset: 'QAREPLAY', quantity: '9007199254740993.00000001',
  });
  expect(writes).not.toHaveBeenCalled();
});

test('an exact decimal allocation change cannot replay as the previously credited quantity', async () => {
  const changed = '9007199254740993.00000002';
  // A floating-point comparison would miss this one-unit-at-8-decimals difference.
  expect(Number(changed)).toBe(Number(listing.config.ownerAllocation));
  const { db, writes } = fixture(receipt());
  await expect(allocateListingOwner(db, { ...listing, config: { ...listing.config, ownerAllocation: changed } }, ownerId))
    .rejects.toThrow('Allocation receipt conflicts');
  expect(writes).not.toHaveBeenCalled();
});

test('a different asset cannot reuse another asset receipt for the same listing id', async () => {
  const { db, writes } = fixture(receipt());
  await expect(allocateListingOwner(db, { ...listing, config: { ...listing.config, symbol: 'QAOTHER' } }, ownerId))
    .rejects.toThrow('Allocation receipt conflicts');
  expect(writes).not.toHaveBeenCalled();
});

test.each([
  ['foreign action', { ...receipt(), action: 'ANOTHER_ALLOCATION' }],
  ['foreign listing', { ...receipt(), metadata: { ...receipt().metadata, listingId: 'qa-other-listing' } }],
  ['foreign asset', { ...receipt(), metadata: { ...receipt().metadata, asset: 'QAOTHER' } }],
  ['missing metadata', { ...receipt(), metadata: null }],
  ['array metadata', { ...receipt(), metadata: [] }],
  ['missing quantity', { ...receipt(), metadata: { listingId: listing.id, asset: listing.config.symbol } }],
  ['numeric quantity', { ...receipt(), metadata: { ...receipt().metadata, quantity: 9007199254740993 } }],
  ['non-finite quantity', { ...receipt(), metadata: { ...receipt().metadata, quantity: 'NaN' } }],
  ['zero quantity', { ...receipt(), metadata: { ...receipt().metadata, quantity: '0' } }],
  ['negative quantity', { ...receipt(), metadata: { ...receipt().metadata, quantity: '-1' } }],
] as const)('refuses a %s receipt without any balance or audit write', async (_name, prior) => {
  const { db, writes } = fixture(prior);
  await expect(allocateListingOwner(db, listing, ownerId)).rejects.toThrow('Allocation receipt conflicts');
  expect(writes).not.toHaveBeenCalled();
});

test('another owner remains a conflict before checking the receipt contents', async () => {
  const { db, writes } = fixture({ ...receipt(), userId: 'qa-other-owner' });
  await expect(allocateListingOwner(db, listing, ownerId)).rejects.toThrow('Allocation belongs to another owner');
  expect(writes).not.toHaveBeenCalled();
});
