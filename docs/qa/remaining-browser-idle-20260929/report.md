# Browser idle sleep — completed local review, 29 September 2026

## Result and source

The reconciled #303 implementation passes the **16-scenario browser matrix** and **11 native-engine browser checks**. Sleeping and hidden intervals generated zero measured HTTP requests, and instrumented provider WebSockets were closed. Each ordinary wake made exactly one session-validation request. The waking gesture did not submit or replay an order. The checked pages had no browser errors or horizontal overflow.

The source tested here is **2698a3e81cf91ec20c472df50d02dbfa8293b380**, following implementation **e479bfc3498b39ed263b1a9bdcf7ceb162511951**. The lane began on approved release main **c237649ccd93e74c68013c861ab9cbd38af56726** and includes fresh main **9742375b96aff614b690042e13111c1df1178ec5** through local merge **ccfe32850bd7ce4040d7793ff88e3f69a8c1c155**. That preserves #343's ticker identity and terminal geometry fixes. The historical #303 input was head `98a154a1482526ada31feb6bcf743acbdb6b35d7` against exact base `14120a82119a56b1604634cd17029ec17cd8aedb`; its whole branch and old evidence were not merged.

The final harness fixes and this evidence are in the commit containing this report. No application runtime changed after 2698a3e. `manifest.json` records the source trees, runtime and built-bundle fingerprints, browser version and artifact hashes. The actual build used Playwright 1.62.1 and the verified local headless Chromium wrapper, with `ru-RU` and UTC explicitly selected.

## What changed

Trusted parent-page input resets a five-minute deadline. A hidden tab or pagehide sleeps immediately. Display timers and provider connections stop; mounted screens keep their local intent and drafts. Returning first validates the session, then waits for current-session logical reads and their body/consumer processing before allowing another deliberate action. Failures keep the wake notice visible and require an explicit retry.

The older draft needed several safety corrections:

- A read begun before sleep cannot release the wake barrier before its current refresh finishes. Futures account and listing catalogue consumers supersede suspended snapshots; the barrier also covers queued follow-up reads and delayed native activation followed by its authoritative live snapshot.
- A previous account's pending promise or late failure cannot block or poison the new account's wake. The existing identity reset clears account-bound state.
- A long-held waking pointer or auto-repeating key cannot submit through its trailing activation. A conditional Spot trigger drag is cancelled on sleep, pair change or unmount. Already submitted mutations retain their ordinary completion path.
- Existing public-provider fallback is tracked as a complete logical read. An initial failed provider followed by a successful fallback can recover; an exhausted or malformed result still blocks wake.
- Optional private-engine probes recognize only the backend's exact expected outcomes: `403/private_access_denied`, and `409/initialize_demo` for an unopened native wallet. Access consumers still receive the denial and retain their existing owner/unknown policy. Native Wallet absence retains an already confirmed Cross transcript; a first absence can resolve the ordinary Wallet. Session failures, unexpected denials, network/5xx failures and mandatory native-state failures remain failures.
- An open Deposit destination is checked once after wake, with concurrent notifications coalesced. A suspended destination is discarded and remains unavailable until the current result settles. Asset/network intent, the existing address validation and the 300 USD presentation are retained; no new periodic address polling was added.
- Current NRX/managed-listing paths, home motion, funding and turnover clocks, alerts and the newer display clients use the same lifecycle.

The backend financial runtime, executable candle prices, NATURAL_V1 shadows, ten VTA impulse episodes, ordinary + Auto chart scale, Deposit addresses/catalogue configuration and Futures decimal rules were preserved. The only backend delta in this lane is a regression test.

## Browser matrix

Every scenario advances the actual production bundle through five visible idle minutes, thirty sleeping minutes, wake, thirty hidden minutes and return. The controllable clock affects the actual browser scheduling; HTTP still reaches the disposable loopback fixture. All external network access is blocked, with public edge fixtures rewritten to allowlisted loopback paths.

| Page / state | Widths | Scenarios |
| --- | --- | ---: |
| Admin Users | 1440 | 1 |
| Admin Deposits | 1440 | 1 |
| Wallet, ordinary native-engine absence | 1440 | 1 |
| Futures A: empty account | 1440 | 1 |
| Futures B: positions | 1440 | 1 |
| Futures C: resting orders | 1440, 320, 360, 390, 430 | 5 |
| Ordinary Spot | 1440 | 1 |
| VTA | 1440 | 1 |
| NRX | 1440 | 1 |
| Managed QAIDLE listing | 1440 | 1 |
| CFD Gold | 1440 | 1 |
| Markets | 1440 | 1 |
| **Total** | | **16** |

Measured totals and invariants from `browser-matrix.json`:

- **0** HTTP requests during all sixteen thirty-minute sleeping windows.
- **0** HTTP requests during all sixteen thirty-minute hidden windows.
- **0** active instrumented provider WebSockets during sleep; no stream messages sent during the sleeping windows.
- **1** `GET /api/v1/me` on each wake.
- **0** order/command/transfer POSTs replayed by the waking gesture.
- **0** page errors and **0** horizontal overflow cases.

The snapshot and account endpoints retain their individual roles. Two `/market/display` requests on a Futures wake belong to its distinct display consumers/transport policies; the report does not claim one request for every endpoint across unrelated consumers. Raw per-route counters are retained.

