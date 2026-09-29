#!/usr/bin/env node
/*
 * Explicit, audited owner allocation for ONE published managed listing.
 *
 *   node scripts/allocate-listing-owner.cjs --listing-id <id> --owner-id <verified ADMIN user id> [--confirm]
 *
 * Without --confirm it only prints what it would do (dry run). It reads the
 * listing from the PUBLISHED catalogue (LISTINGS_STORE_URL/TOKEN), never a
 * draft, and credits via allocateListingOwner: once per listing, verified
 * ADMIN only, no USDT created or debited. Requires `npm run build` first.
 * Do not run against production without the owner's separate approval.
 */
'use strict';
const { PrismaClient } = require('@prisma/client');
const { listingStoreFromEnvironment } = require('../dist/services/listings/store');
const { allocateListingOwner, allocationReceiptId } = require('../dist/services/listings/ownerAllocation');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

(async () => {
  const listingId = arg('listing-id');
  const ownerId = arg('owner-id');
  const confirm = process.argv.includes('--confirm');
  if (!listingId || !ownerId) throw new Error('Usage: --listing-id <id> --owner-id <verified ADMIN id> [--confirm]');
  const published = await listingStoreFromEnvironment().published();
  const listing = published.listings.find((item) => item.id === listingId);
  if (!listing) throw new Error(`Listing ${listingId} is not published`);
  const plan = { listingId, version: listing.version, asset: listing.config.symbol, quantity: listing.config.ownerAllocation, ownerId, receipt: allocationReceiptId(listingId) };
  if (!confirm) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }
  const db = new PrismaClient();
  try {
    console.log(JSON.stringify(await allocateListingOwner(db, listing, ownerId), null, 2));
  } finally {
    await db.$disconnect();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
