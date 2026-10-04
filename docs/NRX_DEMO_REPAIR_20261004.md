# NRX private simulation repair — 2026-10-04

## Scope and release status
PR #427 incorrectly credited synthetic sale proceeds to ordinary Spot Balance. The independent safety rollback restores the pre-427 ordinary OrderService and tests. This change adds a VTA-style, ADMIN-only NRX sale that debits only DemoBalance.NRX and credits only DemoBalance.USDT, with DemoOrder/DemoTrade receipts and an audit marker. No ordinary funds are copied or mutated.

The form uses the separate `/demo/nrx` snapshot and `/demo/nrx/sell` route. It never falls back to `/orders`. The displayed NRX account and proceeds are labelled DEMO. The original VTA contract, request key namespace and public chart schedule are retained. NRX request keys use a distinct local account namespace and distinct server-side UUID namespace. A retry reuses the original key, a recovery is read-only, and a changed payload under an existing key is rejected.

The existing production AccountDeletionGate on VtaDemoSales.sell also encloses the internal NRX dispatch. The HTTP schemas do not accept userId, simulation, price, side or type overrides. No new timers, background writer, provider request, migration or allocation is introduced.

## Inventory is a separate prerequisite — do not guess
The earlier repository allocation amount was 6250, while a user screenshot later displayed 31250 ordinary NRX. Neither proves the current authorized demo entitlement. Before releasing the new form, an authorized operator must inspect the actual production account, ordinary NRX available/locked, existing DemoBalance NRX, allocation audit receipts, any NRX_SIMULATION_SOLD records from #427, and order status. Inspect only the relevant account, and report no credentials.

Do not automatically clone ordinary balances, choose an amount from a screenshot, credit USDT to compensate, erase audit records, replay cancelled orders, or reset the account. If demo NRX is not provisioned, the new snapshot truthfully reports zero; it does not borrow from real holdings. A separately approved idempotent setup/reconciliation is required after those live records establish the amount and provenance. This PR intentionally cannot perform that unknown live mutation.

## Deployment gate
Backend must support `/demo/nrx` before publishing this frontend. Compare actual `/health` revision and the already-running NRX schedule against the candidate; never reset/move an active listing or rewrite chart history to bypass a release preflight. Use the existing Hetzner deployment procedure and existing credentials, not old Render/Neon configuration. Keep the rollback revision. Do not run reset/db-push or unreviewed data migrations. Confirm service health and source revision after release. A health response alone does not prove a sale.

End-to-end acceptance must use isolated fixtures: a partial and full sale, immediate demo balance/history update, repeated same-key POST, concurrent oversell, network timeout recovery, account switching, and no mutation of Balance/Order/Trade/withdrawal reserves. Production financial operations require the owner to perform or explicitly approve that exact operation. No actual customer transaction was run by this repair.
