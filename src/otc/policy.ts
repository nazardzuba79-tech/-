import BigNumber from 'bignumber.js';
import { z } from 'zod';

export const OTC_ASSETS = { USDT: 6, USDC: 6, BTC: 8, ETH: 18 } as const;
export const OTC_TIERS = { 'otc-convert': '10000', 'cash-exchange': '50000', 'private-otc': '100000' } as const;
export const OTC_FIATS = ['USD','EUR','GBP','JPY','SGD','AED','RUB','CHF','UAH','KZT','BYN','CAD','AUD','CNY','HKD','PLN','TRY'] as const;
export const ACTIVE_OTC_STATUSES = ['RESERVED', 'OFFERED', 'ACCEPTED', 'PICKUP_READY', 'PAYOUT_IN_PROGRESS'];
export type OtcRoute = { country: string; cityId: string; asset: keyof typeof OTC_ASSETS; fiat: typeof OTC_FIATS[number]; cashPrecision: number };
export type OtcPolicy = { version: string; enabled: boolean; routes: readonly OtcRoute[]; approvedUserIds: readonly string[]; maxActive: number };
// Deliberately not enabled by geography, a browser flag, or KYC alone. The
// operator must supply reviewed legal/AML/customer and cash-desk approvals in
// a subsequent reviewed configuration change. Existing obligations stay usable.
export const OTC_POLICY: OtcPolicy = Object.freeze({ version: 'unconfigured-v1', enabled: false, routes: [], approvedUserIds: [], maxActive: 3 });
export class OtcError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function decimal(value: unknown, precision: number, allowZero = false): BigNumber {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(value)
      || (value.split('.')[1]?.length ?? 0) > precision) throw new OtcError('INVALID_DECIMAL', 400);
  const amount = new BigNumber(value);
  if (!amount.isFinite() || (allowZero ? amount.lt(0) : amount.lte(0))) throw new OtcError('INVALID_DECIMAL', 400);
  return amount;
}
export const createSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/), cityId: z.string().regex(/^geonames-\d{1,10}$/),
  asset: z.enum(['USDT','USDC','BTC','ETH']), fiat: z.enum(OTC_FIATS),
  tier: z.enum(['otc-convert','cash-exchange','private-otc']), quantity: z.string().max(38),
  idempotencyKey: z.string().uuid(),
}).strict();
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('offer'), rate: z.string(), fee: z.string(), expiresAt: z.string().datetime() }),
  z.object({ action: z.literal('accept'), offerVersion: z.number().int().positive() }),
  z.object({ action: z.literal('pickup'), address: z.string().trim().min(5).max(1500), appointment: z.string().datetime(), timezone: z.string().min(1).max(60) }),
  z.object({ action: z.literal('begin-payout') }),
  z.object({ action: z.literal('complete'), reference: z.string().trim().min(4).max(160) }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('confirm-cancel'), cashDeskConfirmed: z.literal(true) }),
]).and(z.object({ version: z.number().int().positive(), idempotencyKey: z.string().uuid() }));
export type CreateOtc = z.infer<typeof createSchema>;
export type OtcAction = z.infer<typeof actionSchema>;
