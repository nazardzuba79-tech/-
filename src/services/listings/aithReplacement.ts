import { isAith } from '../../shared/aithPublication';
import { ListingValidationError, parseListingConfig, type ListingConfig } from './listingConfig';

/** A separate append-only operation, never an exception to checkPublishable/HISTORY_LOCKED. */
export function aithReplacementConfig(active: ListingConfig, input: unknown, now: number): ListingConfig {
  const next = parseListingConfig(input);
  const reject = (code: string, message: string): never => { throw new ListingValidationError(code, message); };
  if (!isAith(active.symbol) || next.symbol !== active.symbol) reject('REPLACEMENT_NOT_SUPPORTED', 'Replacement is restricted to AITH');
  if (Date.parse(active.listingAt) <= now + 60_000) reject('HISTORY_LOCKED', 'The listing has started or its replacement window has closed');
  if (active.tradable || next.tradable || Number(active.ownerAllocation) !== 0 || Number(next.ownerAllocation) !== 0) {
    reject('HISTORY_LOCKED', 'Only a non-tradable, unallocated publication can be replaced');
  }
  if (active.simulationProgram?.kind !== 'capped-growth-range-v1' || next.simulationProgram?.kind !== 'capped-growth-range-v1') {
    reject('HISTORY_LOCKED', 'The existing bounded program must be preserved');
  }
  if (Number(next.initialPrice) !== 2 || next.simulationProfile !== 'COMPRESSION_BREAKOUT') {
    reject('INVALID_REPLACEMENT', 'Expected AITH initial price 2.00 and COMPRESSION_BREAKOUT');
  }
  // Every other published property, including date, seed, logo, percentages and wicks, is immutable.
  const preserved = { ...next, initialPrice: active.initialPrice, simulationProfile: active.simulationProfile };
  // Compare nested values independently: a JSON replacer keyed only to top-level fields would omit the program.
  if (Object.keys(active).length !== Object.keys(preserved).length
    || Object.keys(active).some(key => JSON.stringify(active[key as keyof ListingConfig]) !== JSON.stringify(preserved[key as keyof ListingConfig]))) {
    reject('HISTORY_LOCKED', 'Replacement must preserve every other published field');
  }
  return { ...next, initialPrice: '2.00' };
}
