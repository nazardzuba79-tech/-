# Public CFD references — phase 2, 2026-09-13

This supersedes the phase-1 statement that no runtime module imports any new feed. The original exact-contract ReferenceQuoteRouter remains separately tested and unconnected to money operations. PublicReferenceFeed and PublicReferenceDisplay now integrate only with public GET /cfd/tickers and operator diagnostics. They are a labelled supplementary benchmark lane, NOT an admission to executable CFD prices and NOT double-live coverage.

## Actual wiring

The existing Twelve Data source retains its identity, quota owner and financial consumers. A fresh primary reference wins. Otherwise a usable supplementary reference can be displayed with its own provider, contract, unit, observation date, basis and expiry. Its public last/bid/ask/mid are null, price is display-only, executionAllowed and entitlementVerified are false, and no primary 24-hour change carries across. Open/close/PnL/liquidation never read this supplementary collector. With no observation the price stays null; genuine zero and negative references are retained.

The terminal hook keeps and displays source metadata. The execution UI independently denies displayOnly rows. OIL on the homepage now reads WTIUSD, not a hardcoded null and not XBRUSD. Supplemental/daily observations do not create a fake intraday sparkline or percentage change. Existing icons and layout are retained.

## Sources and rights checked from official pages

- Gold API: https://gold-api.com/llms.txt and https://gold-api.com/terms (effective 2026-09-10). Public no-key metal endpoints; commercial web/mobile use stated in terms section 9. XAU/XAG/XPT/XPD are vendor-indicative USD observations. The reviewed endpoint schema did not explicitly establish troy-ounce contract equivalence; therefore unit is provider_native_quote and no exact-contract or execution admission is claimed.
- ECB: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml ; https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html ; https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html . These are DAILY reference rates, not transaction quotes. Source attribution is shown. EURUSD is directly published; six other USD pairs are calculated as quote-per-EUR / base-per-EUR with 12-decimal half-up rational division, explicitly labelled calculated cross rates. No intraday timestamp is manufactured.
- U.S. EIA: https://www.eia.gov/about/copyrights_reuse.php ; https://www.eia.gov/dnav/pet/hist/RWTCD.htm ; https://www.eia.gov/dnav/pet/hist/RBRTED.htm . Public government data reused with source and observation date. WTI Cushing and Brent Europe FOB are distinct DAILY spot benchmarks, USD/barrel. Weekday cells are converted to actual observation dates, blanks are not zeros, Friday/23:59 timestamps are not fabricated.
- FRED is not a default runtime source: its own commercial-use terms differ from direct EIA government data. The phase-1 FRED script remains only historical probe tooling.

## Bounded collection

One process-wide collector owns seven fixed endpoints (four metals, one ECB XML for seven pairs, two EIA pages). Three provider lanes; same-host calls are serial with 1100 ms spacing. Metals minimum 60 seconds, ECB one hour, EIA six hours, eight-second HTTP timeout, capped response bytes, no redirects, bounded exponential backoff and Retry-After. Concurrent browser requests share work. Read paths re-evaluate source age, keep at most thirteen observations and return copies. Reference-only browser cadence stays 60 seconds. A cold public request waits at most 1200 ms beyond the existing primary request; unfinished shared collection is available on later reads.

This is PROCESS-scoped, not a distributed lock/budget. Multiple replicas require a single designated collector or shared persistent coordination before activation. Memory cache is lost on restart; no durable last-known guarantee is claimed.

## Validation

Pure deterministic tests use explicitly synthetic local fixtures; no financial/provider writes. Real public probe uses the actual parsers and exactly seven credential-free requests, expects thirteen dated/indicative observations, and records JSON plus source errors. A passed probe does NOT mean all quotes are live, independent, executable, or approved for an exact CFD contract. Check the actual latest CI run and artifacts; no pending job is a pass.

The expanded workflow exposed ten stale assertions already present in main: old six-symbol batching, unavailable versus reference history/entitlement, obsolete Gold label, and a removed parent TradingView toolbar. Test expectations now track current main while adding shared-credit counts and explicit stale execution rejection. Native chart controls remain owned by TradingView; no runtime chart/order/account behavior is changed to satisfy old tests. No test is skipped or excluded to hide failures.

## Rollout and remaining gates

Default OFF. This PR does not set environment variables or deploy. After owner approval and staging checks, set CFD_PUBLIC_REFERENCES_ENABLED=true on ONE collector-owning backend process. False/unset returns the prior public serializer and makes zero supplementary HTTP calls. Review UI attribution, cache/failure states, session transitions and responsiveness before production activation. Roll back by unsetting the flag; no database migration or financial repricing.

Still NOT delivered: a second licensed live executable provider for every contract, account-entitlement verification, exact-contract metal equivalence, distributed collection, persistent last-known snapshots, session-crossing staging soak, production enablement. Those are separate gates; do not label this phase a finished institutional multi-provider execution feed.
