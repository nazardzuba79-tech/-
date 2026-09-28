# VTA standard Spot completion — owner review only

Base: 87199526082a0d24e0623516b7dde5df8af9005b (fresh main, PR #315). No merge, deployment, production write, reallocation, or owner production sale was performed.

## Reproduced defects

- Native collateral treated DemoBalance VTA as external VTAUSDT: disposable PostgreSQL baseline requested ETHUSDT and VTAUSDT and failed. The corrected native path excludes test assets before external marks/valuation and refuses enabling them as collateral. Ordinary collateral eligibility and missing-price refusal remain intact.
- The existing wallet copied the VTA row without simulation cash or valuation. Baseline lacked an authoritative account projection. A repeatable-read projection now supplies committed VTA, shared DemoBalance USDT, simulation mark, total and receipts to the existing views, separately from real funding.
- The original useRef-only sale intent disappeared on reload after a committed/lost response. Browser baseline reproduced unlocked fresh intent. The replacement stores only exact request identity/quantity per authenticated account and recovers by GET. Missing/failed lookup retains the original intent; it never creates a POST automatically.

## Owner correction: ordinary Spot UI

The same OrderForm and styles serve BTC and VTA. Initial BUY/LIMIT, BUY/SELL tabs, all five order families, their field switching, slider, percentage buttons, available balance and submit geometry remain ordinary Spot. No CSS or alternate form was introduced.

BUY attempts show the localized refusal; unsupported SELL order types show the localized order-type refusal. Every unsupported combination in the browser caused zero financial POSTs. All seven dictionaries contain both messages. Existing strict backend VTA SELL schema rejects injected side/type/price/userId; generic real Spot and demo engines still reject test-asset execution.

## Accounting and boundaries

Original owner instruction: 50000 / 0.011 = 4545454.54545454 VTA rounded down to eight decimals, with no USDT debit. Listing price remains separately 0.01. These observations are not hardcoded as an account balance and no allocation was repeated.

Sales preserve server clock, listing gate, current simulation execution price, exact decimal multiplication, existing zero-fee policy, atomic conditional VTA debit, DemoBalance USDT credit, receipt/trade/audit and idempotency. Listing configuration, seed, candles and price algorithm are unchanged. No synthetic public liquidity or real customer counterparty is created.

Simulation USDT retains the existing shared native/Unified cash policy. Tests use actual VtaDemoSales, NativeDemoService and PrismaNativeRepository over the same disposable PostgreSQL. Selling both before and after native initialization, native OPEN/CLOSE and repository restart retain proceeds exactly once. VTA itself is not Futures collateral. There is no VTA_PRIVATE_USDT migration or new transfer policy.

The existing wallet table renders an explicit selected account scope. Simulation rows/total never enter overview.real.spot, real totals or withdrawal availability. The existing real Funding view remains selectable. Missing projection/valuation is unavailable, not a zero account. Session change clears the old projection and account scope.

## Validation

| Area | Result | Evidence |
|---|---|---|
| PostgreSQL VTA, native coexistence, real Spot/demo engine and routes | PASS | 118 tests in 8 suites |
| Native historical/current execution, risk, sizing, lifecycle, reduce-only; Spot labels/book races; shared account/intent | PASS | 253 tests in 11 suites |
| Futures header/mobile guards | PASS | 42 tests in 3 suites |
| Localization integrity and public listing guards | PASS | 49 tests in 2 suites |
| Backend / frontend TypeScript / frontend build | PASS | Existing Vite >500 kB advisory retained |
| Standard UI parity | PASS | 1440 and 390 px, 10 BUY/SELL/order-family states each; styles, sizes and placement compared |
| Prelisting / unauthorized / unsupported execution | PASS | No financial POSTs from rejected UI; backend guards covered separately |
| Partial/full sale and reload | PASS | Exact receipt, remaining inventory, cash, standard history/assets/wallet |
| Lost response, 429, timeout | PASS | Original durable identity; one fill; reload recovery uses GET only |
| Logout/account switch in flight | PASS | Late 401 cannot clear new token or publish old account completion |
| Two tabs | PASS | One full remaining-balance fill; zero VTA dust/oversell; real funds unchanged |
| Shared reads | PASS | Multiple views share a single read; one invalidation; no idle polling |

462 unique targeted tests passed, zero remaining targeted failures. This is not a claim that the entire repository Jest suite was run.

Test maintenance: the Spot static-render harness needed its new intent dependency stub (four failures); the existing book callback harness lacked its current marketType/document/readSpotPublicBook dependencies (five failures, production TradePage unchanged). Updated only fixture bindings, preserving race assertions. The header's API fingerprint was advanced for the reviewed projection/recovery/late-401 changes; its other file guards remain pinned. No production behavior was changed to satisfy these tests.

Browser harness uses compiled production frontend, actual simulation read router and actual services with synthetic users and localhost PostgreSQL. Public ordinary-asset quotes are fixtures and external browser requests are blocked. Chart evidence is at one minute after synthetic listing, hence one candle. No production or external live-liquidity execution is claimed.

Control comparison measures each full input group (BTC/VTA suffix width is asset-specific), resets scroll offsets, and discounts only measured conditional hint text wrapping. Same styles, tabs, fields, percentage controls, balance position and CTA dimensions are checked. Clean initial BUY/LIMIT, SELL/MARKET and wallet screenshots are included at both widths.

## Exact synthetic outcome

Initial VTA: 4545454.54545454. Native initialized with 100000 simulation USDT before VTA allocation fixture. Three explicit partial sales of 100 VTA plus one full sale of 4545154.54545454 leave exactly 0 VTA and 46318.20909090903532724 residual simulation USDT at the server test price. Replays do not add receipts. Real USDT remains 50000; no withdrawals exist. See vta-browser.json for intermediate values and native reconciliation.

## Review limits

Production allocation and balances were not re-read or changed in this task. Browser recovery requires storage and Web Locks; failure refuses safely. Unresolved identities remain until an authoritative receipt or an explicit first-attempt definitive rejection, rather than guessing from a later HTTP error. No auto sale occurs on reload/reconnect.

Next step: review the PR. Merge/deploy are explicitly unauthorized.

## CI contract follow-up

Initial head e9c0bfc77cfb17246fbe216718effab0188d44ba passed the complete VTA PostgreSQL/browser workflow. Five wider workflows failed on the same locale fingerprint, and the public listing workflow also expected the old ref-only sale call/noValidate condition. The follow-up excludes only the two added refusal keys from the existing locale digests (all original dictionary bytes remain pinned), explicitly asserts RU wording and seven distinct translations, and checks the durable locked intent instead of the obsolete ref call. These 49 tests now pass locally. No runtime code or screenshots changed in this follow-up.

The next public-listing browser stage also contained obsolete disabled-BUY/submit assertions. It now verifies selectable BUY, explicit purchase/type/prelisting refusals and zero write requests at 1440/430/390/360/320 px. All five widths pass with zero page errors or horizontal overflow; see listing-browser.json. Runtime remains unchanged.
