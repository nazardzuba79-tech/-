# Remaining work: integrated verification, 2026-09-29

## Outcome and source identity

This completion integrates the compatible work from historical PRs **#303,
#311 and #331** onto current release main, repairs the full frontend regression
gate, and preserves the newer VTA chart stability change from #343.

- Reviewed main: `9742375b96aff614b690042e13111c1df1178ec5`.
- Frozen combined application source tested here:
  `ea17fdc7413b4f41004693fd30088f962a2f1127`.
- Idle implementation: `e479bfc3498b39ed263b1a9bdcf7ceb162511951`, followed by
  `2698a3e81cf91ec20c472df50d02dbfa8293b380`.
- The machine-readable record pins all **90 changed runtime files**, their
  Git blobs and SHA-256 values. Its combined runtime fingerprint is
  `bd8bb93b8adfc68b668aaa2a5abe260aa05c2e340da8f50727b543bf55983bcc`.
- Later evidence, harness and CI-only commits must preserve those runtime
  bytes. The release owner verifies the final published Git tree separately.

This is a record of completed local validation. Exact remote CI, merge and
deployment results are recorded in the replacement PR and release report;
they are not implied by a local build.

## What is completed

### Browser idle lifecycle — #303

An inactive tab sleeps after five minutes, and a hidden/page-hidden tab
suspends its display work immediately. Market/account display readers,
display intervals and owned provider connections share that lifecycle.

Returning validates the existing session, waits for current-session reads
and their response processing, requests fresh account state, and only then
enables user actions. A waking click or held key cannot become an order.
Unfinished Spot trigger drags are canceled when the tab sleeps; an already
submitted command retains its existing execution and idempotency rules.

The integration additionally fixes cases found during independent review:
pre-sleep GET completion, obsolete-account failures, delayed native
activation, recovered provider fallback, and an open Deposit destination
whose old response arrived after sleep. The existing Deposit minimum,
selection rules and financial authority remain in their current owners.

Expected optional native-engine absence is classified only by its exact
HTTP status and decoded code. Other errors still block wake. A later
optional absence preserves a previously confirmed Cross wallet transcript;
changing account still resets it.

There is one deliberate idle exception: a visible, connected, actually
focused iframe inside the owned TradingView container stays active because
the parent document cannot observe input inside that frame. Leaving the
frame starts the usual deadline; hidden state overrides the exception.
When that external iframe is actually removed, its internal drawings and
settings are not guaranteed to survive. The owned VOLTEX chart and unsent
order draft remain mounted according to their existing lifecycle.

### Isolated mobile review — #311

The compatible PWA and Telegram review clients use their separate entry,
build and local server. The integration preserves strict loopback launch,
the transport lock, static-only service-worker cache, disabled financial
submission and explicit fixture/account-unavailable labels. Historical
workflow bypasses from the old PR were not imported.

The review handles browser and Telegram activity together, keeps a typed
draft through pause/resume, uses the current yellow-L brand, provides the
BackButton path, validates safe-area values and renders painted charts at
320/360/390/430 pixels. Launch and boot failures now use controlled messages
instead of echoing caught exception details.

**This completes an integrated local review, not a public mobile launch.**
The remaining public-launch work is explicit in
[MOBILE_CLIENTS_REVIEW.md](../../MOBILE_CLIENTS_REVIEW.md): an isolated HTTPS
origin/release configuration, the intended Telegram bot, server-side
existing-account confirmation and durable replay/link protection, existing
account/execution providers on disposable staging, and real-device checks.
The pure Telegram verifier is not mounted as an authentication route.

### Listings completion — #331

The old PR's 51 files, including 25 runtime files, are mapped in
[the Listings review](../remaining-listings-20260929/README.md). Current main
already provides the compatible Admin creation, preview, publication,
discovery, logo, chart/book/tape and owner-allocation paths. The older
independent Worker, display-only policy and full-document navigation are
not replacements for the current released architecture.

The useful missing safeguard is retained in the existing CLI allocation
helper: a replayed receipt must agree on action, owner, listing, asset and
exact positive decimal quantity. A mismatch fails before writes. Valid
current receipts remain compatible with equivalent decimal formatting or
display-only metadata changes. This does not enable an allocation endpoint
or execute a production allocation.

### Wallet and regression repairs

The overview was reconstructing the BTC price from margin equity even
though its BTC equivalent came from economic wallet equity. The two differ
when collateral preferences exclude an asset. The correction uses the same
economic equity and validates the fallback quote; USD totals and financial
actions retain their existing source. The discriminating example and
old-runtime failure are recorded in
[the account report](../remaining-account-presentation-20260929/README.md).

The initial untouched-main run had **108 failing tests**, with 2,680 passing
and zero skipped. The repairs update obsolete transport, cadence, source
parser, fixture visibility and presentation contracts while retaining the
relevant account, money, canonical identity and ownership assertions. The
new full-frontend workflow builds first, runs every selected frontend suite,
and rejects failed, pending or todo results. No baseline-failure waiver or
`forceExit` is used. The actual candle-stream expiry path now cleans up its
test timer, so the complete process exits naturally.

## Verification actually completed

