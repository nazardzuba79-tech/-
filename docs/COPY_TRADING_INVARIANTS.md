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
| 1 | **Loading can never be eternal.** «Загрузка…» is allowed only while a real request is in flight. The moment an attempt ends — for any reason, including reasons that are not a response — the viewer is owed real figures, last-good figures flagged stale, or an honest «Данные недоступны». | `copyTradingCriticalPath.test.ts` → `noEternalLoading`, applied at every step of every case, with the clock held still. `scripts/qa-copy-never-loading.cjs` in a browser. |
| 2 | **The session state machine is complete**: cold load, late token, mid-flight session change, logout, another login, StrictMode double mount, route return, focus. | `copyTradingCriticalPath.test.ts` cases 5–13, `copyMarketplaceSettles.test.ts`, `copyFirstLoad.test.ts`. |
| 3 | **A failed prefetch never blocks a visit.** A success may be reused for 30s; a failure may not be reused at all. | Critical path case 7, `copyMarketplaceRetry.test.ts`, browser scenario 06. |
| 4 | **Last-good data survives a later failure.** Session-scoped, re-validated on read, cleared on logout. | Critical path cases 11 and 13, `copyMarketplaceCache.test.ts`, `qa-copy-last-good-browser.cjs`. |
| 5 | **The payload contract is two-sided.** The real route's bytes must pass the real client validator; the client cannot be loosened to accept a broken server, nor the server changed without the client following. | `copyMarketplaceEndpointContract.test.ts` (real router → real HTTP → real `validStrategy`). |
| 6 | **Ksenia's owner-reported weekly result is +61.9%**, provenance `OWNER_REPORTED`, and lives in exactly one file: `src/services/copyTrading/kseniaReportedWeek.ts`. A second hardcoded production copy fails the build. | Critical path case 4 (including a source scan for a second copy), `kseniaReportedWeek.test.ts`, `qa-copy-loading-and-ksenia.cjs`. |
| 7 | **Hidden trade history is a declaration, not an absence.** `trades: []` is legitimate only with a valid `tradeVisibility`; the real total, the aggregates and every financial figure still have to be there. | Critical path case 3, `tradeHistoryVisibility.test.ts`, `qa-copy-cards-trades-avatar.cjs` (scans the wire, not the DOM). |
| 8 | **Nothing is fabricated.** No fallback ROI, PnL, AUM or win rate; no demo trader standing in for Nazar or Ksenia; no `0` where the answer is unknown. Unknown reads `—`. | Critical path cases 1, 10 and 15; the browser harness fails a bare zero with no data behind it. |
| 9 | **Sections are independent.** Nazar, Ksenia and identities each fail alone. | Critical path case 14, `copyMarketplaceEndpointContract.test.ts`. |
| 10 | **The endpoint fits inside the client's own timeout.** | `copyMarketplaceEndpointContract.test.ts` time budget. |
| 11 | **Every section is logged, by name and outcome, with nothing identifying.** | `copyMarketplaceEndpointContract.test.ts` observability case. |
| 12 | **CI runs whenever something Copy Trading depends on changes.** | `copyTradingCiCoverage.test.ts` walks the real import graph and fails on any file missing from the workflow's `paths:`. |

---

## Measured, so nobody has to guess

Taken on this repository, cold process, in-memory scenario table:

| | Cold (first generation) | Warm (cached per UTC day) |
|---|---|---|
| Nazar `service.get` | ~2119 ms | ~0 ms |
| Ksenia `service.get` | ~1207 ms | ~0 ms |
| Post-processing (summarise + overlays + redact) | ~1.4 / ~7.8 ms | ~1.1 / ~5.4 ms |
| Payload on the wire | ~196 KB / ~194 KB | same |

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
3. **Ksenia's card settles** on the same terms, and her 7D figure reads
   **+61.9%**, labelled as the manager's reported result.
4. No card is still showing a skeleton past the client's fifteen-second
   timeout.
5. Browser console: no uncaught error, no `NaN` anywhere on the page.
6. Network tab: `GET /api/v1/copy-trading/marketplace` **completed** —
   status, and a body carrying both sections.
7. Server logs for that minute contain `copy_marketplace.nazar.*` and
   `copy_marketplace.ksenia.*`. Read them per the table above.
8. Open Nazar's profile and Ksenia's profile. Both paint. Trade history
   reads «Информация о сделках скрыта» with the real closed-trade count —
   never a table of executions and never «0 сделок».

If 2, 3 or 4 fails while 6 and 7 show a healthy response, the payload is
being refused by the client: capture the response body and run it through
`validStrategy` before changing anything.

**A deploy is not verified until all eight have been done by hand.** "CI is
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
