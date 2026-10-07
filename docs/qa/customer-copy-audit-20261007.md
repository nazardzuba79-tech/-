# Customer wording audit — 2026-10-07

Review-only change from fresh `main` `3e64ae89e4b328dfc3577e0539301c20ee07b31e`. No merge, deployment, publication, production account mutation or financial operation was performed.

## Confirmed defects and changes

| Trigger | Previous result | Correction |
| --- | --- | --- |
| Published test listing carrying a machine `status` | Raw status appeared in Markets/pre-listing; a ticker-specific AITH exception erased the parsed field | Preserve the API field and use one generic localized presentation helper; simulation, availability and schedule are separate facts |
| Clock reaches the scheduled time before the server confirms `live` | Countdown could imply trading had opened | Stop the countdown and state that confirmation is pending; server phase and existing trading guards remain authoritative |
| Unarmed listing or failed listing read | Unconfirmed date or absent content could be misleading | Show an unconfirmed date, explicit loading/failure, or stale-data message as appropriate |
| Unknown order/position type or status, malformed order tooltip fields | Internal enum, invalid date or raw numeric payload could appear in visible text/tooltips | Localized unknown-state fallback; known rejected, expired and liquidation states remain distinct; tooltips use existing safe decimal formatting |
| Generic 401/403, network or timeout failure | Generic fallback did not explain the next step | Extend existing `customerError.ts` with localized sign-in, refusal, network and uncertain-result timeout wording |
| Unrecognized server failure | Diagnostic log could contain arbitrary server message/code | Fixed diagnostic event and bounded HTTP status; no free-form payload or personal data; Futures unknown failures reuse this existing mapper |
| Error code equals an inherited object property | Lookup could treat a prototype member as a translation key | Require a string mapping before translation, with regression cases for `constructor`, `__proto__`, and `toString` |

New customer strings are present in ru/en/zh/es/hi/ja/ko. Existing business refusals and validation messages remain visible. Unknown/failing data is not represented as a successful operation or fabricated balance.

## Public catalogue, read only

Successful GETs to `/market/listings` and `/market/nrx` on `market.voltextech.net`, and `/api/v1/market/test-assets` on `api.voltextech.net`, identified:

| Listing | Initial price | Server phase | Trading flag |
| --- | --- | --- | --- |
| AITH/USDT, published version 2 | 2.00 USDT | pre-listing, 2026-10-11 15:00 UTC | false |
| NRX/USDT | 0.80 USDT | live | true |
| VTA/USDT | 0.01 USDT | live | false |

These responses were replayed as local fixtures. A synthetic `ZQNEW/USDT` fixture proves generic rendering without a ticker exception; it was never published. AITH version fencing/read leases, price, date and scenario remain intact. NRX/VTA schedules, candles, history, orders and balances are unchanged.

## Verification

- TypeScript project build: PASS.
- Vite production build: PASS; existing chunk-size warning remains.
- 15 Jest suites: **507 passed, 0 failed**. Includes listing/managed-publication fencing, presentation, shared errors, Futures errors/unknown account state, wallet, support, card eligibility presentation and Spot feedback.
- Browser pass 1: **191 inspections**, zero unmocked requests and no page exceptions. Listings/search/favorites/Spot at Russian widths 1920/1440/1366/430/390/360/320; other six languages at 1440/320. Each catalogue includes AITH, NRX, VTA and the unknown ticker. Login failures tested in all seven languages at 390: offline, 401, 403, 429, 500, 504, empty and unknown responses.
- Browser pass 2: **294 inspections**, zero unmocked requests and no page exceptions. Twenty route shells plus Support panel, seven languages, 1440/320. Includes home, login/register, Spot, Futures, CFD, wallet/deposit/withdraw/transfer URLs, Copy Trading, bots, Card, profile/security/KYC URLs, Academy/knowledge/FAQ/glossary. Forty Russian route checks repeat pass 1; these counts are inspections, not unique end-to-end workflows.
- Browser checks examine visible text, title/accessible labels, nonblank error states and page overflow. No horizontal document overflow was observed in these runs. Desktop/mobile listing screenshots were also inspected visually.
- Unit/SSR regressions cover disabled trading, loading versus failure, stale data, unarmed date and countdown crossing zero. Browser route smoke is deliberately narrower than completing a workflow.
- All browser HTTP responses came from fixtures or the local built bundle; WebSockets closed locally; production mutations were never forwarded. Account fixture data is synthetic. No real login, order, deposit, withdrawal, KYC upload or support message was submitted.

## Review artifacts

Representative screenshots are in `docs/qa/customer-copy-audit-20261007/`. Full local evidence remains in the task output directory: `customer-audit-tests.log`, `customer-copy-audit/browser-results.json`, `browser-routes-results.json`, `published-catalogue.json`, screenshots and `qa-customer-copy.cjs`.

## Scope and unverified areas

Static audit covered ordinary customer routes and their error/display sinks; existing safe consumers were left unchanged. Admin, private operator/scenario controls, development tools and machine APIs intentionally retain technical vocabulary where appropriate.

This is not a claim that every exchange workflow or every server error was exercised. Successful authenticated production flows, real provider outages, live wallet/KYC/Support writes, native/private operator controls and the complete mobile dialog state space remain unverified. Some pre-existing product labels outside the changed technical wording are not fully localized. No auth/security architecture, backend, database, dependency, financial calculation, listing publication or trading protection changed.