| Check | Result and boundary |
|---|---|
| Full integrated frontend Jest | **2,847 passed / 166 suites; 0 failed, pending or todo; 0 open handles; natural exit 0**. `--detectOpenHandles` enabled. Duration 121.964 seconds. |
| Normal frontend | TypeScript and Vite build pass on the frozen combined source. |
| Backend | TypeScript build passes on the same source. |
| Allocation receipt unit suite | **14/14 pass**; no production or local database used. |
| Independent idle source review | Core lifecycle **29/29**, eight selected core regressions **8/8**, and optional-probe/Cross preservation **11/11**. These are separately selected review scopes, not an assertion that all other tests ran in those invocations. |
| Idle browser matrix | **16/16 scenarios pass** on the exact idle runtime plus #343, with local fixtures and virtual time. Sleeping/hidden HTTP and provider-stream traffic stop; wake validates once and submits no order. |
| Native browser restart | **11/11 checks pass** on desktop/mobile local fixtures, including persisted native state, draft retention, external close, session failure/retry and focused-frame boundaries. The browser fixture uses a persisted file repository. |
| Integrated mobile regression | **198/198 tests in eight suites pass** on the frozen combined source. |
| Integrated mobile browser | **9/9 scenario groups; 8/8 painted-chart/usable-height combinations; 0 API requests, external requests or page errors**. Local Chromium emulation, not physical-device installation or a real Telegram login. |

The real PostgreSQL checks remain required **remote CI gates**: the new
Windows idle job runs isolated PostgreSQL persistence tests, while Admin
Listings runs all 14 receipt cases against disposable PostgreSQL 16. These
are separate from the file-backed native browser restart. No local
PostgreSQL result is claimed.

## Evidence

- [verification.json](verification.json): exact source, changed-runtime
  hashes, result counts and command boundaries.
- [final-full.json.gz](final-full.json.gz): complete successful Jest result,
  with all assertions and no skip waiver.
- [baseline.json](baseline.json) and
  [baseline-full.json.gz](baseline-full.json.gz): the original failure
  inventory on unmodified main `c237649`.
- Compressed build/receipt logs are kept beside this report.
- [Final idle browser report](../remaining-browser-idle-20260929/report.md)
  and [integrated mobile report](../mobile-review-integrated-20260929/README.md)
  contain the raw scenario results and inspected captures.
- [Release CI map](../remaining-support-ci-20260929/README.md) records the
  required PostgreSQL/browser jobs and the corrected Support bundle scan.
- The account, contract, Listings, mobile and browser lane reports record
  their own earlier source identities; those histories are not relabelled
  as the final combined run.

No Worker runtime or imported Worker helper changes in this completion.
The Support workflow correction is different: changing its existing
workflow file triggers its existing main-push verify/deploy path, which
can reissue the unchanged Support Worker. The release owner verifies that
normal pipeline separately from the frontend and Render release.

## Initial remote CI and narrow follow-ups

[ci-first-attempt.json](ci-first-attempt.json) preserves all 34 completed
workflows on published head `b343c355` / merge `6424c347`, exact tree
`89edcb0c`: 28 passed and six failed. This is a historical result, not a
claim that the release gates had all passed.

The six follow-ups change QA or CI only. Application and Worker source files
remain byte-identical to the frozen application source above.

| Gate | Concrete correction |
|---|---|
| Support | Keep five mail/token markers and the unchanged exact owner-identity source guard; remove the duplicate bundle false positive. Full local browser passed. |
| Spot idle | Supply current public response contracts and await completed authoritative wake plus exactly one session read before the explicit cancellation. Both widths passed. |
| App recovery | Parse the actual complete Vite hash alphabet and reject missing or equal entry names. Existing ten-group browser recovery checks and negative controls passed. |
| Admin activity | Keep a real active tab active through its hourly poll; separately require no reads during sleep and retained data/global error on failed wake. |
| VTA session switch | Assert new-account default state, empty draft and correct token, then deliberately select the new account views; await the old held 401. No financial assertion removed. |
| CFD browser | Bounded readiness through real uncached loopback quote/OHLC routes, three attempts, strict actual data validation and failure diagnostics. All original UI/cache/order checks remain; helper tests 13/13 passed. |

All six code follow-ups received independent source review. VTA's corrected
full PostgreSQL/browser execution and CFD's corrected real-provider browser
execution remain mandatory in the replacement-head CI; local syntax or
helper tests are not substitutes. Exact final CI and deployment results are
recorded in [PR #345](https://github.com/nazardzuba79-tech/-/pull/345).


## Concurrent main reconciliation after the follow-ups

PR #344 merged into main as 9d8a537 on 2026-09-29 at 18:11:56 UTC, three
seconds after the documentation head was published. The resulting conflict
prevented that head's PR workflows from starting. The combined source was
reconciled in e2c9d91, preserving both the approved Deposit minimum/Wallet
presentation update and all idle behavior, notices and economic-equity fixes.

[main344-integration.json](main344-integration.json) records the exact source
and every application-file delta from the preceding candidate. The earlier
frozen-runtime and test records above remain historical evidence for their
stated source; fresh combined verification is required after this merge.
Final exact-head CI and release outcomes are recorded in PR #345.
