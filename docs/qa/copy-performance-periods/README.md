# Copy Trading — Nazar/Ksenia loading, period math, «Эффективность» (2026-09-29)

Base: `main` `08e4af19` (fresh-fetched). LOCAL QA ONLY: every figure below
comes from the real compiled router, `CopyPerformanceService` and
`MarketplaceSnapshots` over an in-memory scenario table. No production data
was read or written; production itself is not reachable from this sandbox
(`api.voltextech.net` → timeout).

## 1. Why Nazar and Ksenia stayed in «Загрузка…» / skeleton

**One cause for both cards**, because both arrive in one request.

| Fact | Evidence |
|---|---|
| The payload contract did not regress | Real router → real client `validStrategy` on 2026-09-21, 09-24 and 09-28, at `fdb45ef3`, `1fef1df2` and `main`: `nazar=true ksenia=true` every time. |
| The request cost did not regress in code | Same harness, first request of a new day / first request after a restart: `fdb45ef3` 3.6 s / 2.0 s, `1fef1df2` 4.0 s / 1.8 s, `main` 3.9 s / 1.7 s (one full core). |
| Where that cost is | Nazar: decode 107 ms, append 657 ms, re-encode 252 ms, **presentation replay 1 459 ms**; Ksenia: decode 175, append 727, re-encode 361, response 182 ms. Synchronous CPU, on the request path. |
| What production does with it | PR #307's production log: the first marketplace request of 2026-09-28 took **42.29 s**. The API shares one free 0.1-CPU container with the market collector since the single-service launcher (`ae7296e0`, 2026-09-22). |
| What the browser does | `copyMarketplaceStore` abandons at 15 s (by design), settles, and retries on the 60 s poll or a focus. |
| Why it looked like "loading" forever | `LiveMetric` drew every unknown figure as a grey skeleton bar **whether or not a request was in flight**, so a settled «no data» card looked identical to a loading one until the next poll. |

So there was no single "bad commit" in Copy Trading: the ~4 s of
synchronous work per new UTC day (and ~1.7 s per process start) was already
there on 2026-09-21; what changed is the CPU it runs on. The skeleton
presentation dates from `54d7eea3` (2026-09-13).

**Fix** (`src/services/copyTrading/marketplaceSnapshot.ts`): each strategy's
finished wire section is published — in memory and as one compressed row
beside its ledger row (`<ledger id>:marketplace`, same isolated table, no
schema change). A restarted process serves it in milliseconds; a new UTC day
is answered at once with the last confirmed day (the client already marks a
section older than today as stale) while the day's append runs after the
response, one strategy at a time; a process that has shown it can do the
day's work in ≤ 10 s waits for it, never longer. The day's refresh yields
the event loop between its heavy steps, and the next day is prepared at
00:03 UTC. In the page, a skeleton is drawn only while a request is really
in flight; afterwards an unknown figure is a visible «—» with «Данные
недоступны».

## 2. Period math

* **Cadence today: exactly 1 closed trade per strategy per UTC day** from
  `DAILY_PROGRESSION_EFFECTIVE_FROM = 2026-09-22` (every daily row since has
  `numberOfTrades: 1`; `copyPeriodProgression.test.ts`).
* **The backend already recomputed 30D/90D/ALL correctly.** Day N → N+1
  (2026-09-28 → 09-29), real service path: ALL P&L grows by exactly the new
  trade's net P&L (Nazar +21 783.95, Ksenia +23 308.80 USDT), ALL ROI by
  exactly the day's return, and each rolling window changes by exactly
  (new day − the day that left it) — Nazar 30D 367.43 → 363.18 %, 90D
  882.07 → 888.74 %, ALL 3 982.43 → 3 998.50 %.
* **The bug was in the frontend.** The profile's metrics block was fed the
  ALL slice for Nazar and Ksenia whatever period was selected
  (`components.tsx`, `strategyData ?? metrics`, present since `54d7eea3`),
  so pressing 7Д/30Д/90Д moved the chart and not the block. It now receives
  the selected period's slice.
* **Win rate** is wins ÷ (wins + losses): v8 counts a 0-P&L close as
  neither (server `outcomes(…, excludeBreakeven)`); stated in a tooltip.
