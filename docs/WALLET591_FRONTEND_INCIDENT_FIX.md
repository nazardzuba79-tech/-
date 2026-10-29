# Wallet Conversion frontend incident: compiled release gate

Status: candidate preparation only. No new Pages deployment and no API rollback.

## Root cause and evidence

The old API-candidate workflow at `54a138f502003cd1fdea752f0440c970cd551af4`,
`.github/workflows/wallet-conversion-release-qa.yml`, checked out frontend
`6f6b0189feedadcd331f6733111992ce3fe5c3b6` and built the OFF artifact with
`npx vite build --outDir ../../output/wallet591-off-dist --emptyOutDir` without
an explicit production `VITE_API_URL`. The application fallback `/api/v1` was
compiled into that artifact. Its same-origin fixtures did not detect this.

The failing entry `index-B8M29ABt.js` has SHA256
`5e292ace9db37406e1f900bad9e9d1c937568c80d49f26d7a482117a3a9afb81`.
It came from run `40841070996`, artifact `12882986772`, ZIP SHA256
`b30f91de8215d4c1ca1e155915a6cc2828d257e00ecac88fe48c88afa4501bdd`.
That frontend artifact is NOT eligible for promotion. Its successful CI does
not establish correct production routing. This does not invalidate the separately
verified four-module API overlay.

Cloudflare Pages production configuration has the correct API URL. Direct upload
of prebuilt files does not rebuild Vite or inject that dashboard environment into
JavaScript. The old `ops/wallet-conversion/prepare-release.cjs` hashed the files
and claimed an OFF flag without executing the compiled frontend against an origin
oracle. Do not reuse its frontend packaging path for this replacement candidate.

## Repair

No application components, trading behavior, API source, dependencies or financial
logic are changed relative to the approved frontend base. The changes are limited
to build configuration, preparation scripts, CI and this handoff.

`frontend/wallet591-profiles.json` is the reviewed build-time routing contract:

| Profile | API | Market | KYC | Deposit catalogue |
| --- | --- | --- | --- | --- |
| production | `https://api.voltextech.net/api/v1` | `https://market.voltextech.net` | `https://kyc.voltextech.net` | `https://voltex-deposit-catalogue-production.nazardzuba79.workers.dev` |
| ru | `https://ru.voltextech.net/api/v1` | `https://ru.voltextech.net/_voltex/market` | `https://ru.voltextech.net/_voltex/kyc` | `https://ru.voltextech.net/_voltex/catalogue` |

Both profiles explicitly compile `VITE_WALLET_CONVERSION_ENABLED=false` and
`VITE_MANUAL_DEPOSIT_CATALOGUE=true`. RU paths were checked against its existing
served JavaScript. Existing hardcoded public market requests in unrelated modules
are preserved, not rewritten in this release.

The release builder disables `.env` loading, rejects contradictory or unreviewed
inherited `VITE_*` variables, and sets the reviewed profile explicitly. Vite checks
that contract and emits a source/profile receipt. The verifier examines emitted
JavaScript, checks every Vite static/dynamic asset graph reference and local HTML
asset reference, and records SHA256 for every artifact file (including hidden
Vite manifest). Matching a claimed receipt alone cannot pass.

The mandatory candidate CI builds both profiles from the exact commit. Browser QA
executes those bytes at each intended HTTPS origin, asserts actual request origins,
rejects missing assets, unknown routes and conversion requests, and runs a poisoned
bundle negative control. Every request is intercepted; synthetic authentication
and financial values never reach production. WebSockets and service workers are
disabled. No real financial operations or production credentials are used.

Coverage per profile: 38 cases at desktop1440 and mobile390: Admin, Spot, Wallet,
Banking, Futures, KYC, balances/open-orders failure UI, Admin 401/403/503/network
failure, guest authentication and seven Wallet locales with conversion disabled.
The existing Admin gate classifies wrapped network status 0 as SERVER; the test
checks that it remains fail-closed rather than changing that unrelated behavior.

Artifacts can only be sealed with a clean tracked checkout, an allowlisted diff
from the exact approved base, complete passing browser coverage, matching source
and all-file digest. Verification checks the same files and proof after sealing.
The workflow has read-only contents permissions, no deployment credentials and
no deployment step. It is a narrow candidate branch gate, not a main-branch release.

## Reproduce / promotion prerequisites

Use Node 22.23.3 in CI. Install frontend locked dependencies, run TypeScript,
then for each `production` and `ru` profile:

```text
node scripts/wallet591-frontend-artifact.cjs scope production
node scripts/wallet591-frontend-artifact.cjs build production
node --test scripts/test-wallet591-artifact.cjs
node scripts/qa-wallet591-release.cjs production
node scripts/wallet591-frontend-artifact.cjs seal production
node scripts/wallet591-frontend-artifact.cjs verify production
```

For RU, change the command profile and set `RELEASE_TEST_PROFILE=ru` for the unit
test. `QA_PLAYWRIGHT_MODULE` can point to an existing Playwright installation;
`QA_BROWSER_EXECUTABLE` can select an existing browser. CI installs its isolated browser
runtime on the runner. No new local browser/runtime installation is required.

The tested artifact directory is `output/wallet591-<profile>-dist`; the manifest,
browser report and screenshots accompany it. Never rebuild after approval or
replace it with the old OFF artifact. A new build requires its own complete proof.
After downloading CI artifacts, restore their relative `output/` layout and run
`verify` from the exact clean source commit before promotion.

Separate owner permission is REQUIRED before any frontend deployment. Immediately
before a permitted promotion, recheck canonical Pages deployment/source and both
OFF flags; any lease mismatch is a stop. Verify every downloaded file hash and the
CI run's exact head. Do not merge or deploy main, use an alternate build, or deploy
RU merely because its compatibility build passed.

## Production lease and rollback

Retain canonical Pages deployment `95010b1c-b13f-4c52-b08c-a90ffa7d5d60`, source
`6118e18e49edd226a6b250154d3893773b4522e2`. The incident deployment
`3558f166-4308-40fc-bcbb-be2a32c75671` is superseded. No repeat rollback is needed.
For a later authorized frontend promotion, retain this canonical deployment as
the frontend-only rollback target. A critical frontend regression must not trigger
an unrelated API or database rollback.

Read-only API verification during preparation found source
`54a138f502003cd1fdea752f0440c970cd551af4`, image
`sha256:83ed7f06237e061064ee0b9a27f494ff87e9904a850426a50ef03357c7877cdf`,
healthy with zero restarts, Node22.23.3/PostgreSQL18.6 and conversion OFF. Keep it.
Recheck current state before any future release; these are observations, not an
authorization to change it.

## Evidence limits

Passing browser suites establish controlled compiled-frontend regression coverage,
not authenticated production Admin/Wallet/Banking/KYC access or real balances.
Live read-only public/guest HTTP and browser CORS probes are separate evidence.
Production authenticated QA remains NOT_RUN. No live trades, deposits, withdrawals,
reserve changes, migration, bot restart or timer/listing change is permitted here.
Local development validation uses the existing Node24.22.0/Edge installation;
the release CI pins Node22.23.3/Chromium. Do not describe either as production QA.
