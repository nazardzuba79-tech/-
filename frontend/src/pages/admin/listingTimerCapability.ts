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
 * Unproven means unsupported: with no listing to look at (an empty store) the
 * answer is «no». There is no separate capability endpoint, so the first
 * listing of an empty store proves the timer only once its draft is saved —
 * the page re-reads the list after every save, and on a timer-capable API that
 * draft carries `countdown: null`. Publication needs a saved draft anyway.
 */
export function listingTimerSupported(listings: readonly AdminListing[] | null): boolean {
  return !!listings && listings.some(listing => Object.prototype.hasOwnProperty.call(listing, 'countdown'));
}

/**
 * A first publication is sent only through an API that runs the timer: any
 * other API would put the market and its countdown on the exchange at once,
 * and a new listing stays private until the owner approves it separately
 * (owner, PR #585, 2026-10-22). Creating, saving and previewing the draft stay
 * available. A re-publication of a listing that is already public changes
 * nothing about its visibility and is allowed on either API.
 */
export function listingPublicationAllowed(listing: AdminListing, timerSupported: boolean): boolean {
  return listing.activeVersion !== null || timerSupported;
}
