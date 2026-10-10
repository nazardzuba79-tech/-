# Safe frontend integration — review only

**NO MERGE. NO PRODUCTION DEPLOY. Publication is blocked pending owner approval and substantiation of the card fee promotion.**

Started from freshly fetched main `e7c6fea3532ea78ff1e3d8287dc592ba2b82641a`, which already includes Desktop Futures PR #494 (`cb3065badf2e8d1177494dd0a98cc0454d5573ed`). Only these three PRs were merged into the new integration branch; their source branches were not modified:

| PR | Exact integrated head | Scope |
|---|---|---|
| #490 | `db8f5f21a5b3bb0b8e6a60f590956d7043ebb73b` | Existing two-line auth card promotion |
| #491 | `1b3ae760de1df746604a1d108a8745836aa0d0e8` | Card label in seven languages; CreditCard icons |
| #495 | `246c00639ed6ac1f2b7fb5180c658055f5195322` | Claude mobile audit including final round-three fixes |

## Reconciliation and preservation

- Reviewed the combined HomeHeader and all seven dictionaries after normal three-way merges. No `ours`/`theirs` selection or replacement of shared files was used.
- HomeHeader retains both CreditCard icons from #491, the localized Trading Bots labels from #495, and Claude's compact phone logo rule. `/card` remains unchanged; `nav.card` is exactly `Card` in ru/en/zh/es/hi/ja/ko.
- The existing auth wording, artwork, form behavior, fees configuration and card conditions are retained. Only #490's approved promotional copy changes.
- Both Desktop Futures stylesheets from #494 are byte-identical to main: 40px header, 48px instrument bar, 160px empty / 200px populated / 44px collapsed account panel, 286px book and 300px ticket.
- Every non-shared frontend file from #495 is byte-identical to its final head. No Stocks #497, admin, financial, API, backend, database, package or infrastructure changes are added.

## Protected wallet UI remains unchanged

The latest #495 follow-up scopes withdrawal-address error wrapping to phone CSS and a wrapper class, leaving the shared `wallet-v3/ui.tsx` unchanged. Integration retains that final implementation. The original `walletUxRefinement.test.ts` is byte-identical to main: its existing whole-file hash guard stays intact, with no exception, changed hash, skip or waiver. No address validation, confirmation, financial calculation or submission behavior changes.

## Fee claim: publication blocker

The auth banner's “0% fees on purchases and cash withdrawals” is **owner-provided promotional wording, not an independently verified tariff**. Existing `/card` copy says VOLTEX charges no own commission while a bank, ATM operator or payment network may charge separately. That existing caveat and all fee/application logic remain unchanged.

No issuer agreement, effective tariff schedule, applicable region/card programme or independent evidence establishing this broad promotional statement was identified in this integration. An existing marketing string or passing test is not substantiation. **Before publication, the owner must provide/confirm the applicable tariff and the scope of the claim, including third-party ATM charges.** If the broad wording is not supported, obtain approval for qualified wording before release. This Draft PR is not clearance to publish the claim. The report and local review gallery explicitly carry this blocker; no endorsement or independently verified fee assertion is added.

## Browser review

All browser checks use the real production frontend build over a loopback-only, synthetic fixture. External origins are denied; no real credentials, balances, orders or production writes are used.

