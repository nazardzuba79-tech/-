# Pre-demand quote readiness (PR #528)

This follow-up preserves the original `QUOTE_STALE` rejection. The two cold initial trader responses in the frozen bounded-admission measurement were served an otherwise fresh shared quote observed before the trader's new demand epoch. The existing `quote.timestamp >= demandSince` fence correctly rejected them. The retained evidence does not prove the cause of other recovery-time rejections.

The server now adds an optional, response-only `WAITING_FOR_QUOTE / BEFORE_DEMAND / executable:false` hint only when that narrower condition can be proven. It validates the quote again at serialization, clears hints on demand changes/release/success/failure, and retains the original error. The frontend helper independently checks timestamps and freshness before explaining the wait. No retry, provider call, timestamp rewrite, TTL extension, ledger mutation, permission change or execution predicate was added. A later genuine observation must still pass the existing order checks.

Validation on the local source:

- All 27 `services/stocks-global/*.test.mjs` files: **227 PASS**, zero failures/skips/cancellations, 31.966 s. Providers and identities are fixtures; HTTP is loopback and SQLite is temporary. No load/capacity replay.
- New server readiness cases are included above: viewer-first shared quote, both traders blocked before demand, no extra provider/ledger activity, later observation/readiness, idempotent execution, hint expiry.
- New frontend helper: **57 PASS**, including freshness boundaries, invalid/future/zero timestamps and invalid delay.
- Exact workflow guard: **14 PASS**. The new test is appended to the existing isolated-simulator command; historical pins, thresholds and all other jobs remain unchanged.

Raw logs are retained locally in `output/stocks-two-trader-20261016/`; SHA256:

- `quote-readiness-full-stocks-global.log`: `542b21ab1424286200c965cbf8c99877975b43b5e45c05ed15befd01192c96c1`
- `quote-readiness-frontend-focused.log`: `0e201eee8e4f564630fffb0e4ff8130ad55d03063ab37583c111abdc73e9b3f8`

This is correctness evidence, not a new capacity or production acceptance claim. Original failed constrained/coexistence gates remain unresolved. MOEX and commercial data rights remain blocked. No merge or deploy.
