# Stocks request-lifetime authentication cancellation

Parent: `dc5327b7def5ac4f5b448f820bbd279b7072d7f9`; integrated main: `d694b2a0c493c0fad7d496ae47a15ad8eb0429a6`. This is a narrow runtime follow-up in PR #512, not a new capacity acceptance result.

## Defect and correction

The Stocks HTTP handler awaited authentication before installing its route-specific disconnect listeners. The identity resolver had only its own three-second deadline. An already admitted authority request could therefore continue after its Stocks client disconnected.

The API handler now installs `req.aborted` and unfinished `res.close` listeners before authentication. It passes a request-local signal into the resolver, which bridges it to the existing fetch/body-reader controller. Pre-aborted requests never call the authority, late response bodies are cancelled, and listeners are detached in `finally`. Normal `req.close` is deliberately not used: a live GET can finish receiving its request while still awaiting its response.

The signal is not passed to financial execution or shared account registration. The three-second auth deadline, response byte bound, every-request revocation check, no-cache identity policy, SQLite FULL durability, prices, FX, P&L and idempotency are unchanged. Existing route-specific read/portfolio/history lifetimes remain in place.

## Actual HTTP before/after

The same probe used the actual Stocks server, actual identity resolver, a temporary isolated SQLite ledger and a loopback authority. The authority admitted the request before the client disconnected. Its response was deliberately held; the probe required transport closure within 600 ms, below the unchanged three-second authentication deadline.

| Evidence | Parent | Corrected source |
| --- | --- | --- |
| Upstream closes within 600 ms | FAIL | PASS |
| Admission / client abort / upstream close, monotonic ms | 162.3346 / 162.4166 / absent | 170.8201 / 170.9015 / 176.4793 |
| Exit code | 1, assertion failure | 0 |
| Log SHA256 | `68e5e6fe585460ae4db66eb367d3f7bb463136a9fec9e6e9ae1b5669a6560511` | `0b89aa8dac9c25911df26f248d6779aae83642e3f522312d2f934fd5369a026f` |

The measured close delay was 5.5778 ms in this local run. This is a causal transport cancellation check, not a throughput or server-capacity claim. A preceding harness setup error used a directory instead of a SQLite filename; its separate raw log is retained and is not counted as the defect reproduction.

## Regression and evidence boundaries

- Existing isolated simulator CI test list plus the new cancellation barrier and backend-admission guards: **218/218 PASS**, zero failed/skipped/cancelled, 7692.0307 ms on Node 24.21.0. Complete log SHA256: `6a6c3ef055d561049047881ebf0f42cfee35dfac29d110bc43c2bcc9644febf5`.
- Identity suite includes pre-aborted and immediate abort, late response/body cleanup, stalled-reader cleanup, concurrent live-request isolation, failure-listener cleanup and unchanged deadline/revocation/response-size behavior.
- The tracked barrier fixture starts only inside an actual HTTP authority handler. Its separate one-second timeout, manual release, missing/misordered/cross-case events or incomplete cleanup cannot count as cancellation proof. Successful evidence requires admission → client abort → Stocks response close → upstream close → handler finally.
- In the combined regression, those events were 195.9274 / 200.5545 / 207.7470 / 209.6334 / 209.7379 ms. Bob was admitted with an unfinished identity body before Alice aborted, and subsequently completed HTTP 200. Both live-request isolation and complete timer/listener cleanup passed.
- This authority is a simple loopback transport fixture, **not the compiled production auth handler**. The preceding compiled-auth diagnostic and its failures are retained separately. No provider or broker call, production database access or real financial operation was performed.
- The original finite ordinary matrix, classification, frozen launch policy and resource/deadline criteria are unchanged. Both completed finite-auth jobs are explicitly pinned to the parent dc5327b7 head; on a new head they are **NOT_RUN**, pending a separately reviewed causal plan. The new focused test runs in the normal isolated simulator job.
- Runtime changes require the existing **FULL backend admission**. The QA-only admission manifest is not refreshed to skip it. Exact-head CI status must be read from the PR; local success is not full CI success.

All local raw logs, the unchanged before/after probe and source/hash packet are preserved outside Git under `output/stocks-next-release-20261013/auth-lifetime-20261014/` in the task workspace.

## Release status

**BLOCKED.** The correction proves cancellation for an admitted request; its effect on the previous 45 compact-profile deadline failures is unmeasured. The prior six timed auth runs remain FAIL, their cancellation coverage remains NOT_PROVEN, and original capacity/crypto-coexistence, backend/browser, commercial data rights and passive observation gates are not waived. No further benchmark, observer action, merge or deployment is part of this change.
