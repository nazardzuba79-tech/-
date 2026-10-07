# AITH pre-listing replacement

This operation is limited to the existing AITH publication, before its listing
time, with no allocation, real orders, trades, positions or nonzero balances.
It preserves the ticker, name, logo, seed, listing time, wick model and bounded
program. The permitted correction is initialPrice `2.00` and the requested
`COMPRESSION_BREAKOUT` profile. Ordinary draft/save/publish still enforce
`HISTORY_LOCKED`. No PostgreSQL migration or financial write is involved.

## Authority protocol

The SQLite Durable Object remains the authority. AITH reads carry a version
and a 45-second lease. API snapshots, Worker responses and browser state drop
AITH when its authority is unavailable or its lease expires. Other listings
retain their existing cache policy. Browser deadlines start at request send,
account for the lease age in the server response, and expire independently of
a slow/hanging refresh. AITH chart loads pin their version and reject a reply
from another generation. AITH remains denied by backend trading guards even
without a registry snapshot.

Authenticated `POST /admin/listings/:id/replace-prelisting` supports:

- `prepare`: operationKey, expectedVersion, draftRevision and full config.
  A transaction validates the immutable fields and expected revision, records
  the proposal and actor, and stops issuing old-version read leases. Public
  AITH temporarily becomes unavailable as existing leases expire.
- `commit`: same operationKey. Before `notBefore` it returns 409. At/after it,
  the authority rechecks the start boundary, appends a new immutable version,
  updates the active pointer and matching draft, and records the receipt.
- `cancel`: same operationKey, before commit. It records cancellation and
  restores availability of the original active version without changing it.

Pending operations and receipts survive restart. Concurrent proposal keys
conflict. Retrying the same completed key returns its receipt. The original
version row is never updated or deleted. Admin history keeps both versions.

## Coordinated rollout

1. Fresh-fetch main; require exact-head CI, local/browser QA, immutable history
   regressions and the unchanged NRX release gate. Capture the current runtime
   images, Worker/Pages versions, AITH store snapshot and protected DB digests.
2. Use the existing verified production backup workflow. Retain previous API,
   Worker and frontend artifacts; do not change schema, secrets or schedules.
3. Deploy the compatible API, Worker and frontend before preparing a replacement.
   During this compatibility stage AITH remains v1. An upgraded API fails closed
   until the Worker supplies leases. Verify API health/DB/auth, public leases,
   frontend build, admin authority, existing markets and AITH's trading denial.
4. Snapshot the store again. Prepare from the exact active config and revisions;
   wait beyond the returned lease deadline. Verify AITH unavailable through
   authority/public reads before commit. Commit using the same operation key.
5. Verify persisted active/draft v2, unchanged v1 audit, API authority, Worker
   catalogue and pair paths, Admin preview, customer UI and closed NRX history.
   All prices must derive from 2.00: day one 36.50, hard maximum 186.94.

Before commit, cancel a pending operation and restore the recorded runtime
artifacts if smoke checks fail. After commit, never restore a database snapshot,
rewind the active version, or return to an unfenced consumer. Retain the new
immutable configuration and the verified lease-capable artifacts. An ambiguous
commit response must be resolved by its durable receipt and active-version
read, not by submitting a new operation key. Do not declare completion while
any consumer still serves the old price or lacks the new authority protocol.

## Verification

`aith-replacement.integration.test.mjs` exercises the real Worker/store with
SQLite persistence, restart, concurrent keys and a test-only SQL inspection
wrapper that compares the complete original v1 row. Jest covers lease expiry,
authority outages, immutable-field restrictions, trading denial and real
generator/preview/tick limits. `QA_AITH_REPLACEMENT=1` runs the existing isolated
Admin Listings browser harness: real API/DO replacement and lease drain, an
already-open tab, Admin state, and Spot/Markets/search at 1920/1440/1366 and
430/390/360/320 widths. All external network traffic is denied.
