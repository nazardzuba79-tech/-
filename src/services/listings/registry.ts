/**
 * Render's view of the PUBLISHED managed listings, for the trading paths:
 * the Spot listing gate, conditional-order prices, wallet valuation and the
 * restricted-asset guards (see testAssetConfig).
 *
 * Budget: at most one Cloudflare read per REFRESH_MS, only when something
 * asks (an order, a valuation) — no timer, no cron — plus one at startup.
 * A caller never waits more than the given `waitMs` for it; a failed read
 * keeps the last good snapshot and is not retried before REFRESH_MS.
 */
import { listingSimulationConfig, type PublishedListing } from './listingConfig';
import { setManagedListingAssets } from './managedSnapshot';
import { listingStoreFromEnvironment, UnconfiguredListingStore, type ListingStore } from './store';

export const REFRESH_MS = 60_000;

export class ManagedListingRegistry {
  private listings: PublishedListing[] = [];
  private attemptedAt: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly store: ListingStore, private readonly clock: () => number = Date.now) {}

  get configured(): boolean { return !(this.store instanceof UnconfiguredListingStore); }

  snapshot(): readonly PublishedListing[] { return this.listings; }

  /** Forget the age of the snapshot (after a publish): the next caller re-reads. */
  invalidate(): void { this.attemptedAt = null; }

  private refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.attemptedAt = this.clock();
    this.inFlight = this.store.published()
      .then((published) => {
        this.listings = published.listings;
        setManagedListingAssets(published.listings.map((listing) => listingSimulationConfig(listing.config)));
      })
      .catch(() => { /* keep the last good snapshot */ })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Refresh if the snapshot is older than REFRESH_MS, waiting at most `waitMs`. */
  async ensureFresh(waitMs = 1_500): Promise<void> {
    if (!this.configured) return;
    if (this.attemptedAt !== null && this.clock() - this.attemptedAt < REFRESH_MS && !this.inFlight) return;
    const refresh = this.refresh();
    if (waitMs <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([refresh, new Promise<void>((done) => { timer = setTimeout(done, waitMs); })]);
    if (timer) clearTimeout(timer);
  }
}

export const managedListingRegistry = new ManagedListingRegistry(listingStoreFromEnvironment());
