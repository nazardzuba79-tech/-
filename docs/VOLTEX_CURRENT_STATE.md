# VOLTEX — current state

Updated: 2026-10-03  
Source branch at update: `188b24542c20b65b0aaaa85df1d6f5a9a2a02209`

## Production

- Frontend / edge: Cloudflare.
- Public market fallback and Listings edge: Cloudflare Workers.
- Main backend/API: migrated from Render to Hetzner.
- The Hetzner cutover was validated around main `7cb2ac057beb31d3e934f265e89f3345cdc8865d`; repository main has advanced substantially since then. Treat frontend features added after that cutover as potentially newer than the deployed API until the live Hetzner backend commit is verified.
- Main PostgreSQL and market-data collector: migrated to Hetzner with the backend.
- Render production API `voltex-api`: suspended by owner.
- Old Render `exchange-api` and `voltex-exchange`: suspended.
- Neon project `VOLTEX Production Final` is retained as old/rollback infrastructure; its production compute stopped showing activity after the Hetzner cutover work on 2026-10-02.
- Render/Neon free-tier read quotas are no longer production UX constraints. Keep request coalescing, hidden-tab pause and sane provider pacing, but do not deliberately leave visible account data stale just to save old Render/Neon usage.
- Before infrastructure changes, verify the live Hetzner processes, active database target, collector and DNS. Do not infer them from old Render/Neon configuration.

## Completed recently

- Futures mobile/desktop refinement and browser QA.
- Spot/CFD presentation parity and CFD Deriv feed fixes.
- Admin paging, filters, operation receipts/recovery and listing safety.
- Admin frontend/backend compatibility repair merged as PR #414: compact Users KPIs, legacy read fallbacks, no duplicate queue dashboard.
- Deposit/withdraw/KYC operational workflows.
- Header/navigation cleanup.
- Spot ticker/search readability fix merged as PR #412.
- NRX/VTA test-market presentation work.

## NOW

1. Review PR #410: Crypto Card server-backed eligibility progress + visible Wallet account refresh + server-authoritative Supreme VIP tier.
2. Finalize the new Login/Register visual direction without changing authentication behavior.
3. Complete the dependency/security remediation review in PR #413.
4. Run final whole-product QA after the remaining approved PRs are reconciled to current main.

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
