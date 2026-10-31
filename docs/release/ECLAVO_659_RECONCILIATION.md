# ECLAVO: current production reconciliation, 2026-10-31

## Verified read-only production state

Authenticated Admin Listings GET and the existing Preview UI, inspected without save/publish/countdown calls:

| Field | Observed |
| --- | --- |
| Identity | ECLAVO / ECLV; one matching listing |
| Publication | activeVersion 1; draftRevision 4; draft equals active config |
| Published at | 2026-10-27T17:48:04.387Z |
| Listing instant | 2026-11-06T13:00:00Z (15:00 Kyiv / 16:00 Moscow) |
| Initial / first 24 h / terminal cap | 0.0140 / 0.1092 (+680%) / 1.01472 (+7148%) USDT |
| Seed | eclavo-20261103-v1, unchanged |
| Logo SHA256 | 4f9ffc2f38645beeccf238a2609607064a63f7ef6c2d71018d5fae8aa9ca45a7 |
| Financial switches | tradable:false; ownerAllocation:0 |
| Full growth Preview | HTTP 200; 253 hourly candles; endpoint 1.01472 at 2026-11-17T01:00:00Z; maxHigh 1.01472 |
| Countdown evidence | Admin UI says timer started / visible on exchange. GET descriptor countdown:null; this is UI evidence, not a verified native countdown object. |

This proves persisted scenario and API Preview behavior, not exchange execution or future profitability. The actor/authorization of the historical publication was not inferred. No publication, import, timer action, financial write or deployment was performed in #659.

## Live deployment identity

- API health release label: 3636cf80a44b68cfe023a05618f9ad6d1c2e0a11. This is an overlay label; complete installed container/module hashes remain unverified through OS console.
- Pages source: 9ed179c697ea86dc6fb97dbbfa5b8674705f2e57; deployment 8ac0fa93-4230-408c-a7a5-f8c29cb4ebee. Production auto-deploy false, preview none.
- market-edge deployment 8288c972-cebe-469e-b12f-034f818e6bdc; immutable version f3a02fb5-60e0-4efa-bc3e-d48e5ecd02a2 at 100%. No source SHA inferred from a version ID.

Local private receipts: G:/Codex/voltex-evidence659/eclavo-live.json, eclavo-preview.json, eclavo-production.jpg. They contain no authentication material; do not publish account screenshots or full admin responses.

## Safe integration and rollback

1. Reconcile #628 code against current main, retain exact configured scenario and its frozen historical seed. Do not re-import or create ECLV. The importer correctly refuses published listings.
2. #656 is a test-only prerequisite: the reproduced OTC failure on October 31 comes from calendar fixture assumptions. Merge its exact commit 2bbaca1be203997ba8937b2e4c7f51225a0ee575 into the review branch, preserving production math.
3. Require exact-head CI. Cloudflare read-only CI currently fails its existing Pages403 credential gate; connector read access does not prove that CI credential has access. Do not disable the check, silently expand permissions, or label the branch fully green.
4. There is no approved production change to execute from this document. Existing behavior already matches the target. Do not deploy whole main or the historical 89c3 two-file artifact over the current overlay.
5. Before a future separately authorized release, attest installed API module hashes and Worker source compatibility, retain exact current immutable artifacts, and test the specific replacement offline against published config. A rollback must preserve support for the already-published terminal endpoint and HISTORY_LOCKED data. Returning to pre-cap semantics or overwriting the active config is not a valid rollback.
6. With no production mutation in #659, production rollback is a no-op. A code-only integration can be reverted as a commit before a separately approved deployment. Timer/config/history rollback needs its own owner-approved plan; never restore a private Draft over the active version.
