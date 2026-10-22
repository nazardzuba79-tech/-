# VOLTEX — current state

Updated: 2026-10-03  
Source main at update: `d89740216f0f9a26cf99392f8fca7abdaad7ede9`

## Production

- Frontend / edge: Cloudflare.
- Public market fallback and Listings edge: Cloudflare Workers.
- Main backend/API: migrated from Render to Hetzner.
- The Hetzner cutover was validated around main `7cb2ac057beb31d3e934f265e89f3345cdc8865d`; repository main has advanced substantially since then. Treat frontend/backend features added after that cutover as potentially newer than the deployed Hetzner services until the live commit/fingerprint is verified.
- Main PostgreSQL and market-data collector: migrated to Hetzner with the backend.
- Render production API `voltex-api`: suspended by owner.
- Old Render `exchange-api` and `voltex-exchange`: suspended.
- Neon project `VOLTEX Production Final` is retained as old/rollback infrastructure; it is not the primary production database.
- Render/Neon free-tier read quotas are no longer production UX constraints. Keep request coalescing, hidden-tab pause and sane provider pacing, but do not deliberately leave visible account data stale just to save old Render/Neon usage.
- Before infrastructure changes, verify the live Hetzner processes, active database target, collector and DNS. Do not infer them from old Render/Neon configuration.

## Completed recently

- PR #412: Spot ticker/search readability fix.
- PR #414: Admin API compatibility + compact Users workspace.
- PR #415: released Futures graphite design applied to Spot and CFD.
- PR #417: Admin Users owner trim.
- PR #420: Admin Users plain/copyable email, shorter search and login-state dot.
- PR #421: NRX v3 three-stage schedule + owner allocation definition merged into repository main. This merge alone does **not** prove the Hetzner API and market-edge are serving the same v3 schedule; production rollout must be verified separately before claiming it live.
- Futures mobile/desktop refinement and browser QA.
- Deposit/withdraw/KYC operational workflows.
- Header/navigation cleanup.

## NOW

1. Finish PR #410: Crypto Card server-backed eligibility progress + visible Wallet account refresh + server-authoritative Supreme VIP tier; exact-head CI must be green.
2. Review PR #419 Deposit minimum UI and merge only with owner approval.
3. Complete dependency/security remediation review in PR #413.
4. Review PR #411 Settings → existing Trading Bots route.
5. Finalize the Login/Register visual direction without changing authentication behavior.
6. Run final whole-product QA after the remaining approved PRs are reconciled to current main.

## LATER

- Admin visual/settings constructor.
- Real Trading Bots execution engine.
- Real card issuer/processing/shipping integration.
- Separate On-Chain Intelligence product.

## Rules

- Fresh-fetch `main` before conclusions or changes.
- No merge without direct owner command.
- No deploy without direct owner command.
- No production change without direct owner command.
- Do not treat old Render/Neon configuration as current production.
