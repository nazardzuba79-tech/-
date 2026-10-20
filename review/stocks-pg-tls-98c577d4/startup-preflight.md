# Source-only API startup preflight — CTO 6296101451

Application: `98c577d4241ce527f7bfca3b78dd7bb78255e300`.
Patch parent: `c7306b5b9d9eda010f1bf9a603cf6f942044d646`.
This is a harness configuration fix, not a successful container/startup receipt.

## What was inspected

Read the unchanged `src/index.ts`, its constructor/router wiring and `start()`.
A TypeScript-to-CommonJS static relative-import traversal inspected 261 local
TS modules (including conservative traversal of lazy relative requires).
Two JSON dependencies, `src/otc/cities.json` and the published copy-performance
seed JSON, are data rather than executable guards. No application graph was
executed. This scan identifies explicit top-level throws, not every possible
dynamic/library/constructor failure. Constructor and conditional configuration
paths below were reviewed separately.

| Prerequisite / guard | Source | Harness disposition |
| --- | --- | --- |
| Nonempty `JWT_SECRET` | `src/api/middleware/auth.ts`, `src/api/routes/auth.ts` eager guards | Existing fresh 32-byte hex fixture secret, both API modes |
| Exactly 64 hex `API_KEY_ENCRYPTION_SECRET` | `src/services/ApiKeyService.ts`, eagerly imported by apiKeys router | Newly generated 32-byte hex fixture key, both API modes only; registered for redaction |
| PostgreSQL connection, schema and recovery before listening | Prisma schema; `src/index.ts` awaits Spot/Futures order-book recovery | Existing disposable DB URL and DIRECT_URL; loopback, strict certificate verification and CA file preserved. Actual recovery/health awaits a future authorized smoke |
| Catalogue/finance route authority config | `src/api/routes/stocksTestCash.ts`; lazy PG authority/release config | Existing issuer, random gateway key >=32 chars, JWT and exactly two distinct fixture principals. Catalogue remains enabled in the finance-OFF API; financial gate remains false there |
| Node synchronous ESM require and packaged authority dependencies | Stocks router / gateway default entrypoint | Node 22.23.3 and previously approved image recipe unchanged; no new packaging/build claim |
| HTTPS / port / origin | Existing runner env and fixture | Existing per-service ports, allowed origin and NODE_EXTRA_CA_CERTS preserved |

Other inspected configuration does **not** justify adding production credentials:

- `collectorFromEnv` returns null when collector URL/token are absent; the
  separately launched collector's mandatory-token guard is not the API entrypoint.
- `COINGLASS_API_KEY` is optional: its constructor is called only when a trimmed
  key exists. CFD/provider entitlement values are optional and remain absent.
- Listing storage returns an unconfigured adapter when its URL/token are absent.
  Deposit catalogue configuration is likewise a request-time/optional adapter.
- `loadChainConfig` requires per-chain native asset / selected RPC configuration
  when used; deposit/treasury resolution handles unconfigured chains. It is not
  an unconditional API module-import requirement.
- KYC HMAC helpers and password vault use the already supplied JWT/encryption
  keys when invoked. No KYC/provider/treasury credentials were added.
- Local `.env`, owner credentials, real accounts and real database were not read.
  The Docker fixture continues to receive only generated explicit env files.

## Narrow local evidence

Node 22.23.3, **11 new tests PASS**:

1. Unchanged ApiKeyService rejects missing key.
2. Actual runner env construction supplies existing JWT/PG/TLS/two-principal config.
3. Unchanged ApiKeyService rejects nonhex, 63-char and 65-char keys.
4. Actual runner generates different valid keys; unchanged module import succeeds.
5. Both API modes receive the key; gateway/PostgreSQL do not; stdout and stderr
   redact raw and encodeURIComponent values and preserve command exit 7.
6. Multiple harness commits pass ancestry/exact-head/protected-path checks.
7. Protected application modification fails.
8. Moving protected code into the allowlisted directory fails.
9. Unrelated history with an otherwise allowed net diff fails.
10. Incorrect event head or application checkout fails.
11. Dirty source or harness fails.

Two separate temporary regressions each produced **1 FAIL / 0 PASS** in the
corresponding targeted test: remove the key env entry; restore `HEAD^ == APP`.
The corrected final new suite passed. These are fixture-only local checks.
Existing diagnostics helper/tests are byte-identical to the parent; their prior
6 PASS / stderr-loss mutant 4 FAIL + 2 PASS evidence is retained, not rerun.

## Still unproven

Previous smoke 39456249348 remains FAIL before API health. Its discarded stderr
cannot be recovered; missing key is a proven source prerequisite, not a recovered
original stack trace or proof of the only failure. No new Docker, GitHub CI,
PostgreSQL transaction, BUY/SELL, financial regression or load test ran here.
Actual API/gateway startup and positive HTTP/PG/TLS smoke require a separately
approved single run. Real production runtime-bootstrap/topology, release gates,
provider rights and capacity remain outside this patch.
