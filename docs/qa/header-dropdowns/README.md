# Shared header dropdown review — PR #399

Review only. No merge or production deployment. Owner must see and approve the design before publication.

Baseline: `8df5df693046ac0690a3882481dcd8b0c6259285` on existing PR #399.
Fresh main: `7d9ee6fc6bfe76badaac680313e9728e5abd3550`.

## Presentation

- `Crypto-Card` navigation label in all seven existing locales; product copy outside navigation is preserved.
- One typed HeaderDropdown item contract (`to`, `label`, `icon`, `description`), shared by authenticated Nav and HomeHeader, desktop and mobile.
- Nine distinct bundled Lucide SVG icons, 34px icon tiles, 14px semibold titles, 11.5px muted descriptions, whole-card hover/focus and reduced-motion support. No emoji or external images in these menus.
- Existing routes, direct section links, keyboard/touch disclosure, Escape and focus return retained. Trading/OTC now use the same renderer as Markets/Academy.
- The existing full drawer covers 1440–1530px instead of silently hiding Crypto-Card/OTC without an alternative. Small HomeHeader padding/gaps keep the mobile close button inside the viewport.
- Existing PR ticker spacing, Futures compact-header spacing and mobile stacking/dock-clearance fixes remain intact. No changes to backend, API, trading, data or subscriptions.

## Evidence

`comparison.html` shows before/after screenshots for all four menus at **1920 / 1600 / 1440 / 1366 / 390**. Baseline 1440px OTC is explicitly recorded as unavailable; screenshots were not forced open or fabricated. The after build exposes it through the full drawer.

`before-report.json`: 20 baseline cases. `after-report.json`: 20 Futures cases. `after-home-report.json`: 20 actual signed-out HomeHeader cases (the fixture must use `--signed-out`, otherwise root redirects to Futures). All use the real built bundle and loopback-only fixture data. No production tokens, accounts, orders or data.

Browser checks assert exact destinations, SVG counts, computed tile/type sizes, description content, Crypto-Card label, pointer hit testing, viewport bounds and no page overflow. External network is denied, fixture financial writes are denied. Existing `qa-futures-proportions.cjs` also covers all five widths, ticker gaps, chart/settings/order-panel interactions, loading/error/populated fixtures, mobile layering and Wallet/Futures/Spot SPA navigation. The navigation test opens the existing drawer when a desktop link is unavailable; no checks are bypassed.

## Validation

- Frontend TypeScript and production Vite build PASS (existing >500kB chunk warning).
- 96 focused header/locale/shell tests in 7 suites PASS, including 13 new mounted dropdown cases and the eager-style ownership guard. Existing React SSR `fetchPriority` warning remains in the home-hero test.
- The Card copy guard preserves its existing product digest; only the approved navigation label is normalized. Its unrelated binary asset assertion encounters the existing Windows CRLF checkout hash mismatch on `apple-pay-mark.svg`; no asset or digest was changed to hide it. Exact-head Linux full frontend CI remains the final gate.
- Full existing 5-width fixture preservation run: 0 violations. New Futures and Home menu matrices: 20 cases each, no JS errors, external requests or financial writes.
- Current exact-head CI is reported on the PR, not substituted by earlier PR results.

### CI responsive-navigation follow-up

The first pushed head passed the full frontend suite, but two older browser harnesses assumed desktop links were visible at 1440px. They were updated to exercise the actual full drawer, not bypass it with a direct URL. Pair-persistence now also runs at 1600px to retain every desktop clipping/slack check, measures shared disclosure wrappers, and hit-tests every product destination in the 1440px drawer including OTC/Arbitrage. Copy/Card round-trip still checks all confirmed cached values, and now clicks visible drawer links in both directions instead of hidden desktop duplicates. No product code or financial assertions changed in this follow-up. The local pair suite passed all three widths; it separately records its pre-existing chart-disposal teardown diagnostic.

The downstream failed-prefetch browser scenarios use the same visible-link approach. Hidden-link hover/click errors are no longer swallowed, and the cold-prefetch scenarios explicitly require a request before asserting recovery. All existing cached-value, privacy, token, balance and failure checks remain. The full Linux frontend gate passed 201 suites / 3,524 tests with none skipped on `25914867`; final exact-head results, including the corrected complete Copy browser chain, are recorded on the PR.

Reproduce after `npm ci`, `npm ci --prefix frontend`, and `npm run build --prefix frontend`:

```powershell
$env:QA_PLAYWRIGHT_MODULE = '<local Playwright package>'
$env:PLAYWRIGHT_BROWSERS_PATH = '<local browser cache>'
node scripts/qa-header-dropdowns.cjs --phase after
node scripts/qa-header-dropdowns.cjs --phase after --home --port 4399
node scripts/qa-futures-proportions.cjs --phase after --widths 1920,1600,1440,1366,390 --ticker-gap-min 20 --port 4397 --out output/header-spacing-preservation
node scripts/qa-futures-proportions.cjs --serve --out docs/qa/header-dropdowns --port 4401
```

Open `/__qa/evidence/comparison.html` on that loopback server. This is a preview, not a publication on the exchange. Capture `--phase before --dist <baseline-dist>` before rebuilding to reproduce the baseline.
