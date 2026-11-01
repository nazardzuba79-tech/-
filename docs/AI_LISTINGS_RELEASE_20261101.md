# NRYIA / AELRI controlled DEMO release

Owner authorization: attached task of 2026-11-01 permits these two public DEMO listings and starting their future countdowns, after checks. It does not authorize changing other markets or financial records.

## Sealed scope

- PR666 contains the shared opt-in model, date reschedule, disclosure and operator build. PR667 remains stacked and adds AELRI only.
- Actual Pages base `13a1bc9b92b6a42f3bac15b085d561bfb05ce5e8`, deployment `aca96cbc-45b7-4a02-b808-6be6725df69f`. Its root `index-DgQ3IA3A.js` was reproduced byte-for-byte. Actual build had only API URL, deposit catalogue URL and manual catalogue flag; the static `release-build.json` contains stale older metadata and is not a release attestation.
- Narrow frontend source `2467a86e907a8c22377b387921923a029eab6bc1` has exactly twelve allowed paths versus that base, including its handoff. Copy Trading, Futures, Wallet, Banking and unrelated admin security UI remain from the installed source. CI builds this exact source and tests the production-configured bytes with all remote requests redirected to disposable localhost services.
- Actual API base image `sha256:362eb750a7a0d7db207c6a3818eaba8006e96b96e829218783550fec05cdd44b`, health `3636cf80a44b68cfe023a05618f9ad6d1c2e0a11`. The four security modules match #668's parent after TypeScript normalization. #668 exact source `1b8d34c83ac91a96d364f53348699189d1fcad32` is a prerequisite, not replaced by frontend masking; its head CI was 10/10 successful.
- Actual Worker version `f3a02fb5-60e0-4efa-bc3e-d48e5ecd02a2`, code SHA256 `e06b9d40c6e543cd4e467ee1f227b3f56ee1ee0b768f75904fa5cde650f8ec2e`. It contains a live ECLV terminal exception absent from generic main. The additive overlay retains that exact old path and dispatches only explicit `terminalPeak:bounded-v1` models to new validation/price branches. It adds the existing-store atomic reschedule operation, no new namespace or timer system.
- Code-only live fixtures contain no credentials, users, balances, orders or financial data. Logo bytes and source seed/config remain from the prepared candidates. Local parity: 10,080 old QVTR/ECLV ticks identical; 10,080 NRYIA/AELRI ticks match canonical candidate code. AITH config and public prelisting serialization also match. This is isolated parity evidence, not a claim about live executions.

## Order and gates

1. Require final exact-head CI, sealed overlay parity and narrow frontend browser checks. Fence actual API image/modules, Worker version and Pages deployment immediately before any cutover; stop on concurrent drift.
2. Backups are under `/opt/voltex-releases/ai-listings-20261101/before`, mode 0700; private Docker configuration remains on the server. The old image is retained locally. Export current listing configurations and immutable versions before any writes, without exposing the store secret.
3. Build a **security-only** image from the installed image with #668's four verified modules. It is the minimum secure rollback baseline; do not roll back to the old password-exposing modules. Verify health and authorized session/API behavior after this stage.
4. Deploy the additive Worker over the original namespace/bindings, preserving the secret binding and compatibility date. Verify old listings and public read parity before new listings exist. Roll back to the pinned original Worker only while no new terminal models are stored.
5. Apply only the eight listing API overlay modules over the security-only image, preserving runtime configuration, database/client, entrypoint, flags, network and limits. Verify health, admin reads/preview and authorization. Roll back listing modules to the security-only image if needed, without reverting #668.
6. Deploy only the CI-built narrow frontend artifact. Recheck unchanged financial flags and installed identity, actual browser session and old listings. Pages rollback is the pinned deployment above; automatic production builds/previews remain disabled.
7. Through authorized listing controls, recheck private ticker/name/seed collisions; create or reuse exactly one NRYIA and one AELRI Draft. Verify saved configs, logos and private Preview. Publish staged, then start each countdown. Confirm public API and desktop/mobile show RUNNING to November15/25 13:00 UTC respectively; reload must retain it. Never exercise real order/transfer writes to test this.

## Reschedule and rollback

ADMIN authentication is required at the API, and the store additionally requires its backend secret/no browser Origin. A transaction compares draft revision and active version, persists an operation-key receipt/audit, appends the new active version and changes only `listingAt`. Calendar days preserve wall hour/seconds in the listing's IANA timezone; DST gaps/folds are rejected. All existing publication guards still run. The old opening must be at least 60 seconds ahead even when staged/paused; any opened/immutable history is refused. AITH/private financial contours are excluded. Running/paused/staged timer metadata and all sibling listings stay unchanged. Unsaved conflicting drafts are rejected rather than discarded.

After new terminal models exist, the old parser cannot safely read them: **do not roll back API/Worker parsers**. A code rollback must retain the additive compatibility shim; hide only the two new markets using their existing stop controls while investigating. Do not delete immutable history, restore PostgreSQL, reverse financial transactions, or change old listings. Keep the secure #668 baseline. A deliberate reschedule test in production may not leave the approved launch dates moved; the destructive-free validation uses Cancel and isolated persisted transactions rather than changing the owner's real schedule.

Final deployed IDs, artifact digests, old-listing hashes and actual RUNNING receipts must be recorded after execution; this runbook alone is not completion.
