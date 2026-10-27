# ECLAVO — move the existing private Draft to 6 November 2026

Owner-requested update of the existing ECLAVO/ECLV, **not a new listing**. Historical filenames and seed deliberately remain `20261103` so there is one active config. This is a synthetic, non-executable scenario, not an investment return or independent market quote.

| Parameter | Requested value |
| --- | --- |
| Listing instant | `2026-11-06T13:00:00Z` (Friday) |
| Display | 13:00 UTC / 15:00 Kyiv / 16:00 Moscow |
| Identity | ECLAVO / ECLV / ECLV/USDT |
| Initial price | 0.0140 USDT |
| First 24 hours | +680%, exactly 0.1092 USDT |
| Maximum and attained model peak | +7148%, **1.01472 USDT** |
| Seed | `eclavo-20261103-v1`, manual, unchanged |
| Logo | Existing production-approved PNG, copied byte-for-byte to `config/test-markets/eclv-20261103.logo.png` |
| Trading / allocation | `tradable:false`, `ownerAllocation:"0"`, unchanged |

## Canonical trajectory

| Phase | Duration | Elapsed end | Exact endpoint |
| --- | ---: | ---: | ---: |
| Growth | 24 h | 24 h | 0.1092 |
| Consolidation | 24 h | 48 h | 0.1092 |
| Growth | 96 h | 144 h | 0.315 |
| Pullback | 36 h | 180 h | 0.2142 |
| Recovery | 72 h | 252 h | **1.01472** |

The peak is reached at `2026-11-17T01:00:00Z`, 252 real hours after the new listing instant. No phase is accelerated. DEEP_RECOVERY's deep drawdowns, seed, local 5–15%/70-minute pullbacks, high candle intensity, diversity 0.85, moderate pauses and pronounced wicks remain.

### Why changing the ceiling alone is insufficient

The previous validator required every endpoint to be at most 97% of the cap. The price generator uses a bounded odds transform; with a baseline strictly below the cap, both prices and sub-tick highs remain strictly below it. A config-only final endpoint at 1.01472 was rejected during preparation. This was a real failed validation, not an accepted result.

The review patch admits **only** an explicit final `recovery` ending exactly at the cap for `DEEP_RECOVERY` followed by `range`. All intermediate endpoints retain the existing 3% rule; above-cap values, a 98% endpoint, other scenarios and historical continuation are still rejected. No existing previously valid program changes output. An 88-hour pre-change SHA256 fingerprint covers all ten presets, the original ECLAVO and QVTR, including every canonical tick, wick, regime and volume.

At the phase boundary the actual canonical last price is exactly 1.01472, not merely a candle label. Over the next real hour the baseline smoothly retreats to 94% of the cap, then uses the existing deterministic moving range. This prevents a cap-valued constant baseline causing division by zero or a permanently flat chart. Wicks remain at or below the hard cap, with the same 1m/5m/1h history.

This affects synthetic presentation only. No order engine, balance, execution, migration, KYC, TLS, TYVN, AITH, NRX or QVTR config is changed.

## Existing-private-Draft update, not creation

`scripts/eclv-draft-import.cjs --update`:

1. Reads Admin Listings using an existing admin session; token stays in memory/environment and is never logged.
2. Requires exactly one ECLV, no unresolved ZRNTH/seed collision, and a future start. A missing ECLV is a STOP, **never a fallback POST**.
3. Requires no active version, no published versions, no countdown. Published/staged/running/paused listings are refused. If the live record is published, obtain separate owner approval for the supported migration/timer operation; never rewrite the database.
4. Compares identity, logo, seed, initial price, nontrading flags, first four phases and fine settings. Only the old/new date, cap and final recovery endpoint may differ.
5. Sends one ordinary `PUT /api/v1/admin/listings/:id/draft` with the observed `If-Match` revision. The existing server preserves seed/profile/wick model. A 409 stops with no retry.
6. Verifies same ID, revision increment, full canonical config and unchanged seed/profile/wicks, then re-reads the store. A repeat after success sends no write; a lost response is resolved by reading, never blindly creating/updating again.

Legacy `--create` remains for compatibility and isolated tests, but is **not authorized for this owner task**. Never create a second ECLV. `--create` and `--update` cannot be combined. The default remains read-only.

## Production gates and rollback

No production merge, API/Worker/frontend release, publication or countdown activation has been performed by this update. ADMIN access is now verified in the cloud browser. Actual production has one private ECLV with the old November3 date, cap0.518 and seed eclavo-20261103-v1. It was subsequently moved date-only toNovember6,revision3, with actual reload/Preview PASS; the new cap/recovery have not yet been installed. It remains private and unpublished.

The new terminal-peak semantics require compatible API validation and market-edge simulation before saving the new config. Current production exact SHAs/capability must be inspected first. Do not save a config that an old deployed generator cannot interpret. Frontend form validation also needs this compatible patch when editing via the UI. Use separately approved, exact-SHA releases with the existing immutable rollback artifacts; do not broadly deploy unrelated changes.

