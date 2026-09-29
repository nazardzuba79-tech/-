# Copy Trading — Nazar (VX-001) and Ksenia (VX-KSENIA)

What must stay true about these two cards, what enforces each rule, and what
to check on production after a deploy.

This is not a summary of the code. It exists because "CI is green" has been
said about a page that was broken for the viewer, and because the same class
of failure has now come back more than once from changes that had nothing to
do with Copy Trading.

---

## The invariants, and what enforces each

| # | Rule | Enforced by |
|---|------|-------------|
| 1 | **Loading can never be eternal.** «Загрузка…» is allowed only while a real request is in flight. The moment an attempt ends — for any reason, including reasons that are not a response — the viewer is owed real figures, last-good figures flagged stale, or an honest «Данные недоступны». That includes the metrics themselves: a skeleton bar only while the request is in flight, a visible «—» once it is over (`MetricPendingContext` in `LiveMetric.tsx`). | `copyTradingCriticalPath.test.ts` → `noEternalLoading`, applied at every step of every case, with the clock held still. `copyPerformancePeriods.test.ts` (skeleton only in flight). `scripts/qa-copy-never-loading.cjs` and `qa-copy-performance-periods.cjs` (503 and 15 s abort) in a browser. |
| 2 | **The session state machine is complete**: cold load, late token, mid-flight session change, logout, another login, StrictMode double mount, route return, focus. | `copyTradingCriticalPath.test.ts` cases 5–13, `copyMarketplaceSettles.test.ts`, `copyFirstLoad.test.ts`. |
| 3 | **A failed prefetch never blocks a visit.** A success may be reused for 30s; a failure may not be reused at all. | Critical path case 7, `copyMarketplaceRetry.test.ts`, browser scenario 06. |
| 4 | **Last-good data survives a later failure.** Session-scoped, re-validated on read, cleared on logout. | Critical path cases 11 and 13, `copyMarketplaceCache.test.ts`, `qa-copy-last-good-browser.cjs`. |
| 5 | **The payload contract is two-sided.** The real route's bytes must pass the real client validator; the client cannot be loosened to accept a broken server, nor the server changed without the client following. | `copyMarketplaceEndpointContract.test.ts` (real router → real HTTP → real `validStrategy`). |
| 6 | **Ksenia's owner-reported +61.9% belongs to ONE week** (13–19 Sep 2026), provenance `OWNER_REPORTED`, and lives in exactly one file: `src/services/copyTrading/kseniaReportedWeek.ts`. A second hardcoded production copy fails the build. It stays on that week's `weekly[]` row permanently and is the rolling 7D **only while the model is inside that week** — after it, 7D is the ledger's own derivation and moves forward daily. | Critical path case 4 (including a source scan for a second copy), `kseniaReportedWeek.test.ts`, `qa-copy-loading-and-ksenia.cjs` scenario 9. |
| 7 | **Hidden trade history is a declaration, not an absence.** `trades: []` is legitimate only with a valid `tradeVisibility`; the real total, the aggregates and every financial figure still have to be there. | Critical path case 3, `tradeHistoryVisibility.test.ts`, `qa-copy-cards-trades-avatar.cjs` (scans the wire, not the DOM). |
| 8 | **Nothing is fabricated.** No fallback ROI, PnL, AUM or win rate; no demo trader standing in for Nazar or Ksenia; no `0` where the answer is unknown. Unknown reads `—`. | Critical path cases 1, 10 and 15; the browser harness fails a bare zero with no data behind it. |
| 9 | **Sections are independent.** Nazar, Ksenia and identities each fail alone. | Critical path case 14, `copyMarketplaceEndpointContract.test.ts`. |
| 10 | **The endpoint fits inside the client's own timeout.** | `copyMarketplaceEndpointContract.test.ts` time budget. |
| 11 | **Every section is logged, by name and outcome, with nothing identifying.** | `copyMarketplaceEndpointContract.test.ts` observability case. |
| 12 | **CI runs whenever something Copy Trading depends on changes.** | `copyTradingCiCoverage.test.ts` walks the real import graph and fails on any file missing from the workflow's `paths:`. |
| 13 | **One new closed trade per strategy per UTC calendar day**, from `DAILY_PROGRESSION_EFFECTIVE_FROM`. Never 0, never 2. A repeat request on the same day adds none; an N-day gap adds exactly N, one per missed day; no day before that date is rewritten. Every ROI, PnL, win rate, Sharpe, Sortino, chart and daily result is read off that same ledger. | `dailyProgression.test.ts`, `qa-copy-daily-progression.cjs`. |
| 14 | **Nazar's and Ksenia's executions reach nobody.** Not a subscriber, not a copier, not a favourite, not a large deposit — the server sends none and the «Сделки» tab is a locked state keyed on the strategy, never on the viewer or on a loaded payload. No public route may serve a trade row. | `tradeHistoryVisibility.test.ts` (including a sweep of every public GET enumerated off both routers), `copyHiddenTradeHistory.test.ts`, `qa-copy-cards-trades-avatar.cjs`, `qa-copy-daily-progression.cjs`. |
| 15 | **No service vocabulary on a customer-facing surface.** «по данным управляющего», «за отчётную неделю», `OWNER_REPORTED`, "synthetic", "modeled" and the like never reach a rendered string. | `copyCustomerFacingWording.test.ts` (TypeScript AST over every Copy Trading UI file). |
| 16 | **The marketplace never waits for a day's append.** Each strategy's finished wire section is published beside its ledger row (`<ledger id>:marketplace`). A restarted process serves it without replaying history; a new UTC day answers at once with the last confirmed day while the append runs after the response, one strategy at a time; a process that did the day's work in ≤ 10 s may wait for it, never longer. The refresh yields the event loop between its heavy steps. | `marketplaceSnapshot.test.ts` (append held forever → 200 in < 2 s over real HTTP; yields mutation-checked), `qa-copy-performance-periods.cjs` scenario B (45 s append → cards in 233 ms). |
| 17 | **«Эффективность» is the selected period's own.** Every figure is that period's slice of the one ledger; card, profile, chart, economics and the monthly table agree; a new trade reaches 7D, 30D, 90D and ALL, each re-derived from its own window. `∞` only for a real zero denominator (no losing trade / no losing day), never a made-up finite number. | `copyPeriodProgression.test.ts` (day N → N+1 through the real service path), `copyPerformancePeriods.test.ts`, `qa-copy-performance-periods.cjs` scenario A. |
| 18 | **Language changes words, never figures.** The block's labels are `copyPerformance.*` keys in all seven dictionaries; ROI, P&L and USDT are the same in every language; switching language sends no request and changes no number. | `copyPerformancePeriods.test.ts`, `i18nLanguageChunks.test.ts`. |

