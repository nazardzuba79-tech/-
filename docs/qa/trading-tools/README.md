# Trading Tools review and deposit minimum 500

Review only. No merge, deployment, production database access, financial writes or customer-account testing was performed.

## Revision and scope

- Original owner-specified starting point: `1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4`.
- Fresh base used for this review: `8abcde87e039030a6bed57732153603a49bf561f` (`main`, including release #363).
- Implementation head: `668cdde6b53e0d1c023953cc94c040d6016881bb`. The final documentation-only head is recorded in the PR description and completion report; `git rev-parse HEAD` identifies any downloaded checkout exactly.
- Branch: `codex/trading-tools-20261001`.
- The newer main's Arbitrage navigation, Assistant and withdrawal work are preserved. In particular, Arbitrage stays inside the Trading menu.
- Owner's explicit follow-up changes the deposit minimum from $300 to **$500 and its cryptocurrency equivalent**. That policy change is included in this one PR; it is independent of the calculator models.

Open `/tools` through the existing authenticated shell. The navigation entry is **Инструменты**. `?calc=` accepts only `pnl`, `size`, `liquidation`, `risk-reward`, `dca`, `fees`; it never contains financial inputs.

Local fixture preview:

```sh
npm ci
npm ci --prefix frontend
npm run build --prefix frontend
node scripts/serve-trading-tools-review.cjs
```

Then open `http://127.0.0.1:4274/tools`. The server is loopback-only and serves the real built UI, a synthetic session profile, and local static files. Other business reads are denied and mutations return 405. It does not proxy production. Browser QA additionally blocks all external requests. `/__qa/module` exercises the isolated calculator under React StrictMode.

## Files and boundaries

| Files | Purpose |
| --- | --- |
| `frontend/src/pages/TradingToolsPage.tsx`, `App.tsx`, `components/Nav.tsx` | One lazy authenticated route, one existing-header entry, existing Footer and session-change reset. The tools route does not mount the market ticker. |
| `frontend/src/pages/trading-tools/*` | Six working forms, local drafts, SVG, copy/reset/example actions, keyboard controls and scoped graphite/gold styling based on the supplied archive. |
| `TradingToolsShell.css` | Narrow route-presence selector puts the **same existing** support launcher after the footer in normal flow. It otherwise covered a mobile form control. The support dialog and every other route are unchanged; its fixed positioning returns on route departure. This is the only deliberate style outside the calculator subtree. |
| `math/*` and `math/__tests__/*` | Pure decimal calculations, validation, owner reference file, independent Python Decimal oracle, golden/boundary/invariant tests. No backend import or transport. |
| `frontend/package.json`, `frontend/package-lock.json` | Direct `bignumber.js` 9.x dependency; isolated clone, no global decimal configuration changes. No chart package or framework added. |
| `src/config/limits.ts`, `frontend/src/lib/depositMinimum.ts` | Canonical server/client minimum changed to 500. Existing quote freshness and valuation rules retained. |
| `adminUserActivity.ts`, `AdminDepositsPage.tsx` | Admin fallbacks use the same client constant instead of a stale literal 300. |
| Deposit policy/API comments and deposit unit/browser fixtures | Boundary, equivalent-crypto, aggregation, credit idempotency, error and responsive regression checks. |
| `supportForm.test.ts` | Existing Assistant minimum-deposit answer now expects $500. Runtime Assistant already reads the canonical constant; no Assistant logic was changed. |
| `scripts/qa-trading-tools.cjs`, `scripts/serve-trading-tools-review.cjs`, `docs/qa/trading-tools/*` | Local-only reproducible browser harness and measured review evidence. |

All calculator copy is Russian with an explicit Russian fallback, as allowed by the specification. No new locale schema keys, global header styles or trading-engine changes. Other languages retain their existing shared-shell translations. No asset picker is added: quantities are manually entered base-asset units, so there is no implicit asset conversion.

## Arithmetic and units

Prices are USDT per base-asset unit; quantity is in base-asset units; notional, cost, fees, margin, risk and funding are in USDT. A rate entered as `0.05` means **0.05%**, not 5%. Positive funding cost is paid and negative funding cost is received. Fixed expenses are nonnegative. Display grouping/rounding never feeds back into the calculation.

Inputs remain decimal strings. Limits: 30 integer digits, 24 fractional digits, 96 raw characters. A decimal comma or point and valid thousands spaces are accepted; mixed separators, exponent notation, Infinity/NaN, malformed or oversized values are refused. Blank/intermediate input has no fabricated result. Division uses a local 160-decimal-place BigNumber clone. Coordinates are normalized and bounded before conversion to SVG numbers; financial values are never converted to binary floats. Mathematical recurring decimals are necessarily finite approximations, with exact rational comparisons where equality determines DCA feasibility.

- **P&L:** adverse entry/exit slippage changes execution prices. Gross result is signed quantity times the execution-price difference; entry/exit fees, net funding and fixed expenses yield net P&L. Futures ROI divides by initial margin, `quantity × entry execution / leverage`. Spot ROI divides by purchase notional **plus entry fee**. Spot always buys then sells; its result does not use hidden Short/leverage/funding state. Separate Futures drafts are restored when returning.
- **Position size:** risk budget is capital times risk percent. Per-unit stop loss includes adverse execution prices and entry/stop fees. Fixed expenses are reserved once. Risk- and optional cash-budget limits are both applied, then quantity is rounded **down** to an optional lot step. Cash budget reserves margin, entry fee, stop-exit fee and fixed expenses. A budget too small produces a no-size state, never a positive fabricated order.
- **Liquidation estimate:** fixed maintenance margin on entry notional, isolated linear USDT only. With direction `d` (+1 long, -1 short), `N=Q×E`, `M=N/L+A-C`, `MM=N×m`, the displayed threshold is `E-d×(M-MM)/Q`. Zero-margin threshold is `E-d×M/Q`. `M<=MM` is already insufficient margin. A nonpositive long threshold is not displayed as an executable price. At `A=C=0`, this reduces to the existing `previewLiquidationPrice` isolated formula in `frontend/src/lib/futuresMath.ts` on base `8abcde87`; regression tests compare both directions. It is not a real-account liquidation promise: no tier maintenance deduction, changing mark price, cross-account collateral, liquidation/closing-fee buffer, inverse contracts or portfolio margin is modeled.
- **Risk/reward:** stop and target net P&L include independent adverse slippage, entry/exit fees and fixed costs. Risk is the loss magnitude; reward is net target profit. A nonpositive reward has no attractive ratio or break-even win-rate. Otherwise ratio is shown as `1 : reward/risk`, and break-even win rate is `risk/(risk+reward)`.
- **DCA:** purchase-only, at most 50 rows. A row accepts quantity or pre-fee purchase amount; fees are paid in quote currency, not deducted from acquired base quantity. Weighted average excluding fees and cost-basis average including fees are distinct. Optional exit includes its fee. Optional target-average purchase distinguishes achieved, unreachable, no finite quantity and non-reduction states. It never recommends buying.
- **Fees:** maker/taker rates and funding are manually entered. Quantity mode derives entry/exit notional separately. Notional mode accepts both independently. Funding is a constant notional/rate/period scenario with long/short sign, not a funding forecast. Spot excludes funding. No VIP tier or live tariff is inferred.

All market prices, costs, rates, slippage and contract settings are manual. Sample values appear only after **Заполнить пример**. Clearing/resetting restores empty inputs. Cross, inverse and CFD lot calculations are absent because their required account/contract specifications are not available locally.

The supplied JSON is preserved at `frontend/src/pages/trading-tools/math/__tests__/owner-reference.json`; its SHA-256 matches the owner's input: `9c3c36b2fc536ef5c61f520d33c242c14802d4b25a1f0e02e35f07041539e116`.

## Deposit policy addendum

The server gate, client forms, admin remaining-amount fallbacks and existing Assistant answer now use 500. Exactly 500 is eligible; 300 and 499.999999 are not. For supported non-USD assets, the existing fresh quote determines the equivalent (for example, BTC at 100,000 USD requires 0.005 BTC). Missing/stale quotes remain unavailable; the change adds no polling. Existing aggregation, confirmation, ledger and duplicate-credit protection are unchanged. Tests do not credit an owner/customer account.

## Executed validation

Environment: Windows, Node `24.21.0`, Jest 29, Chromium `151.0.7922.34`; Python Decimal is the independent oracle. Browser reads are fixtures only. Deposit integration uses a disposable **local** PostgreSQL instance and local TRON fixture. The Prisma client was generated in task-private dependencies for the fresh schema, leaving parallel checkouts untouched.

| Check | Result |
| --- | --- |
| Backend TypeScript build | PASS |
| Frontend TypeScript + production Vite build | PASS; existing shared-chunk size warning remains |
| Pure math unit/golden/invariant tests | 160 PASS |
| Rendered result regressions | 8 PASS |
| Header/lazy-route/session integration unit tests | 9 PASS; combined final tools selection: 177 / 177 |
| Owner reference checked independently in Python | 42 / 42 PASS |
| Final backend deposit service/API tests | 26 / 26 PASS |
| Complete existing deposit CI unit selection | 248 / 248 PASS, 19 suites; includes provider/auth/admin/wallet regressions |
| Full frontend on Windows | 3,285 PASS, 9 FAIL / 3,294 tests, 183 suites; see baseline explanation below |
| Local PostgreSQL deposit integration | 23 scenario groups + 7 viewport flows PASS |
| Header + Wallet deposit UI | 303 checks PASS, 7 viewports per entry point, no console errors/external requests |
| Isolated calculator browser actions | 21 measured groups PASS, including offline, DCA 50 rows, invalid/tiny/large/negative inputs and clipboard races |
| Integrated browser actions | 8 groups PASS, including Back, disclosures, session reset, reload, route departure and support docking |
| Responsive integrated screenshots | 320, 360, 390, 430, 768, 1366, 1440, 1920 px; zero horizontal overflow |

Commands (the browser runner needs local Playwright + Chromium; deposit runners need local PostgreSQL/pg and jsQR):

```sh
npm run build
npm run build --prefix frontend
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath frontend/src/pages/trading-tools/math/__tests__/math.test.ts frontend/src/pages/trading-tools/__tests__/presentation.test.ts frontend/src/lib/__tests__/tradingToolsShell.test.ts
python frontend/src/pages/trading-tools/math/__tests__/oracle.py
node node_modules/jest/bin/jest.js --runInBand --testPathPattern="DepositService|adminDeposits"
node node_modules/jest/bin/jest.js --runInBand --silent --testPathPattern=frontend/src
node scripts/qa-trading-tools.cjs
node scripts/qa-deposit-packages.cjs --browser
# With a local Vite fixture started using VITE_MANUAL_DEPOSIT_CATALOGUE=true:
# QA_ORIGIN=http://127.0.0.1:4275 QA_OUT=output/deposit-ui-500
node scripts/qa-deposit-ui.cjs
```

The deposit UI runner uses `QA_ORIGIN` and `QA_OUT` environment variables (set them with `$env:` in PowerShell); its configured browser dependencies can be supplied through `QA_PLAYWRIGHT_MODULE`, `QA_JSQR_MODULE`, and `QA_PNGJS_MODULE`. Full executed commands and actual fixture URLs are recorded in [deposit-minimum.json](deposit-minimum.json). The deposit unit selection emitted an existing React border/borderColor warning; no test failed. The database run deliberately injected an audit-write failure to prove atomic rollback and also emitted an existing pg concurrency deprecation warning.

**Windows baseline:** all 9 failures are path-separator/source-audit failures in 6 unchanged suites. The same nine named failures reproduce on an untouched archive of `8abcde87` (64 pass / 9 fail in those suites). [windows-baseline.json](windows-baseline.json) preserves exact names and errors. These assertions were not skipped or weakened. The final Linux frontend CI status must be read from the PR; a failing local complete suite is not labeled green. The final new-math/route tests were rerun after the full Windows suite snapshot.

Confirmed regressions addressed during verification: conservative position-budget division at extreme leverage/fees, DCA recurring-decimal equality, zero-cost chart bars, near-entry liquidation display precision, colliding entry/break-even SVG captions, stale clipboard completion after edits, and the support launcher covering a mobile selector.

## Network and bundle evidence

See [network.json](network.json) and [network-module.json](network-module.json), measured from executed browser probes. Fetch, XHR, WebSocket, EventSource and beacon attempts are observed even when offline/blocked. No calculator API route, timer, polling, socket or animation loop is added.

| Action | Calculator requests | Shared shell requests | Additional static reads |
| --- | ---: | ---: | ---: |
| Each of six modes: edit/example/copy/disclosure/reset | 0 | 0 | 0 |
| Each of six modes offline | 0 | absent in isolated fixture | 0 |
| DCA 50 rows / invalid, large, tiny inputs / Spot ↔ Futures | 0 | absent in isolated fixture | 0 |
| Module visible and hidden, 12 hours advanced clock each | 0 | absent in isolated fixture | 0 |
| Integrated 12 hours advanced clock and wake | 0 | 1 existing `/me` revalidation | 0 |
| Open/close existing Assistant | 0 | 0 in cached-profile fixture | 2 existing lazy support resources |

Initial isolated render loads 10 local static resources including fonts. The primary integrated scenario has 5 existing `/api/v1/me` reads across initial load, wake, synthetic account change, re-entry and reload. Each independent viewport context additionally reads its synthetic session; consult `serverReads` for the complete harness count. Route departure to `/legal/terms` separately records that page's existing profile/ticker attempts; these are not calculator traffic. Global shell Google Fonts attempts are blocked by fixture CSP and listed separately from served assets. Existing shell activity timers remain visible in the integrated trace; the isolated calculator schedules none. This is not a claim that the whole exchange is network-free or offline-ready.

[bundle.json](bundle.json) compares production assets against untouched fresh main. The main entry grows by **372 bytes raw / 100 bytes gzip** (617,085 → 617,457 raw). The lazy tools JS is **77,315 bytes raw / 26,512 gzip**; its CSS is **24,661 bytes raw / 4,510 gzip**, including reused local font declarations. The other existing `index-*` chunk stays 35,807 raw / 10,156 gzip. BigNumber belongs to the lazy route; no tools prefetch was added to shared startup. No millisecond performance claim is made.

## Visual evidence and limitations

- Desktop: [P&L](pnl-1440.jpg), [position size](size-1440.jpg), [liquidation](liquidation-1440.jpg), [risk/reward](risk-reward-1440.jpg), [DCA](dca-1440.jpg), [fees](fees-1440.jpg).
- Mobile: corresponding `*-390.jpg`; [invalid input](invalid-390.jpg), [large values](large-numbers-390.jpg), [320 px viewport](width-320.jpg), [390 px viewport](width-390.jpg).
- Every responsive width has a viewport image. Full-page images also include the unchanged global header, footer and bottom navigation.
- Unverified: physical mobile keyboards, Safari/Firefox, actual 12-hour wall-clock operation, production APIs/accounts, and every backend suite unrelated to deposits. Clock advancement tests do not pretend to be real 12-hour soak tests. A 3-second real module idle and 60-second real deposit UI idle were also measured.
- Liquidation and funding remain the explicitly bounded manual scenario models above. No account-aware financial advice, price forecast or execution guarantee is presented.

## Rollback

To remove only Trading Tools, remove its lazy import/route and single Nav item, `TradingToolsPage.tsx`, `pages/trading-tools/`, dedicated shell test, preview/QA scripts and this evidence folder. Remove the direct frontend BigNumber dependency only if no later feature uses it. The route-scoped support selector then disappears automatically. Preserve newer Arbitrage/Assistant/withdrawal work and the independent **500 deposit policy** unless the owner separately requests its reversal. Do not revert the entire release or unrelated main commits.

## Reference basis

Arithmetic follows the owner's MD and immutable JSON, checked against Python Decimal and the current VOLTEX isolated preview. No provider's current tariffs are copied. The owner-supplied primary references explain model boundaries: [Bybit linear P&L](https://www.bybit.com/en/help-center/article/Profit-Loss-calculations-USDT-Contract), [liquidation modes](https://www.bybit.com/en/help-center/article/UTA-Trading-Rules-Liquidation-Process), [stop execution versus liquidation](https://www.bybit.com/en/help-center/article/FAQ-Order-Execution-and-Liquidation), [CME position risk](https://www.cmegroup.com/education/courses/trade-and-risk-management/the-2-percent-rule), and [BigNumber documentation](https://mikemcl.github.io/bignumber.js/). These are model references, not live financial data or fee sources; the used BigNumber API was checked against the installed 9.x package.
