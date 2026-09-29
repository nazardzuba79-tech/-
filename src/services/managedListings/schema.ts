import { z } from 'zod';

// A new namespace: legacy assets can never be edited or republished here.
export const RESERVED_TICKERS = new Set(['VTA', 'NRX', 'USDT', 'USDC', 'USD', 'EUR', 'BTC', 'ETH', 'BNB', 'SOL', 'TON', 'POL']);
const decimal = z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,8})?$/);
export const listingInput = z.object({
  name: z.string().trim().min(2).max(64),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,11}$/).refine(s => !RESERVED_TICKERS.has(s), 'reserved_ticker'),
  // Embedded raster only: no remote trackers, SVG scripts, or server URL fetching.
  logo: z.string().max(90_000).regex(/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  initialPrice: decimal.refine(s => Number(s) > 0 && Number(s) <= 1_000_000_000, 'invalid_price'),
  listingAt: z.string().datetime({ offset: true }).refine(s => Number.isFinite(Date.parse(s)), 'invalid_date'),
  ownerAllocation: decimal,
  seed: z.string().trim().min(1).max(128).optional(),
}).strict();
export type ListingInput = z.infer<typeof listingInput>;
export type ManagedListing = Omit<ListingInput, 'seed'> & {
  id: string; pair: string; seed: string; revision: number; version: 1;
  status: 'draft' | 'published'; createdBy: string; createdAt: string; publishedAt?: string;
};
export class ListingError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function validateListing(input: unknown, now: number, creating = true): ListingInput {
  const parsed = listingInput.safeParse(input);
  if (!parsed.success) throw new ListingError('invalid_listing');
  const date = Date.parse(parsed.data.listingAt);
  if (creating && (date <= now || date > now + 366 * 86400_000)) throw new ListingError('invalid_listing_date');
  const [prefix, base64] = parsed.data.logo.split(',');
  // Validate signature too; a renamed HTML/SVG upload is not a logo.
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const valid = prefix.includes('png') ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    : prefix.includes('jpeg') ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!valid) throw new ListingError('invalid_logo');
  return parsed.data;
}
