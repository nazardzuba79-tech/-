# Futures unrealized P&L / ROI presentation review

Base: fresh `origin/main` `ee33c9733edfa18b6fe3b269373ea92deb48e537`
(includes merged #308 and #309). Branch: `codex/futures-pnl-roi-presentation`.

## Presentation only

The unchanged native adapter passes engine `unrealizedPnl` and `roiPercent`
through as terminal `unrealizedPnl` and `roe`. The table supplies those exact
strings and the position's existing quote asset to `FuturesUnrealizedPnl`.
There is no second financial calculation and no new financial input or request.

The amount and actual asset are explicit text on line one; signed ROI is explicit
text in parentheses on line two. Existing `cardSignedAmount` / `cardSignedPercent`
formatters retain grouped decimal output; existing adaptive `cardPrice` retains
sub-cent P&L precision. Positive is profit green, negative loss red, zero/unknown
neutral. Unknown/nonfinite values use the established dash, not fabricated zero.
The Russian header stays `Нереализованный P&L (ROI)` even at narrow widths.

Desktop retains the existing row height and internal horizontal table scrolling
with pinned contract/actions. Mobile retains the existing card layout but gives
this cell a complete row so a large amount and ROI remain readable. No new icon,
tooltip, border or card was introduced; the existing result-card button remains.

## Verification

- 174 unit/presentation/native frontend regression tests passed (7 suites).
- 167 historical-current-price/parser/native integration/chart preservation tests
  passed (5 suites), including the #308/#309 regressions.
- Existing full native browser QA: 43/43 checks passed, no browser errors.
  Covers position creation/increase/reduction/close, reload/restart, chart entry,
  existing P&L card and protection/close controls on synthetic local accounts.
- New P&L browser matrix: 42/42 checks passed, no browser errors. Six values at
  1920, 1440, 1280, 1024, 390 and 320px: huge profit, ordinary profit, loss, zero,
  tiny profit and extreme ROI. Actual DOM text, line order, sign/tone, cell bounds,
  clipping, overlap and page overflow are checked. Screenshots inspected.
- Backend TypeScript, frontend TypeScript and standard production frontend build
  passed. Existing Vite >500 kB warning remains. The existing browser harness's
  instrumented build additionally warns about its Tailwind content configuration;
  the normal production build does not emit that warning.
- Both presentation tests and the new browser mode are wired into existing CI.
  CI has not run on this local branch because it has not been pushed.

All browser accounts/data are synthetic and local. Nothing contacted production
financial endpoints. Backend source/schema, adapter, chart marker, execution,
historical trading, freshness, realized P&L, wallet, margin, leverage, liquidation,
funding, Spot, CFD and Copy Trading are unchanged.

## Exact changed files

- `frontend/src/components/FuturesPositionsPanel.tsx`
- `frontend/src/components/FuturesUnrealizedPnl.tsx` (new)
- `frontend/src/components/FuturesUnrealizedPnl.css` (new)
- `frontend/src/components/FuturesPositionParity.css`
- `frontend/src/lib/i18n/locales/ru.ts`
- `frontend/src/lib/__tests__/futuresUnrealizedPnl.test.ts` (new)
- `frontend/src/lib/__tests__/futuresReferenceRow.test.ts`
- `scripts/qa-native-demo-browser.cjs`
- `.github/workflows/native-demo-qa.yml`
- `docs/FUTURES_UNREALIZED_PNL_REVIEW.md` (this report)
- `docs/AI_HANDOFF.md`

Local evidence is kept outside Git at
`C:/Users/nazar/.codex/visualizations/2026/09/28/futures-pnl-review/`:
`native-browser-report.json`, `pnl-roi/report.json`, and
`pnl-roi/positions-{1920,1440,1280,1024,390,320}.png`.
Screenshots use explicitly synthetic layout payloads, not real account values.

No push, merge, deployment or production change. Await owner visual review.


## 2026-09-29 current-main release review

Synchronized PR head `1ff2716b` with fresh main
`5285e9b24aa4752439f1c184820a02f4b131d801`. The only merge conflict was
concurrent handoff entries; both were preserved. No runtime reconciliation was
needed, and the Russian locale fingerprint passes with main's deposit additions.

On this synchronized tree: seven focused Jest suites / 200 tests passed; backend
TypeScript build, frontend TypeScript and standard Vite build passed; browser
script syntax and whitespace checks passed. The existing large-chunk warning
remains. These results are distinct from the original branch's browser evidence
above. The local browser matrix was not rerun because Chromium is absent from
this workspace. The final-head CI browser matrix must pass before promotion.
This synchronization is local only; no push, remote merge or deployment was
performed by this review.
