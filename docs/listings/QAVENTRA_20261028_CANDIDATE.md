# QAVENTRA (QVTR/USDT) — October28 candidate

Owner-requested separate candidate, NOT ECLAVO. This execution has completed
code/isolated QA; production Admin state, name collision and publication/timer
remain NOT VERIFIED because the connected browser rejects its originating context.
No production operation was performed by this execution. Never infer a live
Draft or publication from this file.

## Saved configuration
- 2026-10-28T13:00:00Z =15:00 Kyiv /16:00 Moscow.
- Initial0.0140 USDT; first24h +680% ->0.1092.
- Ceiling +6247% ->0.88858 USDT; a hard cap, not a guaranteed peak.
- WAVES, seven phases/300h, seed `qaventra-20261028-v1`, original Q logo.
- `tradable:false`, owner allocation0. Synthetic modeled candles, not independent venue quotes.
- Canonical pullback target string is `0.51` (same number as former0.510).
  The original file was normalized by the store, which made the standalone
  importer falsely fail after creation and then reject an otherwise identical
  saved Draft. This canonical representation fixes that real idempotency defect.

## Code and verification

Started from PR624/fdbe00c82063c88ae8c4a48df23dd175b29821c9.
Reconciled current main4ac8a45eeeb19ed6cd4677021d677134c438674f (35 commits
ahead of the old base), preserving every P0 financial fence and other reviewed
change. No conflict; no ECLAVO config/logo/importer/QA-script byte changed.

New `scripts/qa-listing-qvtr.cjs` uses existing real Admin Listings router/auth,
CloudflareListingStore, actual Worker in workerd/SQLite and the built frontend
in real Chromium. Only sessions/storage adapters/other-market data are synthetic.
Two disposable stores retain independent unchanged private ECLAVO snapshots.
It checks form vs importer parity, first/second import, differing-draft refusal,
duplicate and stale-save guards, persisted seed/profile/date, private preview,
local staged publication/start, primary terminal/search/Markets/logo, ticking
timer/reload,1440/390 layouts and live-after-opening1m/5m/1h candles.
All publication/timer actions in that harness are LOCAL ONLY.
No external Worker calls, financial requests or page errors.

Actual local results:
- Backend TypeScript/build PASS; frontend TypeScript/Vite build PASS (existing
  large-chunk warning, QA-only loopback Worker bundle, never a deploy artifact).
- Focused7 suites/108 tests PASS before canonical fix; subsequent6 suites/183
  tests PASS including final QVTR, KYC/materials, auth, Wallet portfolio and Futures
  position service. These totals overlap; do not add them as distinct tests.
- Worker contract PASS.
- Final browser24 checks/0 failures,24 screenshots at1440/390. Initial21 successful
  checks/3 failures exposed canonical-price mismatch and are preserved separately.
- All7 phase endpoints and3889 five-minute candles over300h+24h are bounded,
  finite, positive and geometrically valid.
- Existing exact old-head GitHub5/5 SUCCESS was independently read, including
  Admin Listings222+92 tests/backend/frontend/workerd/browser gates. Those are
  OLD-head evidence, not final-head CI. Updated workflow now runs QVTR browser QA.
  Current exact-head results must be read from PR624, never assumed from the old run.

Evidence: `docs/qa/listing-qvtr/` (sanitized synthetic report and selected screenshots).
No public KYC/account data, tokens, real balances or secrets.

## Controlled production sequence — separate owner approval required

1. Refresh live `/health` API commit/start and Worker release identity. Existing
   generic Admin Listings/Worker capabilities must pass; do not broadly deploy
   API/frontend/Workers just to add this data-only candidate.
2. Through existing ADMIN session, GET Admin Listings, record a private full
   rollback snapshot and safe ECLAVO digest/revision/countdown. Verify QVTR/name/
   seed/logo collisions and compare canonical candidate. If another approved
   identity exists, STOP for owner decision; never rename/recreate it blindly.
3. Run standalone importer read-only first. If absent, the owner's current order
   authorizes exactly one private Draft with `--create`; repeat must send no POST.
   Re-read/reload, private Preview and all7 phases,1440/390. ECLAVO unchanged.
4. Merge PR624 only with the owner's explicit approval of its exact final head.
   The PR adds config/import/QA, no product financial or server runtime change.
5. Only with separate approval: publish the verified Draft once with
   `countdown:'staged'` and a stable publish idempotency key/expected revision.
   Confirm it stays hidden, then explicitly start its existing countdown with
   the approved date. No external cron or timer. Keep tradable:false/allocation0.
6. Actually verify main and supported RU public catalogue/search/direct terminal,
   logo/timer/price,1440/390/reload, API/JS/WS and unchanged ECLAVO. A direct
   network/authorization failure is BLOCKED, not a liveness failure proven on site.

Rollback boundary: before2026-10-28T13:00:00Z, stop ONLY QVTR's countdown through
its existing Admin action; state becomes staged/hidden, immutable version/history
and private config are retained. Re-read public visibility and ECLAVO. A stopped
first publication is not deletion/unpublication. After the market has opened,
the existing API rejects timer changes (MARKET_OPEN): do not bypass that guard,
change its date/history, or pretend pre-opening rollback remains available.
No balance, database, key, KYC, DNS or other listing mutation belongs in this plan.

## Outstanding gates
- Production browser/ADMIN session usable; live symbol/name/seed collision check.
- Actual private Draft existence/parity/Preview and ECLAVO before/after digest.
- Fresh API/Worker identity, exact final-head CI, owner merge/publication/timer approval.
- Actual public main/RU desktop/mobile and real-network verification after approval.
