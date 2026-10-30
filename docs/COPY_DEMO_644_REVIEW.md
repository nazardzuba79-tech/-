# Issue #644 — isolated server demo copy vertical slice

This candidate is stacked on #645, which is stacked on #643. It is **not a production release** and does not close the full Copy Trading roadmap. No live account or balance was used. Do not merge or deploy without owner approval.

## Verified integration order

1. #643 `74140acd5af90756e152b05dec189dd4ec7d264f`: nine exact-head workflows SUCCESS. Preserves the published unknown/loading/error/session-safe deposit check in main. Current main fetched for this work: `c1f13828c5d398c6792c2a20be551a7132ecf77a`.
2. #645 `f37553656a7237516bdcfe2766a6845b0a8a8e38`: eight exact-head workflows SUCCESS. Watchlist is independent of money/Wallet and keeps existing local entries. Three old-head assertion failures were corrected without changing runtime behavior, threshold, digest pins or normalization protection. Its base is #643 and is currently mergeable. After approval and #643 merge, retarget #645 to main and verify the exact merged diff/CI.
3. This isolated review candidate builds on that exact #645 HEAD. Do not import the broad #641 branch into main, or publish the entire main as an API overlay.

Cloudflare read-only verification on 30 October: canonical production `9ed179c697ea86dc6fb97dbbfa5b8674705f2e57`, deployment `8ac0fa93-4230-408c-a7a5-f8c29cb4ebee`, SUCCESS. Project production branch main, automatic production builds false, preview setting none. This proves deployment identity, not the outstanding authenticated production eligibility browser scenario.

Stocks #613 is separate and was not modified: current HEAD `22e82239553c03c47bce22ffaac5f266658bc49d` records calibrated PUSH_DIAGNOSTIC run 41016972734, crypto p95 +19.88% against +5%; performance gate FAIL despite report-only workflow success. No activation or repeated benchmark.

## Reused authority and supported behavior

- Existing `DemoTradingService`, `SpotBookTransaction`, `DemoBalance`, `DemoOrder`, `DemoTrade` perform all matching, conditional reserves, refunds and settlement. No second wallet, top-up, new credit endpoint, fabricated liquidity, external order or real balance access is added.
- `CopyStrategyOwner` explicitly binds VX-001/VX-KSENIA to the local environment's leader. Neither simulated performance histories nor browser localStorage can create execution events. No inference from email or display name.
- All participants require an existing demo-credit audit admission and an unblocked account, including ADMIN. Leaders cannot follow anyone, preventing self-copy and cycles. One subscription per user in this first slice; changing leader after subscription requires a future reconciled workflow. Maximum 25 active followers per leader bounds the initial review fanout.
- A source Spot LIMIT placement commits its delivery intents in the same PostgreSQL transaction as the source order. A monotonically ordered durable outbox preserves source order even when timestamps tie. A later subscription never replays historical orders.
- Quantity = original source quantity × the subscription ratio at placement, rounded DOWN to 18 decimals. Ratio must be >0 and <=1. The caller must explicitly choose positive per-order and total-exposure USDT limits. There is no $10,000 minimum. Limits can be edited; existing queued quantity ratios remain frozen, but current risk caps are rechecked before execution.
- Total exposure = cost basis of copied filled assets + outstanding copied BUY reserves. SELL is restricted to copy-attributed holdings minus outstanding copied SELL quantity. The existing conditional DemoBalance debit is the final authority; real Balance is never a funding fallback. Other account trades can reduce available inventory and cause a refusal; these copy-attributed lots are not a statement of the entire account portfolio.
- Copied LIMITs execute against actual existing demo liquidity. Prices, timing and partial fills may differ from the leader. Source cancellation cancels remaining copied quantity asynchronously; it never unwinds fills already committed. MARKET, leverage, Futures, stop/OCO orders and non-USDT quotes are not supported in this slice and produce explicit rejection receipts.
- Stopping atomically blocks new intents/placements, skips pending intents, and marks existing copy orders for cancellation. STOPPING remains visible until cancellation finishes; restart resumes it. Already purchased assets remain in DemoBalance; no forced sale. Resuming the same subscription does not backfill missed events.
- Execution request ID is derived from the delivery ID. The existing order replay protection, copied-order association and audit commit together. Lost responses/retries never create a second order. Infrastructure failures keep PENDING work; policy/funds refusals become terminal audited REJECTED results.
- `CopyDemoFill` stores only immutable DemoTrade references and sequence (no price, quantity or money). PnL and cost basis are derived from actual DemoTrade values in committed fill order. Missing provenance fails closed; millisecond timestamp ties cannot manufacture PnL. Self-matching involving copied orders is refused transactionally.