## Native engine, session and chart proof

The native runner uses the actual compiled native engine and its persisted, disposable review repository. It creates synthetic positions and resting orders, stops the local server during browser sleep, and restarts it against that repository. It uses no production account or database.

At **1440 and 390**, all four checks pass:

1. Thirty-minute sleep plus a cold server restart preserves balance, position ID, resting order ID and the unsent price/quantity draft. Clicking the sleeping order button wakes without placing a new order.
2. Restored displayed mark and unrealized P&L match the native authority.
3. A deliberately failed session refresh keeps the last confirmed balance and draft, with no retry traffic during the next thirty minutes. An explicit retry recovers.
4. A position closed through the separate fixture session stays closed on wake and after F5; the resting order remains present.

Three additional desktop checks prove the owned TradingView boundary using a fulfilled cross-origin iframe containing a real focusable textarea:

- The document's actual active element is an iframe inside `.voltex-tradingview-chart__owned`, and `document.hasFocus()` is true. The frame survives more than ten virtual minutes without parent input.
- Leaving the frame restores the normal deadline: active at 299,999 ms, sleeping at the next millisecond.
- Hidden state overrides focused-frame status, detaches the frame, and a validated wake mounts a fresh frame.

This is **11/11** native-browser checks, no page errors, and no native viewport overflow. `native-browser.json` records the checks and the observed focus state.

### Precise iframe limitation

Cross-origin frame input cannot be observed by parent input listeners. A visible, focused owned TradingView frame is therefore exempt while the document has focus. **An unattended but still-focused owned frame may stay active.** Arbitrary iframes and unfocused/hidden documents do not receive this exemption. Internal third-party chart state can be lost when the owned iframe is torn down; application drafts remain mounted. This report does not claim that every visible tab always sleeps after five minutes, or that third-party drawing settings survive teardown.

## Automated and independent checks

These are scoped runs with overlapping tests, not additive counts:

| Check | Result |
| --- | --- |
| Browser lifecycle and existing visible-read budget, Node | 43/43 |
| Reconciled mounted/source follow-up: countdown, banner, home motion, native hook, conditional Spot drags | 85/85 |
| Native/Deposit follow-up, including held activation and held destination reads | 44/44 |
| Optional private probes plus existing native/private/Wallet suites | 110/110 |
| Latest optional matrix and Cross-to-null preservation | 35/35 |
| Futures candles with `--detectOpenHandles` | 15/15, normal process exit |
| Independent safety review of 2698a3e, optional matrix and Cross preservation only | 11/11 |
| Backend TypeScript, frontend TypeScript and production build | PASS |

The lifecycle regressions cover five-minute/trusted-input behavior, hidden state, independent tabs, wake coalescing, old responses and body processing, session changes and revocation, dormant-read cancellation, submitted mutations completing without replay, provider fallback, held input, focused-frame ownership and failed-wake retry policy. The Futures candles test now advances its own fake time through the real idle-expiry unsubscribe; no `forceExit` or test waiver was introduced.

Root owns the final combined full-frontend gate and its exact release source. That separate gate remains required; this scoped report does not replace it. The earlier #303's full-suite failures were not excused by green old workflows.

## Fixture defects found and corrected

Actual browser runs exposed fixture mismatches; strict runtime rejection was preserved:

- The old Wallet fixture used `/native/wallet`; the current client uses `/private-trading/native/wallet`. The corrected ordinary fixture returns the real, decoded native-access denial.
- The old Futures normalized display fixture had an empty `rows` array and omitted `epoch`/`revision`. Actual parsers reported `Empty normalized futures snapshot` and `Invalid live frame`. The fixture now supplies validated linear-perpetual rows and current frame metadata.
- Native browser overrides supplied a Spot snapshot without `_display`/gateway sections and rankings as `{assets:[]}`. The current local server now provides valid public contracts, and those stale overrides were removed. The missing public icon endpoint returns `{assets:{}}`; account endpoints remain behind the preview's deny-all boundary.
- Local Chromium inherited `en-US@posix`, an invalid language tag for the chart's formatter. Explicit `ru-RU`/UTC matches an ordinary browser locale without changing application code.
- The mock embed's top-level `const` could not be injected twice. Its implementation is now scoped to an IIFE, so wake tests a normal fresh script/iframe mount.

The screenshots contain synthetic QA prices and deliberately simple fixture candles. They demonstrate retained UI/drafts and the sleep notice, **not** simulation-candle morphology or production market accuracy.

## Evidence and limits

`manifest.json`, `browser-matrix.json`, `native-browser.json` and their logs contain the machine evidence. `sleep-desktop.png`, `sleep-mobile.png` and `restored-mobile.png` were visually inspected; the final restored capture hides the fixture's own controls after F5.

Actual PostgreSQL was **not run locally** because no verified local runtime was available. The native restart proof above concerns the persisted review repository, not PostgreSQL durability. The committed Windows `Browser idle sleep` job runs the disposable PostgreSQL/native persistence gate; root also requires the separate Admin Listings PostgreSQL gate before merge. No runtime was installed and no production database was contacted.

This work performs no external GitHub write, merge or deployment. Root retains those release actions and must record final CI, merged-source and production verification separately.
