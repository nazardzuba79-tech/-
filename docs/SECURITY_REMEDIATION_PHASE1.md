# Security remediation Phase 1 — owner-review candidate

Date: 2026-09-06. Agent: Codex. **Not merged or deployed.**

## Provenance and scope

- Base: `origin/main` = `e8bf772bd493bfe490bf2c2d131c09180b856d08`, verified after fetching remote refs and independently with `ls-remote` before implementation.
- Isolated branch/worktree: `codex/security-remediation-phase1` / `work/security-remediation-phase1`.
- Audit source: `origin/codex/security-dependency-audit` = `180989402bdf7f559a6228b1cefb182db8de0937`, complete `docs/SECURITY_DEPENDENCY_AUDIT.md` read before work. Audit branch preserved.
- Owner explicitly requested this branch from current main, overriding the normal integration-branch workflow. Promotion, deployment and production access are not authorized by this phase.
- Only runtime source change: `frontend/src/lib/returnTo.ts`. No application routing architecture, page, financial, database or mail-service implementation changes.

## Redirect remediation

The old root-relative string check accepted `/\\outside.invalid/audit`. In an isolated browser using the unchanged old guard and React Router 6.30.6, login-style push attempted an external GET (blocked before sending), and authenticated replace raised a History `SecurityError`. Ordinary `/wallet` worked and protocol-relative URLs were already rejected.

The new guard parses destinations with the browser URL API against a fixed trusted origin, requires a root-relative same-origin path, and rejects mixed slash/backslash, protocol-relative, absolute, ASCII control-character, malformed percent/UTF-8 and ambiguous decoded authority forms. Nested path decoding is bounded. Unicode, spaces and escaped percent fixed points terminate. Query/fragment values are validated without rewriting the accepted return destination. `loginPathFor` and the auth/registration callers remain unchanged.

- Focused guard tests: **82 passed**, including all 33 ASCII controls, encoded variants, normal queries and shared push/replace policy.
- Additional bounded adversarial review: **78,141 inputs**, **95,850 same-origin assertions** against installed Router 7.18.3; no bypass or nontermination found. This is additional evidence, not a proof over every possible string.
- Actual built-app attack regression: **80 cases passed**; zero external navigation attempts, native History exceptions or broken fallback routes.
- CVE-2026-53669: **reproduced before; not reproduced after** in the tested cases.

## Exact dependency changes

| Tree | Dependency | Before installed | After pinned/installed |
| --- | --- | --- | --- |
| Backend | nodemailer | 6.10.1 | 9.0.1 |
| Frontend | react-router-dom | 6.30.6 | 7.18.3 |
| Frontend | react-router | 6.30.6 | 7.18.3, resolved by react-router-dom |

Lockfile comparison verified every unrelated node, including its metadata, unchanged. Router's dependency change removes `@remix-run/router@1.23.4` and adds `cookie@1.1.1` and `set-cookie-parser@2.7.2`. No audit-fix command, broad upgrade, override or type-package upgrade was used.

Router migration passed with the existing `BrowserRouter` / `Routes` / `Route` / `Navigate` architecture. No route renaming, loaders/actions/data-router, SSR or compatibility source rewrite was needed. Installed React 18 and the validation Node 24 runtime meet Router 7's requirements.

Nodemailer 9.0.1 passed real in-memory stream-transport RFC 822/MIME composition tests. Both `SupportEmailService.ts` and `KycEmailService.ts` are byte-for-byte unchanged from the base. Tests preserve explicit/default host/port/secure/auth options, support from/to/replyTo/subject/text, configured inbound replyTo, and the intentional KYC local PDF/JPEG/PNG attachment names, MIME types and bytes. Existing unconfigured-SMTP and rejected-send behavior and a real missing-local-attachment error pass. Public support requests reject malformed/group-style/CRLF addresses; arbitrary raw/href/path/envelope/recipient/attachment fields do not pass into message options. No SMTP connection, real email, OAuth, TLS bypass or additional file/URL loading capability was introduced.

