# VOLTEX CFD market-data rollout — 2026-09-13

## Final architecture for the no-company / no-paid-provider phase

VOLTEX now has two strictly separated quote planes.

### 1. Public display plane — implemented and tested

The homepage and public CFD ticker path may use credential-free market data without giving that data any financial authority.

Priority order per symbol:
1. Fresh admitted financial quote if one already exists.
2. BiQuote public/no-auth quote (`XAUUSD`, `XAGUSD`, `XPTUSD`, `XPDUSD`, `USOIL`, `UKOIL`, and seven FX pairs).
3. Deriv public/no-auth stream where Deriv actually lists the symbol (11/13; WTI/Brent are explicit gaps).
4. Official/indicative fallback: ECB daily FX, EIA daily WTI/Brent and Gold API metal references.
5. Honest null / labelled last-known history. No invented price, zero, spread, book, percentage change or WTI/Brent substitution.

`CfdDisplayQuoteRouter` deliberately does **not** implement `CfdQuoteSource`. This is a structural boundary: it can be injected into public `GET /cfd/tickers`, but it cannot be used as the price source for position opening, closing, PnL, margin or liquidation.

Every unauthorised public-display row is forced to:
- `displayOnly=true`
- `executionAllowed=false`
- `entitlementVerified=false`

The browser independently blocks order submission for `displayOnly` rows. Server-side money operations repeat stricter quote checks and never trust that browser gate.

BiQuote polling is server-side, batched for all 13 symbols, single-flight and cached. Fifty concurrent callers coalesce to one upstream batch in deterministic tests. Deriv is one process-level public WebSocket stream; it is not opened per user.

### 2. Financial execution/risk plane — fail-closed

`CfdPositionService`, financial position marks and `CfdLiquidationEngine` receive only `cfdRiskSource`.

The multi-provider financial router supports provider failover, divergence quarantine, freshness checks, lineage independence and failback hysteresis, but a provider is invisible to financial routing unless explicit non-secret admission evidence is configured. Free/public technical availability is not treated as commercial/execution permission.

Without an admitted financial quote, financial operations fail closed. This is intentional. The public display plane can keep the interface informative without silently turning an unverified internet quote into an executable CFD oracle.

## Real public evidence

### BiQuote

A real credential-free probe in GitHub Actions returned all 13 canonical VOLTEX instruments. Exact public symbol mappings include:
- `WTIUSD -> USOIL`
- `XBRUSD -> UKOIL`

The observed feed identified its source as `MetaTrader 5 (Broker 1)`. This establishes technical availability only, not commercial/execution rights or an exact upstream-contract licence.

### Deriv

The current unauthenticated Deriv Options WebSocket discovery maps 11/13 canonical instruments: seven FX pairs plus XAU/XAG/XPT/XPD. WTI and Brent are absent from this public endpoint and are recorded as explicit gaps rather than invented aliases. The current endpoint rejects `ticks_history`; the live adapter therefore uses actual `active_symbols` discovery plus subscribed ticks, while streaming parsing/reconnect/freshness is covered by deterministic tests.

### Official/indicative references

- ECB: daily reference FX. Six USD pairs are explicit calculated cross rates, not transaction prices.
- U.S. EIA: distinct daily WTI Cushing and Brent Europe spot benchmarks, USD/barrel.
- Gold API: indicative metal observations. Exact commercial/execution rights and exact unit equivalence remain unadmitted.

## Real deployed staging evidence

An isolated free Render service `voltex-cfd-free-display-staging` is live in Frankfurt from this PR branch. It has no database, accounts, balances or financial endpoints.

The deployed smoke verified:
- health identity is the isolated free-display review service;
- exactly 13 CFD rows are returned;
- every row has `displayOnly=true`, `executionAllowed=false`, `entitlementVerified=false`;
- WTI remains `USOIL` and Brent remains `UKOIL`;
- the financial positions endpoint returns HTTP 405;
- diagnostics report `executionAllowed=false`.

The smoke was run while the underlying markets were closed, so the observed prices were correctly labelled `market_closed` / stale rather than falsely presented as fresh live execution prices.

## CI gates

The implementation has passed:
- backend TypeScript production build;
- frontend production build;
- deterministic reference/router tests;
- CFD/homepage regression suites;
- isolated browser rollout validation;
- public official-reference probe;
- public Deriv discovery probe;
- public BiQuote 13-symbol probe;
- deployed free-display staging smoke.

No production DB, balance, order or position mutation was used for these checks.

## Rollback / controls

`CFD_FREE_DISPLAY_ENABLED=false` disables the public live-display plane. Financial execution is controlled separately by `CFD_MULTI_PROVIDER_EXECUTION_ENABLED` and provider admission evidence.

The public display plane solves the practical UI problem — one API outage should not blank the homepage/CFD list — without weakening the financial safety boundary.

## Remaining external limitation

There is no claim that VOLTEX has two licensed commercial execution oracles for all 13 exact CFD contracts. In the current no-company/no-provider-agreement phase, financial execution remains deliberately fail-closed wherever admitted financial data is unavailable. This limitation cannot be converted into safe code by pretending public technical access is a redistribution/execution licence.
