#!/usr/bin/env node
/*
 * Explicit, audited one-time funding of ONE account for ONE published
 * History20 private test listing (SIMUSDT, non-withdrawable).
 *
 *   node scripts/fund-history20-private.cjs --listing-id <id> --user-id <owner or allowlisted tester id> [--confirm]
 *
 * Without --confirm it only prints what it would do (dry run). It reads the
 * listing from the PUBLISHED catalogue (LISTINGS_STORE_URL/TOKEN), never a
 * draft, and credits via fundPrivateTestAccount: once per (listing, account),
 * only while HISTORY20_PRIVATE_TEST=enabled and only an account the
 * private test admits, base asset and SIMUSDT only, never USDT. Requires
 * `npm run build` first. Do not run against production without the owner's
 * separate approval.
 */
'use strict';
const { PrismaClient } = require('@prisma/client');
const { listingStoreFromEnvironment } = require('../dist/services/listings/store');
const { fundPrivateTestAccount, privateTestFundingReceiptId } = require('../dist/services/listings/privateTestFunding');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

(async () => {
  const listingId = arg('listing-id');
  const userId = arg('user-id');
  const confirm = process.argv.includes('--confirm');
  if (!listingId || !userId) throw new Error('Usage: --listing-id <id> --user-id <owner or allowlisted tester id> [--confirm]');
  const published = await listingStoreFromEnvironment().published();
  const listing = published.listings.find((item) => item.id === listingId);
  if (!listing) throw new Error(`Listing ${listingId} is not published`);
  if (!listing.config.privateTest) throw new Error(`Listing ${listingId} is not a History20 private test listing`);
  const plan = { listingId, version: listing.version, base: listing.config.symbol, quote: 'SIMUSDT',
    funding: listing.config.privateTest.funding, userId, receipt: privateTestFundingReceiptId(listingId, userId) };
  if (!confirm) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }
  const db = new PrismaClient();
  try {
    console.log(JSON.stringify(await fundPrivateTestAccount(db, listing, userId), null, 2));
  } finally {
    await db.$disconnect();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
