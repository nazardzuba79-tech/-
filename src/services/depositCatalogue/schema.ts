import { z } from 'zod';
import { DEPOSIT_RAILS, railKey, validAddress } from './registry';

export const entrySchema = z.object({
  assetId: z.string().max(80), networkId: z.string().max(40),
  address: z.string().trim().max(256), enabled: z.boolean(),
  memo: z.string().trim().max(128).regex(/^[^<>\x00-\x1f]*$/).default(''),
  memoLabel: z.string().trim().max(40).regex(/^[\p{L}\p{N} ._/-]*$/u).default(''),
}).strict().superRefine((entry, ctx) => {
  const rail = DEPOSIT_RAILS.find(r => railKey(r) === railKey(entry));
  if (!rail) ctx.addIssue({ code: 'custom', message: 'Unknown asset/network' });
  if (entry.address && !validAddress(entry.networkId, entry.address)) ctx.addIssue({ code: 'custom', message: 'Invalid address format' });
  if (entry.enabled && !entry.address) ctx.addIssue({ code: 'custom', message: 'Enabled address is required' });
  if ((entry.memo || entry.memoLabel) && !rail?.memoAllowed) ctx.addIssue({ code: 'custom', message: 'Memo not supported on this network' });
  if (entry.networkId === 'xrp' && entry.memo && (!/^\d+$/.test(entry.memo) || BigInt(entry.memo) > 4294967295n))
    ctx.addIssue({ code: 'custom', message: 'Invalid destination tag' });
});
export type AddressEntry = z.infer<typeof entrySchema>;
export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  // Verified one-time snapshot of existing resolved addresses, including DB
  // overrides. Runtime NEVER reads TreasuryWallet to construct this snapshot.
  baseline: z.array(entrySchema).max(200),
  overrides: z.array(entrySchema).max(200),
}).strict().superRefine((doc, ctx) => {
  for (const list of [doc.baseline, doc.overrides]) if (new Set(list.map(railKey)).size !== list.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate asset/network' });
});
export type CatalogueDocument = z.infer<typeof documentSchema>;
export interface StoredCatalogue { revision: string; document: CatalogueDocument }
