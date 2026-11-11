# Published listing dates — 11 November 2026

Owner-authorized production change: only `listingAt` for two existing records.

| Listing | Previous Europe/Kyiv | New Europe/Kyiv | New UTC |
| --- | --- | --- | --- |
| Neuryvia AI / NRYIA | 15.11.2026 15:00 | 17.11.2026 15:00 | 2026-11-17T13:00:00Z |
| Aelyrix AI / AELRI | 25.11.2026 15:00 | 27.11.2026 15:00 | 2026-11-27T13:00:00Z |

## Actual production result

- Authenticated administrator API and authenticated listing storage both
  confirmed the original dates and `running` published timers before writes.
- Exactly two calls to the existing `/internal/listings/:id/reschedule`
  mechanism, `days: 2`, with current revisions and distinct durable operation
  keys. No importer, publication, timer start/stop/reset, migration or deployment.
- Store revision 17 → 19. The mechanism appends immutable configuration versions;
  both records remain published. Only `listingAt` changed inside active/draft
  business configurations; seeds, logos, prices and complete scenarios match.
- Timer objects, including their original `startedAt`, are byte-for-byte equal.
  Other managed records are byte-for-byte equal; no listing was added/deleted.
- `https://market.voltextech.net/market/listings` returns HTTP 200, revision 19,
  the two new dates, `countdown: running`, `phase: pre-listing`, and
  `isTradable: false` for both instruments.
- The live `voltextech.net/trade?pair=...` pages were checked at 1440 and 390 px.
  Both dates/time zones match; countdowns tick and agree with remaining UTC time
  within three seconds. Reloads retain the new dates at both widths.
- Existing listing calendar tests: 6/6 PASS. Both config-file diffs contain only
  one `listingAt` line each; every other JSON value is unchanged.

Evidence: `browser.json`, `production.json`, and the four live PNG captures.
Complete before/after store snapshots and operation receipts remain in the
restricted server/local operations folder; no credentials or private drafts
are copied into Git.

## Persistence and scope

Runtime authority is the persistent listing store, not these draft JSON files.
Restarting/releasing the API does not reimport them or restore an older date.
The private candidate importer does not overwrite existing listings; it was
not run. Keep these two config edits in the next approved integration so a
future deliberate candidate import uses the same dates.

Historical filenames and seeds retain their original date strings for importer
compatibility and deterministic continuity. Only their `listingAt` values move.
No ECLV, QVTR, AITH, VTA, financial module or balance/order operation was changed.

There is no automatic rollback of dates. Any reversal needs a separately
authorized future-only change using the current revisions; old listing history
must remain immutable. No unrelated image, Worker, Pages, DNS or database
configuration change is needed for this operation.
