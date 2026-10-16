import BigNumber from 'bignumber.js';
import { amount, decimal } from '../math';
import type { Side } from '../types';

/**
 * NATIVE DEMO FUNDING, VERSIONED BY SETTLEMENT TIME.
 *
 * The native account is a replay: every read and every command re-derives
 * the account from its journal, and funding is re-settled at each 8h UTC
 * boundary on the way. A rate can therefore never simply be "changed" — a
 * new constant would silently re-price every settlement the replay passes,
 * including ones the trader has already seen and been charged.
 *
 * So the terms are a SCHEDULE keyed by the settlement instant. A settlement
 * is always priced by the version whose `effectiveFrom` is the latest one at
 * or before it. Settlements before a version's start keep the terms they
 * were made under, byte for byte, on every replay, forever.
 *
 *   VOLTEX_CUSTOM_DEMO_V1  the owner's original demo cash-flow: a LONG is
 *                          debited 0.1% and a SHORT credited 0.4% of position
 *                          value per settlement. Not zero-sum, not provider
 *                          funding. Applies from the beginning of time.
 *   FIXED_RATE versions    one signed rate per 8h for every contract:
 *                          funding = quantity × mark × rate; a positive rate
 *                          debits LONG and credits SHORT, a negative one the
 *                          reverse. Never re-read from a provider.
 *
 * When a FIXED_RATE version starts is not written here. It is pinned ONCE,
 * in the database, to the first settlement boundary after the first process
 * that knows the version started (see PrismaNativeRepository.fundingSchedule):
 * that is the only instant guaranteed not to re-price anything the previous
 * code already showed. Every later start reads the same row.
 */
export const NATIVE_FUNDING_INTERVAL_MS = 28_800_000;

export interface LegacyFundingTerms {
  version: 'VOLTEX_CUSTOM_DEMO_V1';
  kind: 'SIDE_CASHFLOW';
  /** Signed fraction of position value per settlement, by side. */
  longCashflow: string;
  shortCashflow: string;
}
export interface FixedFundingTerms {
  version: string;
  kind: 'FIXED_RATE';
  /** Signed rate per 8h settlement, applied to quantity × mark. */
  rate: string;
}
export type FundingTerms = LegacyFundingTerms | FixedFundingTerms;
export type FundingScheduleEntry = FundingTerms & { effectiveFrom: number };
/** Sorted by `effectiveFrom`; the first entry always starts at 0. */
export type NativeFundingSchedule = readonly FundingScheduleEntry[];

export const LEGACY_FUNDING_TERMS: LegacyFundingTerms = Object.freeze({
  version: 'VOLTEX_CUSTOM_DEMO_V1', kind: 'SIDE_CASHFLOW', longCashflow: '-0.001', shortCashflow: '0.004',
});
export const LEGACY_FUNDING_SCHEDULE: NativeFundingSchedule = Object.freeze([Object.freeze({ ...LEGACY_FUNDING_TERMS, effectiveFrom: 0 })]);

/**
 * THE FIXED RATE THIS CODE SHIPS.
 *
 * `rate` is the equal-weight mean of the 8h-equivalent funding rates Bybit
 * actually settled on its most liquid USDT perpetuals over 30 complete UTC
 * days, as produced by `scripts/research/bybit-funding-average.mjs`, and
 * `evidence` is the SHA-256 of that script's JSON output committed under
 * `docs/research/`. While `rate` is null nothing is activated: the schedule
 * stays the legacy one and no account changes. A rate is never typed in by
 * hand and never refreshed from the API — a different number is a new
 * `version`, starting at its own boundary.
 */
export const NATIVE_FIXED_FUNDING: Readonly<{ version: string; rate: string | null; evidence: string | null }> = Object.freeze({
  version: 'BYBIT_LINEAR_30D_MEAN_V1',
  rate: null,
  evidence: null,
});

export class FundingModelError extends Error { constructor(public code: string) { super(code); } }

/** A FIXED_RATE value: a plain signed decimal, at most 8 places, |rate| < 1%. */
export function validFixedRate(rate: string): string {
  if (typeof rate !== 'string' || !/^-?(0|[1-9]\d*)(\.\d{1,8})?$/.test(rate)) throw new FundingModelError('INVALID_FUNDING_RATE');
  if (decimal(rate).abs().gte('0.01')) throw new FundingModelError('INVALID_FUNDING_RATE');
  return rate;
}

/** The first settlement boundary strictly AFTER `now`. */
export function nextFundingBoundaryAfter(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw new FundingModelError('INVALID_TIME');
  return (Math.floor(now / NATIVE_FUNDING_INTERVAL_MS) + 1) * NATIVE_FUNDING_INTERVAL_MS;
}

/** The legacy schedule followed by one pinned FIXED_RATE version. */
export function scheduleWithFixedRate(version: string, rate: string, effectiveFrom: number): NativeFundingSchedule {
  if (!Number.isSafeInteger(effectiveFrom) || effectiveFrom <= 0 || effectiveFrom % NATIVE_FUNDING_INTERVAL_MS !== 0) throw new FundingModelError('INVALID_EFFECTIVE_FROM');
  if (!version || version === LEGACY_FUNDING_TERMS.version) throw new FundingModelError('INVALID_FUNDING_VERSION');
  return Object.freeze([...LEGACY_FUNDING_SCHEDULE, Object.freeze({ version, kind: 'FIXED_RATE' as const, rate: validFixedRate(rate), effectiveFrom })]);
}

/** The terms a settlement at `time` is priced by. */
export function fundingTermsAt(schedule: NativeFundingSchedule, time: number): FundingScheduleEntry {
  let found: FundingScheduleEntry | undefined;
  for (const entry of schedule) if (entry.effectiveFrom <= time) found = entry;
  if (!found || schedule[0]?.effectiveFrom !== 0) throw new FundingModelError('FUNDING_SCHEDULE_INVALID');
  return found;
}

/**
 * The signed cash-flow of one settlement for one position, before any
 * isolated-margin cap: positive is credited to the position, negative is
 * debited. `notional` is quantity × mark — the full position value, never
 * divided or multiplied by leverage.
 */
export function fundingFlow(terms: FundingTerms, side: Side, notional: BigNumber): BigNumber {
  if (terms.kind === 'SIDE_CASHFLOW') return notional.times(side === 'LONG' ? terms.longCashflow : terms.shortCashflow);
  const charge = notional.times(terms.rate);
  return side === 'LONG' ? charge.negated() : charge;
}

/** The signed per-settlement fraction a side receives under `terms`, for display. */
export function fundingSideRate(terms: FundingTerms, side: Side): string {
  if (terms.kind === 'SIDE_CASHFLOW') return side === 'LONG' ? terms.longCashflow : terms.shortCashflow;
  return amount(side === 'LONG' ? decimal(terms.rate).negated() : decimal(terms.rate));
}

/** What the terminal is told about the schedule at `time`. */
export function fundingModelView(schedule: NativeFundingSchedule, time: number) {
  const active = fundingTermsAt(schedule, time);
  return {
    active: { ...active },
    intervalMs: NATIVE_FUNDING_INTERVAL_MS,
    /** The next version already pinned to start later, if any. */
    upcoming: schedule.find((e) => e.effectiveFrom > time) ?? null,
  };
}
