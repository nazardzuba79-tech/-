# PR #512: owner Stocks Wallet and demand lifecycle review (2026-10-13)

Scope: branch `dot/stocks-owner-usdt-portfolio-20261013`, stacked on PR #497 at `2f6fa3f7ec152a1849fb12c3694854963694af14`. Fresh main remains `c205ca3ce64f087b490bae11b2a285791f11f052`. PR #512 baseline is `18fc90f96be14ecfda181bdf8d56a06ef82a7401`. No merge, deployment, production access, migration or real financial operation.

## Changes and causal evidence

- Wallet now reads a compact authenticated portfolio rather than the full ledger. It refreshes marks for held USDT instruments only, never runs an order matcher and never exposes paper cash as real equity/collateral. Historical USDC is untouched.
- No VIP tier is required to show the authenticated account's holdings. Logout clears the projection; late responses cannot cross accounts. Quote valuations expire without network polling; failed reads retain quantities with unavailable marks.
- Visible chart demand observes only the selected instrument. No owner-only autonomous timer polls holdings or pending orders. Hide/switch/unmount/logout release the visit; abort/release cancels only undispatched observations. Active transactions still complete atomically.
- A fresh visit cannot use a pre-resume quote to execute a Limit. Old worker acknowledgements cannot restore new-visit admission.
- Nonowners receive current response-only quote projections through shared cache/flights. Their four financial/control routes remain blocked and Buy/Sell remains a silent client no-op.
- The loopback proxy has exact path/method/query/header/origin allowlists and propagates disconnect. Browser QA uses the actual identityResolver with a disposable local /api/v1/me authority; it does not certify production authentication.

Before/after regressions preserved in local evidence:

- Original demand cases: 0/3 PASS -> 3/3 PASS.
- Wallet identical-source harness: 0/3 PASS -> 3/3 PASS (compact endpoint, expiry, unavailable retention).
- Nonowner quote: undefined -> 110 fixture mark; five requests for the same instrument share one provider call and cause zero fills.
- Queued observation after release: one unexpected Limit fill -> zero; the accepted blocking order still commits.
- Final lifecycle suite: 13/13 PASS; all simulator suites: 175/175 PASS.

## Validation

- Frontend TypeScript and production build: PASS. Existing >500 kB chunk warning retained.
- Backend TypeScript build: PASS.
- Stocks/simulator Node tests: 175/175 PASS, zero skipped; final lifecycle suite: 13/13 PASS.
- Focused ordinary typed frontend Jest: three suites, 14/14 PASS.
- Local full frontend Jest: 4,166 passed, six failed, zero pending across 253 suites. One new test's inferred fixture type was corrected, then all 14 focused assertions passed with ordinary typed ts-jest. Five remaining suites fail on unchanged Windows CRLF checkout-sensitive string/hash assertions (Card, PriceChart, Spot, Academy); exact Git blob hashes prove Card/PriceChart LF content unchanged. No production module or assertion was edited to hide these failures. Exact-head Linux CI must be reported separately.
- Browser: 43 assertions PASS at 1440 x 900 and 390 x 844. Includes Market Buy, same-ID retry, Wallet beside BTC without a crypto headline change, logout/revocation/login, worker/server restart, partial Sell, Limit reservation/cancellation, nonowner quote display and silent no-POST isolation, no horizontal overflow and no JavaScript exceptions.
- Browser quotes, candles, authority and crypto wallet are explicit fixtures; zero external requests. SQLite accounts are disposable. No live market/authentication readiness claim.
- Independent read-only code review identified and then verified fixes for disconnect and old-ack races; no further critical finding reported.

## Bounded resource comparison

This Windows fixture run has no CPU/disk throttle; it is not the original capacity gate. The baseline and all failed attempts are preserved. CPU is process-wide (client and server), RSS is sampled, and the five simultaneous chart readers share one owner account. These are not five distinct-user capacity tests.

| Measurement | Before | After |
|---|---:|---:|
| Wallet 20 reads: CPU, ms | 109 | 109 |
| Wallet peak RSS, MiB | 87.770 | 88.609 |
| Wallet p50/p95/p99, ms | 2.700 / 4.291 / 5.755 | 2.888 / 4.722 / 5.396 |
| Wallet response bytes | 290180 | 255400 |
| Wallet SQL reads/writes | 20 / 0 | 20 / 0 |
| Wallet provider calls | 0 (no mark refresh) | 1 (shared mark refresh) |
| Chart 20 reads: SQL reads | 21 (initial candidate: 40) | 20 |
| Warm chart p95, ms | 11.868 | 12.919 |
| Cold chart p95, ms | 9.940 (0/5 replies with a quote) | 54.352 (5/5 with a quote; 40 ms injected provider latency) |
| Idle 3.4 s: provider calls / SQL reads | 1 / 2 | 0 / 0 |

No HTTP errors or financial changes occurred. Additional quote work produces a complete cold reply; it is not a latency win. Do not infer a CPU improvement. No minimum server size, capacity for 20–50 distinct users or current Hetzner headroom was established. Physical fsync and SQLite-thread CPU are not measured in this microbenchmark. FULL durability is unchanged.

## Release blockers retained

1. Original Issue #505 resource gates and crypto coexistence p95 <= +5% remain unmet; this scope neither weakens nor replaces them.
2. Catalogue: 40 configured candidates (seven Bybit, 13 Binance, 20 MOEX). It is not 250 verified instruments.
3. MOEX/SBER remain blocked; commercial redistribution rights remain unconfirmed.
4. Production identity/gateway/deployment, operational backup/recovery and capacity verification require separate authorization/design.

Publish verdict: **BLOCKED**. The code is submitted for review only. Push uses the documented Cloudflare `[CF-Pages-Skip]` prefix, without skipping GitHub CI. Audited repository deploy workflows exclude this branch; external custom webhooks were not inventoried.