- Final integration matrix PASS: **392 route/language/width cases and 98 Card navigation transitions**, zero failures, page errors or horizontal document overflow; all 49 existing Wallet snapshot POST attempts blocked before forwarding. Coverage: home, login, register, Spot, Futures, CFD, Wallet, Card; ru/en/zh/es/hi/ja/ko; 320/360/390/430/1366/1440/1920px. Card label/icon and navigation are checked from home and Futures menus. The existing auth gate is explicitly preserved: guests reach `/login?next=%2Fcard`, signed-in fixture users reach `/card` and its rendered hero.
- Existing mobile audit: 311 executed states at the requested seven widths, plus 60 explicitly inapplicable desktop/mobile states. Includes tabs, dialogs, filled tables, 200% text and simulated keyboard states. No failed steps, page-level JavaScript errors, horizontal document overflow or unknown fixture endpoints; no writes reached the fixture. Blocked remote CDN asset errors are expected in this offline fixture and are not production availability measurements.
- Auth visual/behavior suite: 38 cases and 12 responsive cases across seven languages; rejection/retry, 2FA and registration validity checked against explicit offline responses. No unexpected errors or writes.
- Dedicated #494 geometry suite: four desktop widths, empty/populated/collapsed states, table scrolling and order-type controls. Eight read-only native quote/execution-session POSTs remain inside its synthetic fixture; no order execution is submitted.
- The integration harness records Wallet's existing automatic `/wallet/portfolio-snapshot` POST attempts and answers each with 405 **inside the browser before forwarding**. These blocked requests are reported, not counted as zero attempts. Any other write attempt fails that harness, and no write reaches its fixture or production. Application behavior is not modified to make the test pass.

### Existing visual limitations, not waived

The automatic text-box audit flags fixed bottom navigation covering scrolling content, intentionally clipped ticker/chart content, and dense desktop account-table labels. A real overlap between the realized-PnL and TP/SL headings in a populated 1440px Futures table was reproduced against both **unchanged main** and the integration with the same fixture. Their geometry is identical; see `desktop-preservation.json` and the two comparison screenshots. This integration preserves #494 as instructed and does not redesign that table. Do not describe all visual signals as clean or new defects as fixed. A separate focused follow-up is advisable before release if that populated-table case is a release requirement.

Real iOS devices, system keyboards and live third-party resources are not exercised by these isolated Chromium checks.

## Screenshots from this integration build

All account values below are synthetic fixtures, not customer information.

| Surface | Desktop | Mobile |
|---|---|---|
| Home Card navigation | [1920](screenshots/nav-ru-1920-home.png) | [390](screenshots/nav-ru-390-home.png) |
| Futures | [1440](screenshots/ru-1440-futures.png) | [390](screenshots/ru-390-futures.png), [Card menu](screenshots/nav-ru-390-futures.png) |
| Spot / CFD | [Spot 1366](screenshots/ru-1366-trade.png) | [CFD 430](screenshots/ru-430-cfd.png) |
| Wallet / Card | — | [Wallet 320](screenshots/ru-320-wallet.png), [Card 390](screenshots/ru-390-card.png) |
| Authentication | [Login 1440](screenshots/ru-1440-login.png) | [Register 390](screenshots/ru-390-register.png) |

[Main populated Futures 1440](screenshots/futures-populated-main-1440.png) · [Integration populated Futures 1440](screenshots/futures-populated-integration-1440.png)

## Final Wallet follow-up

The final #495 head was rebuilt and retested: 71 Wallet browser states passed (six inapplicable desktop/mobile states skipped). Invalid withdrawal-address errors fit at 320/360/390/430px after actual 200% computed text scaling, with zero document overflow. See `wallet-error-wrap.json` and `screenshots/wallet-error-200-320.png`. Shared wallet UI and its original hash test remain unchanged.

## Reproduction

```powershell
npm.cmd run build --prefix frontend
node node_modules/jest/bin/jest.js frontend/src --runInBand
# Compile unchanged backend modules only for the in-memory fixture; no server deployment or DB.
node node_modules/typescript/bin/tsc
node scripts/qa-frontend-safe-integration.cjs
node scripts/qa-mobile-client-audit.cjs --only home,login,register,spot,futures,cfd,wallet,card --widths 320x568,360x800,390x844,430x932,1366x768,1440x900,1920x1080
node scripts/qa-auth-business-class.cjs
node scripts/qa-futures-figma-desktop.cjs
```

Set `QA_PLAYWRIGHT_MODULE` to the installed Playwright module if it is outside node_modules; `QA_OUT` controls the integration/auth output directory. Full exact-head CI status is recorded in the Draft PR after completion, independently of these local results.
