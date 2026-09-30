# CFD browser cold-provider readiness

## Failure and scope

The failed [CFD workflow run 36604257943](https://github.com/nazardzuba79-tech/-/actions/runs/36604257943), validate job `109529120159`, tested PR #345 through merge revision `6424c347562e2c14553c2bdef5f7e5a473bf5213`. Its chart remained in `error` while EIA supplied positive oil quotes. Builds and regression tests passed before this browser failure. The separate public-source job passed on another runner; it was not proof that the browser runner could obtain the same chart data within production timeouts.

Read-only independent comparison found that [prior run 36557203406](https://github.com/nazardzuba79-tech/-/actions/runs/36557203406), validate job `109369113668`, passed all four browser widths with the same provider, harness and workflow bytes. The failed browser runner was in Azure westus3, whereas its passing public-source job ran in eastus2. That public latest request needed approximately 5.24 seconds. These observations support availability/latency sensitivity; they do not establish a production parser defect.

## Narrow correction

Before the cold browser takes its six-hour display snapshot, the harness requests its actual uncached loopback `/api/v1/cfd/tickers` and `/api/v1/cfd/candles/{symbol}?interval=1h&limit=320` routes. It requires a positive quote and at least two sane unique bars with the exact symbol and interval for both the selected and reload chart. There are at most three attempts, 8-second request deadlines and 1/2-second retry delays. Each attempt records request paths, status, elapsed time, candle counts and errors. Unavailability exhausts the budget and fails the gate.

No production source, timeout, provider, financial route or market parser changes. The readiness helper omits credentials, rejects redirects and non-loopback targets, and never calls display snapshot routes. Every original browser UI/order/cache/reload assertion and every public-provider workflow check remains. Both helper paths trigger their owning workflow. No replacement bars are injected into the real-feed browser run.

## Actual verification and limits

- Focused Node suite: **13/13 PASS**, zero skipped/todo; raw output in `readiness-tests.txt`.
- Success and transient recovery are tested alongside no-priced-quote, mismatched symbol/interval, invalid OHLC/time, duplicate/single-bar, transport, non-JSON, unavailable-provider and forbidden-origin failures.
- Helper, harness and test syntax plus Git whitespace checks passed.
- Prior fresh application builds and Spot browser passes apply to the unchanged application runtime.
- Local live-provider requests timed out. **A full local real-feed CFD browser pass is not claimed. The next exact-head CI run remains authoritative.**

The original failed browser step is retained in `failed-ci-step.txt`. All remote operations were read only; this correction does not push, rerun, merge or deploy anything.