---

## Measured, so nobody has to guess

Taken on this repository, cold process, in-memory scenario table:

| | Cold (first generation) | Warm (cached per UTC day) |
|---|---|---|
| Nazar `service.get` | ~2119 ms | ~0 ms |
| Ksenia `service.get` | ~1207 ms | ~0 ms |
| Post-processing (summarise + overlays + redact) | ~1.4 / ~7.8 ms | ~1.1 / ~5.4 ms |
| Payload on the wire | ~196 KB / ~194 KB | same |

**Production is not this machine.** The first marketplace request of
2026-09-28 took **42.29 s** on production (PR #307's log): the API shares a
free 0.1-CPU container with the collector. Per phase on one core: Nazar
decode 107 ms, append 657 ms, re-encode 252 ms, presentation replay 1 459 ms;
Ksenia decode 175, append 727, re-encode 361, response 182 ms. That is why
invariant 16 moved the day's work off the request path.

The generation is synchronous CPU work, so `Promise.allSettled` does not
overlap it and worker threads would be the only thing that could.
**Concurrency is deliberately left alone**: the ~3.3 s is once per process
per UTC day, inside a client that waits fifteen seconds. Changing it would
be a rewrite bought with nothing. If that measurement ever stops holding,
the time-budget case is what says so.

---

## Observability

Every marketplace request now writes one line per section, success included:

```
copy_marketplace.nazar.ok       request_id=<uuid> duration_ms=<n>
copy_marketplace.ksenia.ok      request_id=<uuid> duration_ms=<n>
copy_marketplace.identities.error request_id=<uuid> duration_ms=<n> error_class=<ctor>
```

Reading an incident from these:

- **`.error` on one section, `.ok` on the others** — a server-side failure in
  that section. The developer-facing reason is on the `[copy-trading]` line
  beside it.
- **`.ok` on every request while the card is blank** — the server is fine and
  the BROWSER is refusing the payload (`rejected_by_client`). That is a
  frontend validator or payload-shape problem, not this endpoint.
- **`duration_ms` near 15000** — the client has already abandoned it. The
  card will read stale or unavailable however healthy the response is.
- **No lines at all while a viewer reports a blank card** — the request never
  reached the server: session, network, or a client-side throttle.

No token, Authorization header, account id, email, request body, payload or
figure is ever written. The request id is generated per request and
correlates the three lines of one response to each other.

---

## Production smoke gate

CI proves the code. This proves the PAGE. Run it after every deploy that
touches anything in the workflow's `paths:` list, on the real domain, signed
in as a real account.

1. Open `/copy-trading`. It renders, no white screen.
2. **Nazar's card settles** within ~15 s: a real ROI figure, or «Данные
   недоступны». Not «Загрузка…».
3. **Ksenia's card settles** on the same terms, with a real 7D figure
   labelled simply `ROI 7Д`. It is **not** +61.9% unless the model is
   genuinely inside 13–19 September 2026: that reported figure belongs to
   that week's row and the rolling window moves on past it.
4. No card is still showing a skeleton past the client's fifteen-second
   timeout.
5. Browser console: no uncaught error, no `NaN` anywhere on the page.
6. Network tab: `GET /api/v1/copy-trading/marketplace` **completed** —
   status, and a body carrying both sections.
7. Server logs for that minute contain `copy_marketplace.nazar.*` and
   `copy_marketplace.ksenia.*`. Read them per the table above.
8. Open Nazar's profile and Ksenia's profile. Both paint. The «Сделки»
   tab is a locked state — one centred icon over «Торговая информация
   этого трейдера скрыта», nothing else — never a table of executions,
   never a count, and never «доступна только подписчикам». The real
   closed-trade total is on the Statistics tab, where «hidden is not
   zero» is proven instead.
9. The profile's 7D range ends on **today**, and the newest closed trade
   in the ledger is today's — exactly one per strategy per UTC day. On the
   first visit after 00:00 UTC it may end on yesterday for as long as the
   day's append takes; a refresh a minute later must show today.
10. In each profile, press 7 д., 30 д., 90 д. and Всё время: ROI, P&L
    мастера, P&L подписчиков and «Всего сделок» change with every press, and
    every label in «Эффективность» is Russian except ROI, P&L and USDT.

If 2, 3 or 4 fails while 6 and 7 show a healthy response, the payload is
being refused by the client: capture the response body and run it through
`validStrategy` before changing anything.

**A deploy is not verified until all ten have been done by hand.** "CI is
green" is not a substitute, and has been wrong about this page before.

---

## Cross-module rule

Futures, Wallet, Earn, the header and unrelated UI work must **not** change
Copy Trading runtime files. In practice that means:

- `frontend/src/lib/copyMarketplace*.ts`, `useCopyMarketplace.ts`,
  `kseniaCopyTrading.ts`, `syntheticCopyTrading.ts`,
  `frontend/src/pages/CopyTradingPage.tsx`,
  `frontend/src/pages/copy-trading-bolt/**`,
  `src/api/routes/copyPerformance.ts` and `src/services/copyTrading/**`.

A pull request declared as Futures-only that touches any of these needs an
explicit sentence in its description saying why. This is a review rule on
purpose rather than a blocking check: shared files like
`frontend/src/lib/api.ts` legitimately change for reasons that have nothing
to do with this page, and a guard that blocks those would be worked around
within a week. What is NOT optional is that the workflow runs — that part is
machine-enforced by `copyTradingCiCoverage.test.ts`.
