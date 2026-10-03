# Header labels and Futures statistics spacing

Review branch: `codex/header-ticker-spacing-20261003`.
Base: `7d9ee6fc6bfe76badaac680313e9728e5abd3550`.
Before screenshots were built from `f56ca46962a466cb41a6bb1b43507dd475cfffc8`; its frontend is byte-identical to the refreshed base. The intervening #393 only changes CFD tests, CI and documentation.

## Changes

- Shared desktop/mobile/home Card navigation now uses short localized labels (`Карта`, `Card`, and the equivalent in all seven existing languages). Product branding outside navigation is unchanged.
- Academy navigation uses the existing `nav.academy` translation (`Академия` in Russian). Its destination and all four dropdown entries are unchanged.
- Futures statistics distribute available horizontal space between their existing columns, with a20px minimum and1180px maximum group width on wide screens. Data, precision, order, pair selector and primary price are unchanged.
- The compact Futures header tier extends through1799px. This fixes the breakpoint that previously allowed the navigation to overlap account actions at1680/1707px.

No backend, API, database, accounting, order, provider, subscription or infrastructure changes. No merge or production deployment performed. Existing GitHub/Cloudflare automation may create a branch preview when pushed.

## Visual evidence

Open `comparison.html` via the loopback fixture server at `/__qa/evidence/comparison.html`.
It includes before/after full views, menu and ticker crops at2048/1920/1707/1664/1600/1440/1366/390.
The full machine reports also cover1728/1680/1550/1531.

Screenshots use the actual production build with identical synthetic local data, fixed time and deviceScaleFactor1. External requests and financial writes are blocked. Provider fonts are blocked equally in both builds; browser/local fallback fonts are used.

| Width | Ticker column gap before | After | Header content gap after |
|---|---|---|---|
| 2048 /1920 |20px|63.30px|20px|
| 1728 |20px|53.44px|16px|
| 1707 |20px|49.94px|16px|
| 1680 |20px|45.44px|16px|
| 1664 |20px|42.77px|16px|
| 1600 |20px|32.11px|13px|

Laptop two-row and mobile layouts retain their existing structure. Pair selector and primary-price rectangles are exactly equal before/after at every desktop width. All12 widths pass clipping, overlap, menu, field and layout guards. Zero JS errors and zero external requests.

Also checked: all visible header dropdowns, mobile workspaces, account loading/error/populated states, three fixture positions, margin/leverage controls, long quantity/price input, TP/SL, calculator, timeframe/drawing/settings and Wallet→Futures→Spot navigation. Chart canvas identity persists and passive requests remain0.

Spot below-header control:7/12 images are byte-identical. The other5 differ only in6 antialias pixels on the rounded pair-picker border, by at most2/255 per RGB channel; content and geometry are unchanged. Shared header label changes are intentional. Details: `comparison-metrics.json`.

## Validation

- Frontend TypeScript/Vite build:PASS. Existing >500kB bundle warning remains.
- Focused shared header, locale and product-copy tests:137/137 in7 suites.
- Full frontend Windows run:3503passed/6failed out of3509,194/200 suites. One failure was the ownership allowlist for the new scoped separator selector; its exact entry was added and that suite reran11/11PASS.
- Five remaining failures are existing Windows path-scanner behavior: `homepageTailwindUtilities`, `registerWalletTailwindOwnership`, `noProviderBranding`, `plainLanguage`, `marketUniverseScale`. All41 relevant tests/helpers/reported source/style files are byte-identical to both baseline commits. No new baseline execution is claimed; full error/stack evidence and equality checks are retained in the local output directory. Exact-head Linux CI is the final gate.
- Full fixture browser run:12 widths,0 violations; raw before/after reports retained here.
- Independent code review: no actionable findings. `git diff --check`:PASS.

Reproduce after a frontend build:

```powershell
$env:QA_PLAYWRIGHT_MODULE = '<local Playwright module path>'
node scripts/qa-futures-proportions.cjs --phase after --out output/header-ticker-spacing --widths 2048,1920,1728,1707,1680,1664,1600,1550,1531,1440,1366,390 --ticker-gap-min 20 --port 4396
node scripts/qa-futures-proportions.cjs --serve --out docs/qa/header-ticker-spacing --port 4395
```

The gap/stable-instrument comparison requires `before-report.json` in the selected output directory. Capture it from the untouched baseline using the same script with `--phase before --dist <baseline-dist> --quick` before checking the changed build.

Limits: synthetic fixtures only; no production auth/trades, physical device or seven-language visual matrix. Routes/localization are covered by focused tests. Unsupported Ukrainian locale was not introduced.
