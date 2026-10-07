/** AITH's pre-listing replacement is opt-in; other listings retain their existing protocol. */
export const AITH_SYMBOL = 'AITH';
export const AITH_READ_LEASE_MS = 45_000;
export const AITH_LEASE_SAFETY_MS = 1_000;
export const AITH_PUBLICATION_PROTOCOL = 'aith-prelisting-v1';

/** Browser leases use elapsed time: changing the user's wall clock cannot revive an old version. */
export const aithReadClock = (): number => performance.now();

export interface ListingReadLease {
  protocol: typeof AITH_PUBLICATION_PROTOCOL;
  generation: number;
  issuedAt: number;
  expiresAt: number;
}

export function isAith(value: unknown): boolean {
  return typeof value === 'string' && ['AITH', 'AITH/USDT', 'AITH-USDT'].includes(value.toUpperCase());
}

export function validAithLease(lease: ListingReadLease | undefined, version: number, now: number): boolean {
  return !!lease && lease.protocol === AITH_PUBLICATION_PROTOCOL && lease.generation === version
    && Number.isSafeInteger(lease.issuedAt) && Number.isSafeInteger(lease.expiresAt)
    && lease.expiresAt > lease.issuedAt && lease.expiresAt - lease.issuedAt <= AITH_READ_LEASE_MS
    && now >= lease.issuedAt - AITH_LEASE_SAFETY_MS && now < lease.expiresAt - AITH_LEASE_SAFETY_MS;
}

/** Request-start anchoring cannot extend a lease when the response arrives late or the local clock differs. */
export function aithLeaseDeadline(lease: ListingReadLease, requestStartedAt: number, authorityObservedAt = lease.issuedAt): number {
  return requestStartedAt + Math.min(AITH_READ_LEASE_MS, lease.expiresAt - authorityObservedAt) - AITH_LEASE_SAFETY_MS;
}
