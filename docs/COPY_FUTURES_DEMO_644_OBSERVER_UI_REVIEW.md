# Copy Futures observer — isolated review interface

Stacked on #649, not a production or automatic Futures copy release.

## Scope

The separate route `/copy-trading/futures-demo-observer` is compiled only if
`VITE_COPY_FUTURES_DEMO_OBSERVER_REVIEW=true`. The backend still requires ALL
its independent disposable-local-copy-demo test gates, including
`COPY_FUTURES_DEMO_OBSERVER_ENABLED=true`. Client flag alone enables nothing.

A logged-in tester may:
- inspect an existing OBSERVING/STOPPED subscription and its last source revision;
- choose a bound strategy and explicit leverage/notional observation caps;
- save or stop an observation-only server subscription;
- manually request a bounded read of new immutable Native Demo fill receipts;
- inspect the last 50 observed **source** fills.

There is no order action, auto-polling, leader PnL replication or exposure
management. The screen states in every supported language that copying is
OFF; source fills and source prices do not imply subscriber executions.

The UI does not use Wallet, does not create a second localStorage following
state, and does not infer ownership from a strategy's display name.
It keeps a monotonically changing request generation, ignores stale reads and
requires the authoritative response to explicitly say
`mode=OBSERVATION_ONLY` and `automaticCopying=false`. Failed writes and
reads clear the displayed state rather than claiming unconfirmed success.

## Validation

The `copy-futures-observer-ui.yml` workflow builds a separately flagged
frontend in GitHub CI. The Chromium fixture in
`scripts/qa-copy-futures-observer-browser.cjs` serves an offline fake
observation endpoint only. It checks 1440px and 390px render, manual scan,
independent device stop and reload, 7 languages and API outage. It rejects
non-observer API writes. It is *not* a PostgreSQL integration test; that is
owned by #649. Exact-head CI results must be confirmed before claiming PASS.

No merge/deploy/production flags, real balances, market orders, listers,
timers, KYC or server background work is authorized here.
