import BigNumber from 'bignumber.js';
import { decimal } from '../math';
import type { Side } from '../types';
import { VOLTEX_FUNDING } from '../../config/voltexFunding';

/**
 * NATIVE DEMO FUNDING, VERSIONED BY SETTLEMENT TIME.
 *
 * The native account is a replay: every read and every command re-derives
 * the account from its journal, and funding is re-settled at each 8h UTC
 * boundary on the way. A rate can therefore never simply be "changed" — a
 * new constant would silently re-price every settlement the replay passes,
 * including ones the trader has already seen and been paid or charged.
 *
 * So the terms are a SCHEDULE keyed by the settlement instant. A settlement
 * is always priced by the version whose `effectiveFrom` is the latest one at
 * or before it. Settlements before a version's start keep the terms they
 * were made under, byte for byte, on every replay, forever.
 *
 *   VOLTEX_CUSTOM_DEMO_V1  the original demo cash-flow: a LONG is debited
 *                          0.1% and a SHORT credited 0.4% of position value
 *                          per settlement. Applies from the beginning of time
 *                          up to the next version's pinned start.
 *   VOLTEX_FIXED_V2        the owner's standard rates (config/voltexFunding):
 *                          the same directions, ten times smaller — a LONG
 *                          is debited 0.01% and a SHORT credited 0.04%.
 *
 * Both are signed fractions of position value (quantity × boundary mark) per
 * side — positive is credited, negative debited — never multiplied by
 * leverage and never read from a provider.
 *
 * When V2 starts is not written here. It is pinned ONCE, in the database, to
 * the first settlement boundary after the first process that knows V2
 * started (see pinNativeFundingSchedule in store.ts): that is the only
 * instant guaranteed not to re-price anything the previous code already
 * settled. Every later start reads the same row.
 */
export const NATIVE_FUNDING_INTERVAL_MS = 28_800_000;

export interface FundingTerms {
  version: string;
  /** Signed fraction of position value per settlement, by side: positive is credited. */
  longCashflow: string;
  shortCashflow: string;
}
export type FundingScheduleEntry = FundingTerms & { effectiveFrom: number };
/** Sorted by `effectiveFrom`; the first entry always starts at 0. */
export type NativeFundingSchedule = readonly FundingScheduleEntry[];

export const LEGACY_FUNDING_TERMS: Readonly<FundingTerms> = Object.freeze({
  version: 'VOLTEX_CUSTOM_DEMO_V1', longCashflow: '-0.001', shortCashflow: '0.004',
});
export const LEGACY_FUNDING_SCHEDULE: NativeFundingSchedule = Object.freeze([Object.freeze({ ...LEGACY_FUNDING_TERMS, effectiveFrom: 0 })]);

/** The version this code ships and pins: the owner's standard rates. */
export const NATIVE_CURRENT_FUNDING: Readonly<FundingTerms> = Object.freeze({
  version: VOLTEX_FUNDING.version, longCashflow: VOLTEX_FUNDING.longCashflow, shortCashflow: VOLTEX_FUNDING.shortCashflow,
});

export class FundingModelError extends Error { constructor(public code: string) { super(code); } }

/** One side's cash-flow fraction: a plain signed decimal, at most 8 places, |value| < 1%. */
export function validCashflow(value: string): string {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d{1,8})?$/.test(value)) throw new FundingModelError('INVALID_FUNDING_RATE');
  if (decimal(value).abs().gte('0.01')) throw new FundingModelError('INVALID_FUNDING_RATE');
  return value;
}

/** The first settlement boundary strictly AFTER `now`. */
export function nextFundingBoundaryAfter(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new FundingModelError('INVALID_TIME');
  return (Math.floor(now / NATIVE_FUNDING_INTERVAL_MS) + 1) * NATIVE_FUNDING_INTERVAL_MS;
}

/** The legacy schedule followed by one pinned later version. */
export function scheduleWith(terms: FundingTerms, effectiveFrom: number): NativeFundingSchedule {
  if (!Number.isSafeInteger(effectiveFrom) || effectiveFrom <= 0 || effectiveFrom % NATIVE_FUNDING_INTERVAL_MS !== 0) throw new FundingModelError('INVALID_EFFECTIVE_FROM');
  if (!terms.version || terms.version === LEGACY_FUNDING_TERMS.version) throw new FundingModelError('INVALID_FUNDING_VERSION');
  return Object.freeze([...LEGACY_FUNDING_SCHEDULE, Object.freeze({
    version: terms.version, longCashflow: validCashflow(terms.longCashflow), shortCashflow: validCashflow(terms.shortCashflow), effectiveFrom,
  })]);
}

/** The terms a settlement at `time` is priced by. */
export function fundingTermsAt(schedule: NativeFundingSchedule, time: number): FundingScheduleEntry {
  let found: FundingScheduleEntry | undefined;
  for (const entry of schedule) if (entry.effectiveFrom <= time) found = entry;
  if (!found || schedule[0]?.effectiveFrom !== 0) throw new FundingModelError('FUNDING_SCHEDULE_INVALID');
  return found;
}

/** Whether `terms` is the original model, whose events keep their original shape. */
export const isLegacyFunding = (terms: FundingTerms) => terms.version === LEGACY_FUNDING_TERMS.version;

/** The signed fraction `side` is credited under `terms` (negative = debited). */
export function fundingSideRate(terms: FundingTerms, side: Side): string {
  return side === 'LONG' ? terms.longCashflow : terms.shortCashflow;
}

/**
 * The signed cash-flow of one settlement for one position, before any
 * isolated-margin cap: positive is credited to the position, negative is
 * debited. `notional` is quantity × mark — the full position value, never
 * divided or multiplied by leverage.
 */
export function fundingFlow(terms: FundingTerms, side: Side, notional: BigNumber): BigNumber {
  return notional.times(fundingSideRate(terms, side));
}

/**
 * What the terminal is told: the terms the NEXT settlement after `time` will
 * use (what a position opened now is paid at), the terms in force at `time`,
 * and the interval.
 */
export function fundingModelView(schedule: NativeFundingSchedule, time: number) {
  const next = nextFundingBoundaryAfter(time);
  return {
    current: { ...fundingTermsAt(schedule, time) },
    next: { ...fundingTermsAt(schedule, next), settlesAt: next },
    intervalMs: NATIVE_FUNDING_INTERVAL_MS,
  };
}