* **«Сред. сделок в неделю»** is an average (trades ÷ calendar days × 7), so
  it is fractional by definition — hence «Сред.», not «Сделок за неделю».
* **0.00 % drawdown with losing trades** is correct: drawdown is measured on
  the period's DAILY performance index, and Ksenia's 30D has 4 losing trades
  but no losing day (each sat inside a net-positive day, before the one-a-day
  cadence).
* **∞** is shown only for a real zero denominator from the period's own data:
  Profit factor with no losing trade, Sortino with no losing day. An empty
  window stays «—». No finite number is invented.
* The owner's screenshot values (98.59 %, «0.63 : 1», Sharpe ∞, 82.01,
  «Единицы измерения», «Посл. сделка») cannot be produced by the VOLTEX code
  on `main` — no such string exists in the repository or its history — so
  they were not "fixed"; the block now uses those labels with VOLTEX's own
  figures.

## 3. Evidence in this folder (`qa-copy-performance-periods.cjs`, PASS, 0 findings)

| Scenario | Result |
|---|---|
| A. Day N, 1440 and 390 | Both cards hydrated (1.2 s desktop, 0.2 s mobile, from DOMContentLoaded). Each profile, each period: its own ROI, P&L мастера, P&L подписчиков and trade counts (all four distinct), Russian labels, ROI/P&L/USDT kept, no skeleton. |
| Language | EN render of the same block: every figure identical, heading «Performance», 1 marketplace request in total. |
| B. New day, append slowed to 45 s, fresh process | Cards hydrated in **233 ms** (request 13 ms) with 21.09–28.09; after the append, a focus refresh shows 22.09–29.09. |
| C. Marketplace 503 | No skeleton; «—» and «Данные недоступны» on both cards, 1440 and 390. |
| D. Marketplace never answers | In flight: skeletons + «Загрузка…»; after the 15 s abort: none, «—» + «Данные недоступны». |

Screenshots: `desktop-01-marketplace-hydrated.png`, `mobile-01-marketplace-hydrated.png`,
`desktop-{nazar,ksenia}-{7D,30D,90D,ALL}-profile.png`,
`{desktop,mobile}-{nazar,ksenia}-{7D,30D,90D,ALL}-effectiveness.png`,
`desktop-nazar-30D-effectiveness-en.png`, `desktop-02-slow-new-day-first-paint.png`,
`desktop-03-slow-new-day-after-refresh.png`, `{desktop,mobile}-04-server-error-honest-unavailable.png`,
`desktop-05-timeout-honest-unavailable.png`; raw numbers in `report.json`.

## 4. Codex integration review — 2026-09-29

Reviewed Claude head `83c6079ab1faba32e5a188387123b4b98902e19e`, then integrated
current main `5285e9b24aa4752439f1c184820a02f4b131d801` locally. Implementation
commit: `b58845867a9657cbea19721ac287276d7c4e907f`.

The first review found a remaining timeout: the router started Ksenia's
section only after Nazar's section resolved. If both strategies had been fast
previously and today's append stalled, each section waited its own 10-second
budget. A real local HTTP reproduction took **20,042 ms**, beyond the client's
15-second abort, despite both confirmed sections being available. The router
now starts both cache reads together; the existing refresh queue still runs
only one heavy replay at a time. The same condition now completes in
**10,027 ms**. These are local observed durations, not production guarantees.

Verification on the integrated tree: backend build and frontend production
build PASS; 91 tests across six targeted suites PASS. The four added snapshot
tests cover the combined request deadline, two simultaneous cold requests
with exactly one ledger/section write per strategy, a failed cold strategy
with a confirmed peer, and the opt-in daily timer. The timer test observes no
idle polling and exactly four model updates at 00:03 UTC (two ledger updates
and two published-section updates); stopping it prevents the next daily job.
Auth/redaction, period progression, Russian performance labels and payload/CI
contracts pass their existing assertions. Canonical cadence and financial
account paths are unchanged.

Limits: no production data was read or written. A completely empty published
cache still needs its first authoritative build; timer deadlines cannot
preempt synchronous CPU work or bound database latency. A fresh browser run
could not start because this environment has no Chromium executable; the
screenshots above remain Claude's earlier local evidence. Final-head CI and
production verification remain release steps, not claims from this review.
