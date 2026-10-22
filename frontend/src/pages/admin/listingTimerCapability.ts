import type { AdminListing } from './adminListingsApi';

/**
 * Whether the API in front of the listings store runs the pre-listing timer.
 *
 * A timer-capable API (main, PR #578) returns the `countdown` key on every
 * admin listing — `null` until a timer exists. The API deployed before the
 * timer (2e7acf1) drops that key, drops the `staged` flag of a publication and
 * has no `…/countdown` route: a first publication with «Запустить таймер»
 * unticked would still go public at once, with a running countdown that cannot
 * be paused or hidden (scripts/qa-listing-timer-api.cjs, 2026-10-22).
 *
 * Unproven means unsupported: with no listing to look at, the page offers no
 * hidden publication and no timer buttons.
 */
export function listingTimerSupported(listings: readonly AdminListing[] | null): boolean {
  return !!listings && listings.some(listing => Object.prototype.hasOwnProperty.call(listing, 'countdown'));
}
