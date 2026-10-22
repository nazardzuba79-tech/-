# NRX owner Spot simulation restoration — 2026-10-05

## Latest owner instruction

The owner explicitly clarified that this early-stage exchange is used with test balances, not real traders or real funds, and requested the previous NRX simulation sale behavior rather than a separate DemoBalance account. This supersedes the earlier instruction to release #432 and to require a demo-inventory transfer. It does not authorize resetting, allocating, transferring or inventing any balances.

## Integration

Base: main 3de491c05f2589044cca3435bbda3f04bc46d870, including mobile #434 and Codex ruler #435.

- Restore the OrderService.ts blob from reviewed #427 head e23c5af54379ef369a5d934f93afcfbfd8ba139d. Fresh-main OrderService before restoration has the same blob as #427's original base, so no newer service changes are overwritten.
- ADMIN + NRX/USDT + MARKET SELL uses the existing Spot NRX available balance, debits NRX and credits simulation USDT in one serializable transaction. It records FILLED order, synthetic counterparty simulation:NRX, trade and NRX_SIMULATION_SOLD audit.
- Preserve listing gate, role/block recheck, positive quantity/price checks and available-balance conditional debit. Locked inventory cannot be sold.
- Keep the existing Spot form, balances and history; do not merge #432 or switch the terminal to DemoBalance. No balance setup or migration is required by this restoration.
- Port all six non-handoff files from Claude #436 head 4806157d85822e3d285d9f9c79e9a9e8e5bc71e0 exactly. This detaches the never-installed expired v3 plan and aligns backend simulation math with the existing live-chart trajectory; it does not restart the listing or invent a new schedule.
- Leave shared docs/AI_HANDOFF.md intact to preserve Codex's ruler handoff. This document is the current NRX release instruction.
- Other pairs, non-admin users, BUY and non-MARKET orders retain their previous matching behavior. No withdrawal, wallet-transfer, KYC, collector or infrastructure behavior is changed.

## Verification

No tests were run locally: this session's container cannot resolve GitHub and has no repository dependencies/PostgreSQL. Exact-head GitHub CI is required before merge; no source-head result is substituted for integration-head verification.

Restore NRX PostgreSQL sale/non-admin regression coverage and add disposable tests for an existing 31,250 NRX fixture: sell 15,625, restart OrderService, sell the remainder, assert the Spot balances and persisted orders/trades/audits. Another test verifies locked inventory and rollback on insufficient available balance. Fixture quantities are not an instruction to write production balances.

## Operator rollout

This commit does not deploy the Hetzner backend. The GitHub/Cloudflare frontend deployment cannot update the server OrderService by itself.

Use the existing authorized Hetzner deployment session and established procedure, not Render/Neon. Read the actual serving SHA, checkout/process layout, database target and migration state without exposing credentials. Preserve existing balances, listing time/history and collector. Deploy the verified integrated revision through that procedure, including only migrations already required by that reviewed revision; do not run allocation/seed/reset scripts. Confirm health revision and that the NRX canonical source matches the chart. Do not submit an owner sale as a health check: the owner chooses the quantity. Roll back to the recorded serving revision if rollout checks fail.

No SSH session or usable Hetzner deployment connector is available in this chat. Public health could not be read with the available web tool. Deployment and a live completed sale must not be reported as verified here.
