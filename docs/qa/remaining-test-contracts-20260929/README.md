# Current-source test contract repairs — 2026-09-29

Base: release main `c237649ccd93e74c68013c861ab9cbd38af56726`.
This commit changes nine frontend test suites and one test helper. It changes
no application, CSS, dependency, endpoint, finance or provider-fallback code.

The supplied baseline frontend run contained **14 failures and 91 passes in
these nine suites** (105 cases). The focused repaired run contains **109
passes, zero failures and zero skipped cases**. Four additional assertions
cover syntax parsing, pure-data rendering boundaries and current Card entry
points. `verification.json` records the selected baseline/final cases and
source identities.

## Findings and corrections

| Suite | Baseline problem | Preserved contract after correction |
|---|---|---|
| `cryptoCardProductionPromotion` | Old whole-App/Home/Copy hashes and source-restoration anchors predated released route splitting, terminal navigation, homepage data and Copy changes. One Card section already gained translated balance-yield copy. A whitespace-sensitive route assertion rejected the same authenticated JSX. | 31 unchanged Card source hashes, 18 unchanged collateral hashes, all 20 asset hashes and the 196-entry translation digest remain unchanged. Card auth/CTA/API ownership is explicit; the existing currency section's rates, seven locale bindings and currency assets are checked without accepting a new whole-file hash. |
| `sharedHeaderStylesheetOwnership` | The scanner assumed exactly seven reset files and a fixed 64px header; the current eager header uses its 68px token, and approved terminal sheets have explicit scoped overrides. | All resets still undergo the offending-declaration test. Required known reset files prevent vacuous success. Eager structural rules, exact audited override selectors and the shared burger ownership remain covered. |
| `orderBookCalmMotion` | A substring slice searched for a return opening tag with `className` first. A new `data-sampled-book` attribute made its end index `-1`, so the unrelated ratio strip's width was classified as a depth-bar width. | The actual `rows` initializer is parsed by TypeScript syntax. Row keys, exact prices/quantities, per-side scales, transform-only bars and no depth animation remain asserted. |
| `supportForm` | A full-source recipient scan found the known owner email in `DeleteUserDialog`'s owner-deletion refusal. | The exact identity guard is the sole exception. SMTP settings, mail secrets, recipient configuration and any extra email occurrence remain scanned across all frontend code, including Admin. All mounted support behavior tests remain. |
| `registerWalletTailwindOwnership` | Regex extraction treated the `isSelected` condition of a nested className ternary as a Tailwind utility. | TypeScript JSX parsing collects literal class branches only, including nested templates and conditionals. A parser fixture covers every branch and excludes condition identifiers. The generated CSS check still requires every actual utility. |
| `marketUniverseScale` | An obsolete rule prohibited the already-released direct public-data fallbacks; FuturesPage now uses the shared visible reader and an `executable` variable. | Exact file/host allowlist: public futures reference/candles use `api.bybit.com` and `api.bytick.com`; public Spot candles use `api.kraken.com`. A host elsewhere still fails. These adapters cannot carry account credentials. Dynamic discovery, execution whitelist, five-minute visible reads, list windowing and no per-row fetch remain. |
| `homepageTailwindUtilities` | A one-line `lazy(() => import(...))` regex did not recognize CopyTradingPage's block-bodied lazy loader with prefetch. | The AST requires a React.lazy initializer containing the expected dynamic import. Eager Home and lazy other routes, stylesheet ownership and generated utility coverage remain. |
| `plainLanguage` | Customer-copy scanning treated Admin Listings model identifiers and operational/deletion wording as customer product labels. | The existing seven customer locale scans and customer source scan remain. `/pages/admin/` is excluded because its operator UI must name simulation/deployment/deletion scope accurately. |
| `noProviderBranding` | Executable data contracts, public provider URLs, a TradingView instrument ID and Admin provenance were classified as customer branding. | Only the named pure-data modules and pure TradingView symbol mapper are excluded, with a no-rendering-API check. Other component lines and all dictionaries remain scanned; public catalogue provenance must still stay out of rendered cells. |

## Card scope and source locks

No new Card source digest was accepted. The unchanged application state,
product/copy data, composition modules and masters keep their previous
digests. The historical broad lock is narrowed only for these 17 files whose
independent features already changed on the release baseline:

- `App.tsx`, `Nav.tsx`.
- Home `HomeHeader`, `HomeHero`, `HomeMarketOverview`, `HomeMarkets`,
  `HomePage`, `TerminalPreview`, `useHomeMarket`.
- `CopyTradingPage`, Copy `components`, `CopyTradingBolt.css`,
  `CopyTradingRefinement.css`, `traders`.
- `syntheticCopyTrading.ts`, `kseniaCopyTrading.ts`, `tailwind.config.js`.

They are not replaced with new arbitrary hashes. Card-specific route,
navigation, application API and homepage CTA invariants remain in this suite.
The repository's dedicated Home, Copy, canonical performance, eligibility,
source-provenance and terminal suites own those features. The existing
`HomeCardSection` framing normalization stays exact, along with its old hash.

The CurrencySection assertions cover presentation already present in main:
the `cardBalanceYieldCopy[lang]` binding, 12% USDT / 9% EUR labels, seven
translations and existing currency geometry/assets. This change introduces
no accrual engine, financial term or account operation.

## Validation actually performed

- Reviewed the baseline JSON results for these exact nine suites: 105 cases,
  14 failed, 91 passed, zero skipped.
- Ran all nine repaired suites: **109/109 pass**, no skipped assertions.
- Built a fresh local Vite production bundle so all six build-dependent CSS
  assertions executed rather than silently skipping. The build passed with
  the existing large-chunk warning.
- `git diff --check` passed. Runtime source is unchanged from the baseline.
- No browser, production, database or remote action was performed for this
  test-only change. This is a local scoped result; final integrated CI is a
  separate release check.

Reproduction command:

```sh
cd frontend && node node_modules/vite/bin/vite.js build && cd ..
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath \
  frontend/src/lib/__tests__/cryptoCardProductionPromotion.test.ts \
  frontend/src/lib/__tests__/sharedHeaderStylesheetOwnership.test.ts \
  frontend/src/lib/__tests__/orderBookCalmMotion.test.ts \
  frontend/src/lib/__tests__/supportForm.test.ts \
  frontend/src/lib/__tests__/registerWalletTailwindOwnership.test.ts \
  frontend/src/lib/__tests__/marketUniverseScale.test.ts \
  frontend/src/lib/__tests__/homepageTailwindUtilities.test.ts \
  frontend/src/lib/__tests__/plainLanguage.test.ts \
  frontend/src/lib/__tests__/noProviderBranding.test.ts
```
