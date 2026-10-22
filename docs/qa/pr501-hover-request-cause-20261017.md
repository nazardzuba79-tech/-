# PR #501 — hover request attribution

Base reviewed: main `50875f2116474ce01acbb08c1d9e3e68ec99a7f3`.
Failing head: `aabe8f963874fa5b8179728803cc68c49354694e`.

## Evidence

GitHub run 39020626838, retry job 117362619473, artifact 12097405091
(`chart-workspace-browser`, SHA-256 `369eae4fb46901d3b41e9abd52d06416c3d07a1b14cfbf3ba4fdebc44ee8b07f`)
records 220 passing checks and the two data-window failures. Its report only
retained the count; interaction network events were not retained (its traces
cover layout transitions). The original CI request's exact UTC timestamp cannot
be recovered from that artifact.

One narrow loopback control run instrumented the existing production bundle with
fetch timestamps, interval registration/ticks and Chromium async initiator stacks.
No source changes or financial requests were used.

| Context | Observed request UTC | Relative time / timer | URL |
| --- | --- | --- | --- |
| Futures | 2026-10-17T14:02:21.791Z | fetch 5281.1 ms; 5000 ms interval #33 registered at 264.5 ms, fired at 5280.6 ms | /api/v1/market/futures/candles/BTC-USDT?interval=1h&limit=520 |
| Spot | 2026-10-17T14:02:31.391Z | fetch 5349.1 ms; 5000 ms interval #19 registered at 334.0 ms, fired at 5348.5 ms | /api/v1/market/external/candles/BTC-USDT?interval=1h&limit=520 |

Both requests have a Chromium async initiator chain `await → setInterval`.
The compiled caller maps to `PriceChart.tsx`'s `load` and
`browserSetInterval(load, 5000)` (line 1545 at the reviewed head), through
`browserActivity.ts`'s interval callback and display fetch. The registered
interval predates pointer input. The crosshair callback only looks up loaded
bars and schedules a state update in requestAnimationFrame; it does not fetch.
The original test counted any candle request during its wall-clock observation
window, including this independent periodic tick.

The chart component, browser-activity implementation and original harness are
byte-identical between the failing head and current main. The preceding head
0fef5556 also has identical frontend code and passed this workflow; this is
consistent with whether the real-time observation window overlaps a poll.

Raw control evidence is retained in the task's local outputs/pr501-20261017/
hover-control/{futures,spot}-hover-network.json, including full async stacks.
These are control-run timestamps, not reconstructed original CI timestamps.

## Fix and retained requirement

Only the browser harness changes. During the same 20 pointer moves and 400 ms
settling window, pre-existing periodic callbacks are deferred, then resumed in
`finally`. Their interval schedule remains alive. Cleared callbacks cannot be
resurrected. Events, fetch, timeouts, animation frames, microtasks and intervals
created during the interaction are not disabled.

The assertion still requires **zero** requests from hover. It now observes all
browser HTTP requests and all fetch attempts, rather than only URLs containing
`candles`. New interval registrations also fail the check, including a delayed
interval whose first request would land after the observation window. Deferred
background ticks are reported separately with registration and due times.
No limits were raised and no assertions or test stages were removed.

Seven helper regressions prove periodic resume/cancellation and negative controls
for direct pointer fetches (including the same candle URL), timeout/rAF/microtask
fetches, and new interval fetches. The narrow real-browser `--only data` run passes
8/8 checks: Futures and Spot each report zero HTTP/fetch attempts during hover.
The workflow adds the helper to its path triggers and includes these regressions
in its existing mandatory pure-suites job.

All production source, approved design, Funding V2, financial logic and seven
locale dictionaries remain byte-identical to aabe8f96. Remote CI on the final
pushed SHA is the remaining validation step; no merge, deployment or production
migration is authorized.