## API and UI

Authenticated, live-session-only endpoints under `/api/v1/copy-trading/demo`:

- GET: own subscription/status, last 100 receipts, copy-attributed lots, realized demo PnL and exposure. No other user's IDs accepted.
- PUT `/subscription`: strict body `{traderId,ratio,maxOrderUsdt,maxExposureUsdt}`; creates/resumes/edits only the authenticated user's row. Foreign `userId`, order IDs and unknown fields are rejected.
- DELETE `/subscription`: stop own subscription. Filled assets retained; no liquidation.

Separate review-only page `/copy-trading/demo`, enabled only by `VITE_COPY_DEMO_REVIEW=true`. Original approved Copy Trading page/watchlist/design remain untouched. It shows actual server status and a clear isolated-demo/price-divergence explanation, mandatory risk inputs, history, rejection reasons and PnL. Explicit refresh has no hidden Wallet polling. All seven languages and 1440/390 layouts are tested. Existing API helper rejects stale-session responses; page request generations ignore obsolete loads. A failed request is never shown as a confirmed subscription.

## Hard isolation / deployment boundaries

Backend defaults OFF. It requires **all** `COPY_DEMO_ENABLED=true`, `COPY_DEMO_ISOLATED_REVIEW=true`, `DEMO_SPOT_ENABLED=true`, `NODE_ENV=test`, plus a loopback PostgreSQL URL with a `copy_demo_...` database name. Production, remote databases and ordinary database names remain denied even if the flags are accidentally set. No production migration or activation was performed.

Additive review migration: `20261030180000_copy_demo_subscriptions`. It creates execution metadata/provenance only; no UPDATE of existing balances, orders, users, strategy identities or simulated histories. Before any later production plan, explicitly review admission/consent, risk defaults, account-deletion retention, scaling, loss/reconciliation UX, Market/Futures support and operational lifecycle. Restrictive foreign keys intentionally prevent deleting an account with unreconciled copy metadata.

Stopping a review environment: stop subscriptions and drain cancellations first; then disable the worker/route. Simply disabling a flag does not liquidate assets or erase already committed orders. Restore the previous review application if necessary, retaining metadata and inspecting open DemoOrders before any cleanup. Do not restore a whole production database to roll back this feature.

## Reproducible tests

`scripts/test-copy-demo-postgres.cjs` refuses non-loopback/non-fixture URLs and any nonempty User table before creating synthetic accounts. Apply migrations only to a new disposable PostgreSQL 18.6 database, then run with `COPY_DEMO_TEST_DATABASE_URL`. Never pass a production URL.

Local validation: backend/frontend typecheck and flagged Vite build, 51 targeted existing regression tests; PostgreSQL scenario and real-router Chromium desktop/mobile/seven-language checks. Full results are generated in `output/copy-demo644/{postgres,browser}.json`; screenshots in the same folder. Existing remote fonts are intercepted/blocked in the browser fixture; no external financial request or unexpected write is permitted. Required exact-head CI is the final authority for the committed candidate, separately from #645's successful CI.

Production is unchanged. This first working slice is not a claim of real-money copying or of full Market/Futures support.