References: [Router advisory GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [Router 7.18.3 release](https://github.com/remix-run/react-router/releases/tag/react-router%407.18.3), [version-pinned v6-to-v7 migration guide](https://github.com/remix-run/react-router/blob/react-router%407.18.3/docs/upgrading/v6.md), [Nodemailer 9.0.1 release](https://github.com/nodemailer/nodemailer/releases/tag/v9.0.1), [Nodemailer address-parser advisory](https://github.com/advisories/GHSA-rcmh-qjqh-p98v), [Nodemailer raw-message advisory](https://github.com/advisories/GHSA-p6gq-j5cr-w38f).

## Fresh before/after audits

Node **24.19.0**, npm **10.9.9**, registry `https://registry.npmjs.org/`. Both trees received successful clean `npm ci` before and after the narrowly scoped lockfile updates; install scripts were not skipped. `npm ls --all --json` also exited 0 in both trees. No database connection/migration was run by the local Prisma client-generation install step.

Registry snapshot times: before **2026-09-06T15:51:18.703Z**; after **2026-09-06T15:56:29.193Z**. These are npm audit vulnerable-package node counts, not unique CVE counts or assertions of production exploitability. Low/info counts are zero throughout.

| Scope | Before moderate | Before high | Before critical | After moderate | After high | After critical |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Backend full | 4 | 3 | 1 | 4 | 2 | 1 |
| Backend `--omit=dev` | 4 | 3 | 1 | 4 | 2 | 1 |
| Frontend full | 6 | 1 | 0 | 4 | 1 | 0 |
| Frontend `--omit=dev` | 2 | 0 | 0 | 0 | 0 | 0 |

Nodemailer and both Router nodes no longer appear in after-audit findings. The eight previous Nodemailer advisory IDs were `GHSA-mm7p-fcc7-pg87`, `GHSA-c7w3-x93f-qmm8`, `GHSA-vvjj-xcjg-gr5g`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-r7g4-qg5f-qqm2`, `GHSA-rcmh-qjqh-p98v` and `GHSA-p6gq-j5cr-w38f`.

### All remaining moderate/high/critical package nodes

| Tree/scope | Package | Installed | Severity | Chain/reason |
| --- | --- | --- | --- | --- |
| Backend full + prod | tar | 6.2.1 | critical | Legacy archive advisories; retained bcrypt install chain |
| Backend full + prod | @mapbox/node-pre-gyp | 1.0.11 | high | Via tar |
| Backend full + prod | bcrypt | 5.1.1 | high | Via @mapbox/node-pre-gyp |
| Backend full + prod | qs | 6.15.3 | moderate | `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g` |
| Backend full + prod | body-parser | 1.20.6 | moderate | Via qs |
| Backend full + prod | express | 4.22.2 | moderate | Via qs/body-parser |
| Backend full + prod | uuid | 9.0.1 | moderate | `GHSA-w5hq-g745-h8pq` |
| Frontend dev/tooling only | vite | 5.4.21 | high | Vite advisories and esbuild dependency |
| Frontend dev/tooling only | esbuild | 0.21.5 | moderate | `GHSA-67mh-4wv8-2f99` |
| Frontend dev/tooling only | @capacitor/cli | 8.5.0 | moderate | Via xcode |
| Frontend dev/tooling only | xcode | 3.0.1 | moderate | Via uuid |
| Frontend dev/tooling only | uuid | 7.0.3 | moderate | `GHSA-w5hq-g745-h8pq` |

These were explicitly excluded from Phase 1. Backend full/prod and frontend full audits still exit 1 because of these findings; frontend production-only audit exits 0. This candidate is not a claim of a fully vulnerability-free repository. Next phase after owner review: bcrypt 6.0.0 chain removal, then qs/uuid remediation.

## Validation actually completed

- Backend `tsc --noEmit` and `npm run build`: **PASS**.
- Frontend `tsc --noEmit` and `npm run build` (`tsc -b && vite build`): **PASS**. Existing large-chunk warning remains; Vite itself was not upgraded.
- Full configured Jest: **100 suites, 1,089 tests passed; 0 failed**.
- Backend subset of that complete run: **83 suites, 881 tests passed**.
- Configured frontend subset of that complete run: **17 suites, 208 tests passed**; frontend tests run through the root Jest configuration, not an invented frontend test command.
- Focused support/KYC/Nodemailer compatibility: **4 suites, 47 tests passed**, including 21 newly added tests. Real stream transport, no real SMTP.
- `git diff --check`, QA harness syntax check, exact package/lock scope comparison: **PASS**.

### Isolated actual-browser QA

`scripts/qa-security-phase1.cjs` serves the normal production frontend build through the repository nginx SPA rules on loopback. It uses explicit in-memory authentication responses, the actual JWT/session middleware for protected reads and the unchanged canonical Copy service against in-memory storage. It never accesses a real account or database. The normal App, AuthPage, RegisterPanel and Router are not replaced with a demo UI.

At **1440 and 390 px**:

- **14 route cases**: `/login`, `/register`, `/trade?pair=BTC%2FUSDT`, `/card`, `/wallet`, `/copy-trading`, `/futures?pair=BTC%2FUSDT`; direct load and refresh all HTTP 200, protected returns intact, zero horizontal overflow.
- **14 additional flows**: `/settings` login, registration preserving the encoded Trade pair query, 2FA returning to Card/Futures, guest/member/admin route-gate destinations.
- **80 attack cases**: 13 malformed/mixed/absolute/protocol-relative/control/encoded next variants through actual login push, registration replace and already-authenticated replace at both widths, plus the mixed-slash 2FA case at both widths.
- **Zero** external navigation attempts, native History exceptions, uncaught page errors, unexpected console errors and unexpected local API routes.
- External fonts/token-icon resources and Kraken WebSockets were blocked before any external connection. Market lists/quotes were explicitly unavailable/empty, not fabricated. This is routing/auth/render QA, not live market execution or SMTP delivery QA.
- Fourteen screenshots saved; desktop terminal and mobile login/Card/Wallet/Copy screens inspected. Local QA processes stopped after completion.

Build under test: frontend index SHA-256 `44f79bf615de29611d4b39013d0c0a77f5b84ea7763d66df268df604aa327919`; JS `index-DwG_12q0.js`; CSS `index-Dj2e7Y61.css`. No CSS/layout source changed.

## Evidence and preservation

Local artifacts are intentionally outside the branch under `outputs/security-remediation-phase1/`: raw eight audit JSONs, before/after install and dependency-tree logs, manifest/lock snapshots, lock-scope proof, before-reproduction JSON, after-browser JSON/14 screenshots, full Jest JSON/log, build logs and additional adversarial review. The committed browser harness can reproduce isolated route/attack QA with a normal build, nginx and Playwright.

Dependency files changed: `package.json`, `package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`.

Production application file changed: `frontend/src/lib/returnTo.ts` only.

Test/QA additions and updates: `frontend/src/lib/__tests__/returnTo.test.ts`, `src/api/routes/__tests__/support.test.ts`, `src/services/__tests__/NodemailerCompatibility.test.ts`, `src/services/__tests__/fixtures/mail-document.txt`, `scripts/qa-security-phase1.cjs`. Documentation: this report and the required `docs/AI_HANDOFF.md` entry.

Crypto Card, Copy Trading, Nazar/Ksenia histories, Trade/matching/money math, Wallet/balances, Futures, Analytics, Arbitrage, schema/migrations, real auth accounts, mail-service implementation, nginx/Docker/Render configuration and production secrets are unchanged. No production login, email, database access, deployment, main merge or main push was performed. Only this Phase 1 branch is to be pushed for mandatory owner review.