Before the one private update, privately retain the current ECLV record, revision, active-version state and seed/profile/logo digest; do not publish session or account information. Check the record again immediately before the CAS. Preview on desktop/mobile and reload after save. QVTR and all other listings must be unchanged.

If rollback is needed while still never-published, use the same official draft PUT with the **newly observed** revision and the privately retained original config. Stop on any conflict or published version; do not overwrite another editor. Restore the prior private config before rolling back a runtime that cannot parse the terminal-peak config. Publication and timer require a separate owner decision.

## Targeted validation

- `node --test scripts/eclv-draft-import.test.cjs`: real CLI against a loopback synthetic store; CAS, no-create, duplicate, published-state, identity, 409, lost-response and profile checks.
- Backend Jest ECLV/QVTR/scenario controls/TYVN/countdown; frontend movement validation; backend TypeScript/build and frontend TypeScript/build.
- `scripts/qa-listing-eclv.cjs`: actual local admin router, actual market Worker/workerd/SQLite and the built frontend in Chromium. Existing Draft migration and reload, seed/profile, unchanged QVTR, private Preview, desktop1440/mobile390, local-only publication/timer, Spot/Markets/logo, 1m/5m/1h, day-one price and actual recovery peak.
- Disposable local users/storage only. No real funds or external provider requests. Local publication/timer is **not** evidence of production publication.
- `.github/workflows/eclv-listing-draft.yml` runs on review PRs with read-only GitHub permissions and no deployment job. Review commits carry Cloudflare Pages/Render skip markers. Exact-head results and evidence are recorded on the PR after execution.


## Actual production preflight on 27 October

- Secure ADMIN sign-in succeeded. ECLV is one existing private Draft; all51 displayed controls and the exact logo remain unchanged after the separate authorized QVTR creation. Preview selector preferences were restored before the full comparison. After this read-only check, one owner-authorized date-only CAS save moved the SAME private Draft toNovember6,revision3. Reload and actual first24h Preview PASS; seed/logo/all other fields preserved. The cap/recovery remain old until an approved compatible runtime release. No publication or timer action occurred.
- **Actual approved logo differs from the old repository SVG.** Preserve the existing PNG:52194bytes,969×965, SHA256 `4f9ffc2f38645beeccf238a2609607064a63f7ef6c2d71018d5fae8aa9ca45a7`. The historical SVG is removed from active assets; the single config now contains the production PNG. The authoritative64KiB limit is unchanged, with an additional exact byte-count/signature/hash guard. Do not upload the old SVG over the owner's approved image.
- API `/health` reports statusok, commit `89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`. This predates main's History20 additions. **Do not deploy whole main or the whole PR628 API source over it.**
- `ops/listings/eclv-peak-89c3.patch` is the isolated production-base alternative:only the synthetic validator and generator,13 additions/2 deletions. It contains no History20 implementation, database/migration, bootstrap, auth or financial change. It applies to that exact source base and has been compiled and exercised on a detached local checkout:actual peak1.01472, first24h0.1092,3601 bounded continuous5m candles and unchanged88-hour tick fingerprint. The dedicated Ubuntu24.04/Node22 CI job rechecks this production source without running a server or using a database.
- This patch is **prepared, not deployed**. Before any approved application, require fresh `/health` to match89c3 and retain the immutable current API image. If the base differs, stop and rebase/retest rather than overlaying files from main.
- The market Worker also needs compatible simulation semantics. Its precise deployed source/version and rollback must be verified before choosing a Worker artifact; the main bundle must not silently bring in unapproved History20 changes. Cloudflare's Google sign-in in this cloud session returned `Unable to sign in`; automated sign-in stopped after that first generic failure. No Cloudflare settings/deployments changed. Current Pages SHA and Worker immutable version remain unverified here.
- Per owner coordination, **PR627 is first for a narrow frontend release through the agreed operator**. No parallel frontend release is permitted from this task. Admin validation integration for ECLV must be coordinated after627, with its own approval and verified frontend base.
- QVTR is now one actual production private Draft,revision1, same approved logo/fields after reload. Actual first24h Preview0.1092, and full300h/301candle Preview0.818 with high0.8182198871≤0.88858. QVTR is not published and its timer was not started. See `docs/qa/listing-qvtr/voltex-qvtr-production-private-preview-20261027.jpg` and `voltex-qvtr-production-seven-phases-20261027.jpg`.
- Review head1f423a28 passed **all16 GitHub workflows**, including73Jest+8CLI and browser27/27. The approved-logo/backport-evidence follow-up requires its own exact-head CI; the old green result is not substituted for it.

Operator coordination supplied12:50UTC: canonical frontend source `a7593324be9118cfda91ee8fc6bad0b6ff3acba9`, deployment `9dbc9e80` from23October; auto-deployOFF/previewsnone. This is explicitly attributed coordination evidence, not a Cloudflare observation from this cloud session. Main advanced to`e27117a61d191cbc03456abaf5e88fa38bdf5d62` after627; review branch reconciles that main while preserving Referral and scenario changes. PR627 retains the first frontend operator slot. No History20 archive rights or financial gates may be activated.
