# Analytics implementation and QA

Starting main: `32f7bbe48eaa18ca731713a0095d87a315512ef8`

Branch: `codex/analytics-v0-refine`

Reference: the source, styles and rendered layout of `voltex-analytics-dashboard.zip`.

## Integration

`AnalyticsPage.tsx` keeps `useAdminGate`, its redirects, the existing `Nav`
(including the market ticker) and `Footer`. The route, authentication, other
pages and backend are unchanged. Every new style is scoped to `.vx-analytics`.

The default view reads the existing admin-only `/analytics/overview` endpoint.
Market overview, sentiment and VOLTEX-only funding, open interest and mark
prices are shown only when their sections are available. Unknown values are
not converted into zeros. Failures clear stale values and offer retry.

The liquidation provider is **not connected**. Default liquidation values are
unavailable. An explicit, non-persistent **Демонстрационный режим** checkbox
opens the approved design with visibly labeled synthetic reference data. It
does not activate a provider or turn sample observations into live data.

## Canonical liquidation module

- 220 BTC, 200 ETH, 180 SOL/XRP display buckets.
- Exact ±2%, ±4% (default), ±6%; GLOBAL is explicitly ±16%.
- 4h, 12h (reference default), 24h and 3d period-specific demo fixtures.
- Independent Binance, Bybit, OKX, Deribit and Bitget checkboxes; all and reset.
- One `buildLiquidityModel` result supplies the histogram, both cumulative
  curves, totals, shares, nearest walls/void, cluster table and concentration.
- Display zoom crops/rebins one fixed fine-grained source for that period;
  increasing the range preserves source volume. It never generates another
  random market for each zoom level.
- No selection gives zero selected demo volume and no invented walls/voids.
- Sparse corridors are low-density buckets, not decorative colored regions.
- Separate histogram/cumulative scales and per-bucket Long/Short tooltips.

Fixed reference defects: hardcoded 24h headline; unfiltered wall summaries;
single-exchange-only selector; mislabeled SOL/XRP ranges; volume loss on zoom;
zero-series classification; out-of-range empty tails described as corridors;
nearest-void distance measured to the peak instead of its boundary; fake
provider freshness; XRP price precision; mobile structure/summary readability.

Cascade weights are OI 25%, funding 20%, position imbalance 15%, liquidity
concentration 25%, volatility 15%. The score remains unavailable unless all
five inputs exist. Liquidation Long/Short shares are **not** used as a proxy
for open-position imbalance. Only demo liquidity concentration is currently
calculable; the other factors are honestly missing.

The supplemental demo market panels are a separately labeled static market
snapshot. Liquidation filters do not purport to filter ETF flows, sentiment
or other unrelated metrics. Nonfunctional time toggles in those reference
illustrations were replaced by fixed-period labels.

## Validation performed (2026-09-04)

- Frontend `tsc --noEmit -p frontend/tsconfig.json`: pass.
- Frontend `tsc -b`: pass.
- Production Vite build: pass, 1,988 modules; non-blocking >500 kB chunk warning.
- 3 relevant Jest suites, **35 tests passed**: new liquidity model tests and
  existing Analytics service/route tests. Coverage includes every asset and
  period, all four ranges, all 32 exchange subsets, cumulative/total equality,
  filtered wall/cluster derivation, source immutability, monotonic zoom volume,
  sparse corridors, empty input and cascade weights/missing inputs.
- `git diff --check`: pass.

Vite/esbuild initially hit sandbox `EPERM`; the actual production build passed
with approved process access. Existing backend tests initially needed the
Prisma client; generating it from the current schema resolved that prerequisite.
The route suite intentionally logs a simulated internal failure while testing
its sanitized error response.

## Browser QA

The actual application ran in local Vite with an **external, uncommitted QA
middleware** serving test API responses. Neither the application auth guards
nor production configuration were bypassed/edited. No production account,
balance, order, provider or deployment was used. The original archive was
also rendered separately for visual comparison.

| Viewport | Default view overflow | Populated demo overflow |
| --- | --- | --- |
| 1920 | None | None |
| 1440 | None | None |
| 1366 | None | None |
| 1024 | None | None |
| 768 | None | None |
| 390 | None | None |
| 375 | None | None |

At 768 and narrower, the dense BTC chart retains its 902px internal canvas.
Keyboard horizontal scrolling was exercised without scrolling the page
horizontally. The 390/375 wall summaries use two columns with a full-width
void row. Full desktop, histogram/wall/void, both mobile widths, timeframe
and exchange screenshots were captured and visually inspected.

Controls exercised: all 4 assets × 4 ranges; all 4 periods; each of 5 exchanges;
empty selection and restore-all; demo on/off; refresh and retry. Final BTC
±4% demo totals: 4h $70.4M, 12h $224.3M, 24h $472.7M, 3d $1.62B.
Final BTC 12h zoom totals: ±2% $118.4M, ±4% $224.3M, ±6% $335.4M,
GLOBAL $404.7M. Display rounding can make separately rounded Long/Short
figures differ slightly from the independently rounded total.

Normal Analytics interactions produced no browser runtime errors. Existing
React Router future-flag warnings remain. The deliberate API-failure scenario
produced expected HTTP 503 messages and the correct unavailable/retry state.
All-unavailable responses showed dashes rather than sample numbers. Signed-out
visits redirected to `/login?next=%2Fanalytics`; a non-admin was redirected
through `/` to the existing default `/futures` route. The destination terminal
is outside this fixture's API coverage and was not validated by that test.

Screenshot artifacts are local at
`C:/Users/nazar/-/.analytics-tools/screenshots/`:
`desktop-full.png`, `desktop-map.png`, `mobile-375-top.png`,
`mobile-375-map.png`, `mobile-390-map.png`, `timeframe-3d.png`,
`exchange-bitget.png`. Full desktop is composed from measured viewport
captures to avoid the browser's full-page stitching artifacts; fixed support
buttons repeat between capture sections.

## Files changed

- `frontend/src/pages/AnalyticsPage.tsx`
- `frontend/src/pages/analytics/AnalyticsWorkspace.tsx`
- `frontend/src/pages/analytics/LiquidationIntelligence.tsx`
- `frontend/src/pages/analytics/LiquidityChart.tsx`
- `frontend/src/pages/analytics/liquidityModel.ts`
- `frontend/src/pages/analytics/useAnalyticsSnapshot.ts`
- `frontend/src/pages/analytics/DemoMarketPanels.tsx`
- `frontend/src/pages/analytics/analytics.css`
- `frontend/src/pages/analytics/refinements.css`
- `frontend/src/pages/analytics/__tests__/liquidityModel.test.ts`
- `frontend/src/pages/analytics/README.md`
- `docs/AI_HANDOFF.md` (required repository handoff)

## Remaining limitations

No live liquidation/event feed, historical cross-venue risk inputs, or ETF/
whale-flow provider was added. The demo is an illustrative deterministic
model, not historical liquidation observations. Sample exchange-side splits
retain the reference bucket proportions; a future real-data adapter must
provide actual exchange-side observations. Supplemental demo charts are
illustrations, not provider-derived time series. New Analytics copy follows
the Russian reference; the shared navigation retains its existing languages.
End-to-end provider connectivity was not tested against a real backend.

No merge, push, Render action or production deployment was performed.
