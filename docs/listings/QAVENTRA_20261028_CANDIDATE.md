# QAVENTRA (QVTR/USDT) — separate October 28 candidate

**Status: CODE-ONLY PRIVATE CANDIDATE. Never published, no timer started, no balance/financial effects.**
Name, ticker, and original SVG Q-logo are *provisional creative choices*, not previously owner-approved identities. Verify trademark/ticker uniqueness before approval.
This candidate is independent of **ECLAVO (ECLV/USDT)**. Do not edit, rename, reschedule, overwrite, delete or publish the existing ECLAVO draft at 2026-11-03T13:00:00Z.

## Candidate
- Name: **QAVENTRA**; ticker: **QVTR**; pair: **QVTR/USDT**.
- Schedule: **2026-10-28T13:00:00Z** = 15:00 Kyiv = 16:00 Moscow.
- Initial price: **0.0140 USDT**. Model ceiling: **0.88858 USDT**, i.e. +6247% relative to opening.
- First 24 hours: **+680%** with phase target **0.1092 USDT**.
- Distinct simulation: **WAVES**, 7 stages totaling 300h, later pullbacks and recovery (see JSON); NOT ECLAVO's DEEP_RECOVERY program.
- Independent manual seed: `qaventra-20261028-v1`; distinct stylized Q-prism logo SVG.
- `tradable:false`, `ownerAllocation:"0"`; synthetic chart only. The ceiling is a LIMIT, not a promise that the path will attain it.

## Files
- `config/test-markets/qvtr-20261028.draft.json`
- `config/test-markets/qvtr-20261028.logo.svg`
- `scripts/qvtr-draft-import.cjs` — defaults to authenticated read-only preflight; `--create` creates at most ONE private draft if no collision, never publishes or starts a timer.
- `src/services/listings/__tests__/qvtrDraft.test.ts`

## Release safeguards
1. Confirm this new name/ticker/logo and curve with the owner. Verify existing ECLV and all actual Admin Listings rows first. Existing ECLV 03 Nov remains untouched.
2. Run isolated tests and exact-head CI. Check 1440/390 screenshots against the private draft. Confirm the intended difference between 6247% cap and actual peak.
3. Do **not** publish, activate trading, start any countdown, merge to main, deploy or mutate production without separate explicit authorization and a documented rollback.
4. If the real admin already has QVTR, do not create a duplicate; reconcile the record instead. Never reuse ECLV's seed/profile or replace its config.
5. If local Codex branch `codex/eclv-date-20261028` appears later, **do not merge its ECLV date edits**; its proposed change targets the wrong existing listing.
