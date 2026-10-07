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
import { aithLeaseDeadline, isAith, validAithLease } from '../../shared/aithPublication';

export const REFRESH_MS = 60_000;

export class ManagedListingRegistry {
  private listings: PublishedListing[] = [];
  private attemptedAt: number | null = null;
  private inFlight: Promise<void> | null = null;
  private aithValidUntil = 0;

  constructor(private readonly store: ListingStore, private readonly clock: () => number = Date.now) {}

  get configured(): boolean { return !(this.store instanceof UnconfiguredListingStore); }

  snapshot(): readonly PublishedListing[] { return this.listings.filter(item => !isAith(item.config.symbol) || this.clock() < this.aithValidUntil); }

  /** Administrative replacement verification always waits for a new authority read. */
  async authoritative(): Promise<readonly PublishedListing[]> {
    if (this.inFlight) await this.inFlight;
    await this.refresh();
    return this.snapshot();
  }

  /** Forget the age of the snapshot (after a publish): the next caller re-reads. */
  invalidate(): void { this.attemptedAt = null; }

  private refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.attemptedAt = this.clock();
    const startedAt = this.attemptedAt;
    this.inFlight = this.store.published()
      .then((published) => {
        const aith = published.listings.find(item => isAith(item.config.symbol));
        this.aithValidUntil = aith?.readLease && validAithLease(aith.readLease, aith.version, aith.readLease.issuedAt)
          ? aithLeaseDeadline(aith.readLease, startedAt) : 0;
        this.listings = published.listings.filter(item => !isAith(item.config.symbol) || this.clock() < this.aithValidUntil);
        setManagedListingAssets(this.listings.map((listing) => listingSimulationConfig(listing.config)), this.aithValidUntil);
      })
      .catch(() => {
        // AITH must never fall back to an unfenced publication; other markets retain their existing policy.
        this.listings = this.listings.filter(item => !isAith(item.config.symbol));
        this.aithValidUntil = 0;
        setManagedListingAssets(this.listings.map(listing => listingSimulationConfig(listing.config)));
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Refresh if the snapshot is older than REFRESH_MS, waiting at most `waitMs`. */
  async ensureFresh(waitMs = 1_500): Promise<void> {
    if (!this.configured) return;
    const expiredAith = this.listings.some(item => isAith(item.config.symbol)) && this.clock() >= this.aithValidUntil;
    if (!expiredAith && this.attemptedAt !== null && this.clock() - this.attemptedAt < REFRESH_MS && !this.inFlight) return;
    const refresh = this.refresh();
    if (waitMs <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([refresh, new Promise<void>((done) => { timer = setTimeout(done, waitMs); })]);
    if (timer) clearTimeout(timer);
  }
}

export const managedListingRegistry = new ManagedListingRegistry(listingStoreFromEnvironment());
