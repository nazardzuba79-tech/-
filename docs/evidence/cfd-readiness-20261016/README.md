# PR 528 — CFD selected-quote readiness (part A)

Owner request: [comment 6208568636](https://github.com/nazardzuba79-tech/-/pull/528#issuecomment-6208568636). Source starts at `9f453a9d46b4feff714190a8aa4b3628ce42dffa`; fresh main is `c2ee9e7143a45f80f300fb997da6a5f40a97fee6`. No integration with main or product/runtime changes are included in this correction.

## Three original failures

[CFD run 38850356451](https://github.com/nazardzuba79-tech/-/actions/runs/38850356451) retained 71 PASS / 3 FAIL. `stats.verified-only` observed only price/status, XAUUSD price `—` and status `unknown`. `type.area` and `type.candles` then compared the initial `—` / `Цена недоступна` against the newly arrived `4,179.67` / `≈ 4,179.67`. The first four type comparisons had compared unavailable values to themselves.

The harness waited for **any** numeric sidebar quote before asserting the selected XAUUSD statistics and price invariance. That precondition does not establish a valid selected price. Daily XAUUSD sessions are also needed for the six original statistics. The route's first partial ticker snapshot can have a 30-second HTTP TTL while retaining the normal six-hour display envelope. The old artifact did not record response bodies/headers, so that cache mechanism is a possible timing explanation, not a proven reconstruction of the old provider responses.

## Narrow correction

- Wait within the original 45 seconds for the requested, active and header symbols to match; observed successful XAUUSD ticker/daily responses must satisfy the actual client snapshot envelope and render the corresponding numeric ticker/ticket plus all six original statistics.
- Preserve the exact ticker/ticket equality checks for every chart type. Additionally require the same observed quote/source/acquisition/daily-data epoch. A new epoch, even with the same rounded price, fails explicitly rather than resetting the baseline.
- Record response sequence, timing, source, symbol, age, payload hashes, safe cache headers, client cache metadata and CDP cache provenance. The observer issues no requests, changes no cache policy and performs no forced refresh or retry.
- Preserve sampled/closed display semantics; no execution-price freshness rule is added. Unavailable/malformed data fails. Diagnostic buffers and final drain are bounded; incomplete evidence fails explicitly.
- Add helper paths/tests to the existing CFD workflow. Original checks and timeouts remain. Stocks, Spot, Futures, provider adapters, trading and database code are untouched.

## Local evidence

Both checkouts were built sequentially with the same Node/dependencies and `VITE_API_URL=/api/v1`. Each browser run starts a fresh loopback host, browser context and display cache, at 1440 × 900, ru-RU / UTC, against the existing real public CFD routes; database access and external financial writes are forbidden by the existing host.

| Run | PASS | FAIL | Page errors |
| --- | ---: | ---: | ---: |
| Original readiness + observation, review 9f453a9d | 45 | 0 | 0 |
| Original readiness + observation, main c2ee9e71 | 45 | 0 | 0 |
| Final selected-quote readiness, review 9f453a9d runtime | 45 | 0 | 0 |
| Final selected-quote readiness, main c2ee9e71 runtime | 45 | 0 | 0 |

These sequential live runs use the same configuration, not identical market input. The original three failures **did not reproduce locally**: the initial XAUUSD response was available. Exact source/report hashes and each real price/timestamp remain in `paired-summary.json`; compressed full reports preserve network/cache traces. The intermediate fixed pair also passed and is retained in the local output directory, with its receipt in `paired-runs.json`. Its helper predates the final source/envelope checks and is not substituted for final acceptance.

Backend TypeScript and frontend production builds: 4/4 PASS across both checkouts. Existing large-chunk build warnings remain. Helper tests: **43 PASS, 0 FAIL, 0 skipped** (30 selected-quote/observer tests plus 13 existing readiness tests). Deterministic unit inputs are explicitly synthetic and are never used as provider data or in a preview. Coverage includes wrong instrument, invalid source/envelope/status/session, delayed selected response, unchanged 45-second timeout, stalled body/DOM, permanent selected unavailability at 45 seconds, bounded drain/overflow, latest pending response, cache provenance and changed epochs. The first helper run exposed two bugs (whitespace source and open previous session); both were fixed, and its negative log is retained.

Unchanged native admission regressions: **10 PASS, 0 FAIL, 0 skipped**.

Exact-head GitHub CFD, Chart and Stocks CI must still complete after this source is pushed. This local evidence is not production or capacity approval. Prior Stocks load/coexistence, real PostgreSQL, public-route and market-data-rights blockers remain; part B is separate. No merge, deployment or production mutation.
