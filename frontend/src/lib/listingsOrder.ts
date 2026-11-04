/** Which listings lead on the Markets page (owner, 2026-11-04: a phone had no way to see what is about to trade). */
export type ListingOrder = 'soon' | 'live';

const listingAtOf = (asset: { listingAt: string }): number => { const at = Date.parse(asset.listingAt); return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY; };

/** «Скоро»: the ones still counting down first, the nearest date at the top (unconfirmed dates last
 *  among them), then the live ones newest first. «Торгуются»: the live ones first (newest first),
 *  then the countdowns. */
export function orderListings<T extends { listingAt: string; state: { phase: string } }>(assets: T[], order: ListingOrder): T[] {
  const upcoming = assets.filter(a => a.state.phase !== 'live').sort((a, b) => listingAtOf(a) - listingAtOf(b));
  const live = assets.filter(a => a.state.phase === 'live').sort((a, b) => listingAtOf(b) - listingAtOf(a));
  return order === 'soon' ? [...upcoming, ...live] : [...live, ...upcoming];
}
