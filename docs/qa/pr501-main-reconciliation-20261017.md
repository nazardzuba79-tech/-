# PR #501 reconciliation — 2026-10-17

Existing PR/branch: #501, `integration/customer-wording-20261010`.
Original head: `d4522ea3a9c51ed91703bdc457ac2acd66545a81`.
Fresh main: `50875f2116474ce01acbb08c1d9e3e68ec99a7f3`, including Funding V2 #535 and Copy Trading #536.

## Comparison and selective result

| Area | Fresh main | Result relative to main |
| --- | --- | --- |
| Customer error boundary | Already suppresses unknown server text on screen; existing business refusals and newer insufficient-liquidity/self-match mappings exist | Reuse the boundary; add missing network/timeout/401/403 wording, safe diagnostic metadata and string-only lookup. Existing refusals retained. |
| Order/position statuses | REJECTED/EXPIRED and position status still render machine values; unknown type/status may echo raw text | Localized labels and unknown-state fallback; safe order tooltips. No order mutation changes. |
| Listings | Server-owned phase/countdown, AITH generation/read-lease guard and chart settings already exist | Add missing simulation, awaiting-launch, unconfirmed-date and stale/load-failure labels. Preserve server-owned phase, refresh, chart settings and AITH guards. |
| Spot refresh controller | Main already has fresh-read propagation and shared open-order statuses | Keep main's controller exactly; only presentation helpers change. |
| FuturesPositionsPanel | Funding V2 Trading/Funding/Fees/Net P&L and closed-card behavior already exist | Keep current panel. The complete diff is one import and one localized status cell; no P&L, calculation, column or action changes. |
| Seven dictionaries | Newer Funding V2, Copy Trading and other translations already exist; the 20 customer-presentation keys are absent | Exactly 20 additions and zero deletions per locale (ru/en/zh/es/hi/ja/ko). Existing digest guard retained, with only the exact added key list excluded. |
| Backend, financial ledger, schema, migrations, workflows, dependencies | Current main versions | Byte-identical tracked content to main (`git diff origin/main -- src prisma .github package*.json frontend/package*.json` is empty). |

None of the original PR's 30 complete file blobs equals its counterpart on fresh main. This alone is not treated as proof that every old hunk is needed: current-main behavior above was reconciled at hunk level. The outstanding presentation helpers/labels are absent on main; existing safe customer errors, refresh mechanics and Funding V2 are not reimplemented.

## Validation

- Targeted customer/listing/error/localization/chart/closed-card suites: **362/362**, 8 suites.
- Additional current Futures panel, native terminal, unknown-state, protection, P&L and reference-row preservation suites: **227/227**, 9 suites.
- Plain-language guard: **9/9**; Card/collateral preservation guard: **11/11**.
- Frontend TypeScript + Vite production build: **PASS** (existing bundle-size warning).
- `git diff --check`: PASS; no unresolved conflicts.
- Initial Windows Card asset hash failure was checkout CRLF conversion in two SVGs and the OFL text, not a repository content change. Restored exact Git blob bytes locally; the unchanged guard passed. No approved asset or hash expectation changed.
- Remote final-head CI must be checked after push; local results are not a substitute.
- The first CI run on `0fef5556` exposed one stale KYC browser expectation at `scripts/qa-kyc-materials.cjs:310`: an offline fetch now correctly uses `serverError.network` before the generic upload fallback. Updated only the expected localized message to an exact match. Offline/no-email, retry/idempotency, database and all subsequent scenario assertions remain intact. Script syntax check passed; the browser scenario requires the subsequent final-head CI run.

The 2026-10-07 audit and screenshots carried by the original PR are historical evidence, not newly captured results. This continuation is reconciliation and targeted regression validation, not a new audit. No production access, deployment, merge to main or production database migration was performed. Existing CI validates migrations only inside its disposable test databases.
