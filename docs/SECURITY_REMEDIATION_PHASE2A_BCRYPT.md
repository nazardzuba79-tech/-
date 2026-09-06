# Security remediation Phase 2A — bcrypt 6

Date: 2026-09-06. Agent: Codex. Status: **validated for owner review on the isolated feature branch; not merged or deployed**.

## Provenance and authorization

- Required and fetched `origin/main`: `27d531b0140471654adf3f18203b06de73ed5598`; independently confirmed with `ls-remote` before implementation. The base contains completed Phase 1.
- Isolated branch: `codex/security-remediation-phase2a-bcrypt`, created from that main SHA. Main, Phase 1 and the audit branch are not modified by this work.
- Implementation commit: `849afee5272109054b2a29c0f32c0724b33840c8`. The subsequent documentation-only commit records these verified results and the required handoff; the final remote SHA is reported separately to avoid a self-referencing commit hash.
- Read the complete Phase 1 report on main and dependency audit at `origin/codex/security-dependency-audit` (`180989402bdf7f559a6228b1cefb182db8de0937`). The audit document itself is not present on main; no audit-branch code was imported.
- Local Docker/Podman/VM runtimes were absent and WSL explicitly reported not installed. Work paused before dependency edits. The owner then explicitly authorized an isolated GitHub Actions workflow and test-branch push to run Node20 Alpine verification without production secrets, database access, merge or deployment.

## Exact dependency scope

Only backend `package.json` and `package-lock.json` dependency files change. `bcrypt` is pinned exactly to **6.0.0**, from installed **5.1.1** (previous declaration `^5.1.1`). No `npm audit fix`, override, library substitution or broad refresh was used. `@types/bcrypt` stays unchanged.

| Changed/introduced node | Before | After |
| --- | --- | --- |
| bcrypt | 5.1.1 | 6.0.0 |
| node-addon-api | 5.1.0 | 8.9.2 |
| node-gyp-build | absent | 4.8.4 |

The actual new dependency closure is `bcrypt@6.0.0 -> { node-addon-api@8.9.2, node-gyp-build@4.8.4 }`. The old closure contained 63 installed nodes including shared dependencies; the new closure contains three. The [official v6 release](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0) documents the installer replacement; resolved versions above come from this candidate's lock, not an assumed release graph.

### Every pruned node (36)

Locations below are relative to root `node_modules/`; nested entries distinguish separate package nodes.

| Pruned location | Version |
| --- | --- |
| @mapbox/node-pre-gyp | 1.0.11 |
| abbrev | 1.1.1 |
| agent-base | 6.0.2 |
| agent-base/node_modules/debug | 4.4.3 |
| agent-base/node_modules/ms | 2.1.3 |
| aproba | 2.1.0 |
| are-we-there-yet | 2.0.0 |
| chownr | 2.0.0 |
| color-support | 1.1.3 |
| console-control-strings | 1.1.0 |
| delegates | 1.0.0 |
| detect-libc | 2.1.2 |
| fs-minipass | 2.1.0 |
| fs-minipass/node_modules/minipass | 3.3.6 |
| fs-minipass/node_modules/yallist | 4.0.0 |
| gauge | 3.0.2 |
| has-unicode | 2.0.1 |
| https-proxy-agent | 5.0.1 |
| https-proxy-agent/node_modules/debug | 4.4.3 |
| https-proxy-agent/node_modules/ms | 2.1.3 |
| make-dir | 3.1.0 |
| make-dir/node_modules/semver | 6.3.1 |
| minipass | 5.0.0 |
| minizlib | 2.1.2 |
| minizlib/node_modules/minipass | 3.3.6 |
| minizlib/node_modules/yallist | 4.0.0 |
| node-fetch | 2.7.0 |
| nopt | 5.0.0 |
| npmlog | 5.0.1 |
| rimraf | 3.0.2 |
| tar | 6.2.1 |
| tar/node_modules/yallist | 4.0.0 |
| tr46 | 0.0.3 |
| webidl-conversions | 3.0.1 |
| whatwg-url | 5.0.0 |
| wide-align | 1.1.5 |

Twelve retained nodes become dev-only because bcrypt no longer consumes them; versions, integrity and all other metadata remain unchanged: `balanced-match@1.0.2`, `brace-expansion@1.1.18`, `concat-map@0.0.1`, `fs.realpath@1.0.0`, `glob@7.2.3`, `inflight@1.0.6`, `minimatch@3.1.5`, `mkdirp@1.0.4`, `once@1.4.0`, `path-is-absolute@1.0.1`, `signal-exit@3.0.7`, `wrappy@1.0.2`.

The lock-scope check resolves the old/new npm ancestor dependency closures, asserts each removed/introduced node belongs to the corresponding bcrypt closure, and rejects unrelated version/integrity/content movement. Both frontend manifests/locks are byte-identical to the base. In particular qs, Express, body-parser, both UUID trees, Vite/esbuild/Capacitor, React Router 7.18.3 and Nodemailer 9.0.1 are unchanged.

## Bcrypt callsite and policy audit

All non-test runtime bcrypt imports remain in exactly three files:

| File/callsite | Existing operation and cost | Preservation |
| --- | --- | --- |
| `src/api/routes/auth.ts:181` | Registration hash, cost 12 | Unchanged |
| `src/api/routes/auth.ts:229` | Login compare, existing/dummy hash | Unchanged |
| `src/api/routes/account.ts:157` | Compare current password | Unchanged |
| `src/api/routes/account.ts:160` | Changed password hash, cost 12 | Unchanged |
| `src/services/TwoFactorService.ts:35` | Eight backup-code hashes, cost 10 | Unchanged |
| `src/services/TwoFactorService.ts:55` | Trim/uppercase and compare backup code, return remaining hashes | Unchanged |

No application source change is required. Registration retains 10+ characters and an uppercase letter; password-change retains its existing separate 10+ rule. Login errors, account-block policy, session/JWT behavior, 12-hour session token, 5-minute narrowly scoped pending-2FA token and one-time backup consumption are preserved. No password migration, production user access, database rewrite or rehash operation is performed.

## Controlled old-hash compatibility

`src/services/__tests__/fixtures/bcrypt-5.1.1-compatibility.json` contains eight deliberately public non-production fixtures generated with the **actual installed bcrypt 5.1.1 native package**, before migration: six cost-12 password fixtures and two cost-10 backup fixtures. They are not production hashes or outputs regenerated using bcrypt 6.

Fixture-array SHA-256: `5a5743083e2fb7e3d65c9cf624397d43d5083a956620b3d92a07ccb68093ddd7`.

Real bcrypt 6 tests accept the old correct passwords and reject the wrong ones, reproduce old hashes with the saved salt, verify fresh cost-12 hashes, and cover `$2a$`/`$2b$`, Unicode, ASCII/multibyte 72-byte boundaries and embedded NUL. Existing 72-byte truncation is explicitly characterized, not changed or hidden by this migration. Real backup-code tests verify cost 10, eight generated hashes, trim/uppercase normalization and one-time consumption.

Real HTTP auth regression tests use the unchanged Express auth/account routers, bcrypt, JWT, TOTP, QR and auth middleware against stateful in-memory User/Session/Audit adapters. They exercise registration, correct/wrong/unknown login, blocked accounts, protected `/me`, password changes and rejection of the old password, session claims/revocation, legacy password/backup fixtures, TOTP setup/login and persisted backup replay rejection after reconstructing the app. Optional country lookup is isolated; no real database or email is used. Registration/login rate-limit middleware is replaced only inside this test harness with pass-through adapters to focus on bcrypt-dependent behavior; this new suite does not claim to test rate-limit enforcement. Production limiters remain byte-for-byte unchanged.

## Native Node20 Alpine gate

The owner-authorized `.github/workflows/security-phase2a-bcrypt.yml` is restricted to this feature branch, with read-only repository permission, immutable official action SHAs, no persisted checkout credential and no production environment/secrets. It builds the existing backend Dockerfile without changing it, including clean builder `npm ci`/TypeScript and runtime `npm ci --omit=dev`.

All container executions explicitly override the image entrypoint/CMD and disable external networking. The normal image CMD, which runs migrations, is never executed. Native checks assert Linux, Node major 20, Alpine/musl, exact bcrypt 6.0.0, the loaded musl `.node` addon, actual installed application dependency graph and old/new hashes. No claim is made about npm's own global internal dependency graph.

**PASS:** [GitHub Actions run 34046665754](https://github.com/nazardzuba79-tech/-/actions/runs/34046665754), job `101522816811`, exact implementation `849afee5272109054b2a29c0f32c0724b33840c8`. Every job step concluded `success`; logs and the downloaded checksum-verified artifact were inspected, not inferred from a queued workflow.

| Actual native evidence | Result |
| --- | --- |
| Runtime | Node **20.20.2**, Linux **x64**, Alpine **3.23.4** |
| C library | `ld-musl-x86_64.so.1`; no glibc runtime |
| Installed package | bcrypt **6.0.0** after clean runtime `npm ci --omit=dev` |
| Loaded binary | `/app/node_modules/bcrypt/prebuilds/linux-x64/bcrypt.musl.node` |
| Binary SHA-256 | `bb1cd7c79f310e92f3168b279cc36a7f2f687b07f62dddf8886264a1c64031c6` |
| Minimum owner smoke | `BCRYPT_NATIVE_OK` |
| Native checks | **90 PASS**, including eight old/new hash fixtures, correct/wrong inputs, cost policy, Unicode/NUL/72-byte compatibility |
| Actual application installation | **175 package nodes**; zero node-pre-gyp, tar or substitute bcrypt libraries |
| Installed production tree | `npm ls --all --omit=dev --json` exits **0** |
| Real auth/compatibility/2FA on Alpine | **3 suites / 40 tests PASS**, zero failures |
| Dockerfile integrity | Unchanged SHA-256 `386accace13ce978b4821d4a63a050b3f5911430ee8892508a75796cae5564cd` |
| Runtime image | `sha256:b4aa346e857deca519ca42919b8f23321e42ec83a700aed499dcde220e2ea8cb`, Linux/amd64 |

The resolved `node:20-alpine` base digest was `sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`. No Dockerfile or runtime workaround was necessary. Both original Dockerfile stages built cleanly; the isolated builder-stage auth tests passed separately with no external network, production database, email, production entrypoint or migration execution. Supertest uses only the container's isolated loopback HTTP server; that is distinct from starting the production application.

Evidence artifact: `9993326110`, `security-phase2a-bcrypt-849afee5272109054b2a29c0f32c0724b33840c8`, SHA-256 `135e4b880c92e7aaed2977c54a3a6ec8c10effda86c3bf10ae5ba1709cf89a6b`. GitHub retention ends 2026-09-13; a verified local copy is also retained outside Git. It contains native JSON, both build logs, installed production tree, input hashes and machine-readable Jest results.

## Fresh audit results

Local collection: Node 24.19.0 / npm 10.9.9, official npm registry. Baseline clean backend/frontend installs passed; after-upgrade clean backend `npm ci` passed. The before snapshot was collected at `2026-09-06T16:33:24.323Z`, after at `2026-09-06T16:35:58.652Z`.

| Scope | Before moderate | Before high | Before critical | After moderate | After high | After critical |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Backend full | 4 | 2 | 1 | 4 | 0 | 0 |
| Backend `--omit=dev` | 4 | 2 | 1 | 4 | 0 | 0 |

Low/info are zero. These are vulnerable application-package nodes, not unique CVE counts. Both after audits exit 1 because the four excluded moderate nodes remain; they do not indicate a collection failure. `npm ls bcrypt` shows 6.0.0; `npm ls @mapbox/node-pre-gyp` and `npm ls tar` return empty dependency objects (npm exit 1 for absence), and the full dependency-tree listing exits 0. The legacy chain is absent entirely from this application's dependency lock/installation, not merely hidden by an audit filter.

### Every remaining backend finding

| Package | Version | Severity | Advisory/path |
| --- | --- | --- | --- |
| qs | 6.15.3 | moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), CVE-2026-82562: comma array-limit bypass; [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), CVE-2026-82417: attacker-controlled isBuffer DoS |
| body-parser | 1.20.6 | moderate | Inherits the same two qs advisories through body-parser -> qs |
| express | 4.22.2 | moderate | Inherits the same two qs advisories through direct qs and body-parser -> qs |
| uuid | 9.0.1 | moderate | [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq), CVE-2026-41907: output-buffer bounds in v3/v5/v6 |

No high/critical backend application nodes remain in these snapshots. Frontend dependencies/findings are outside this phase and unchanged; this is not a claim that the entire repository or base image has no vulnerabilities.

## Validation and evidence

- Backend TypeScript `tsc --noEmit` and `npm run build`: PASS on Windows Node24.
- Bcrypt compatibility plus existing TwoFactorService: 2 suites / 30 tests PASS.
- New real-router auth regression: 1 suite / 10 tests PASS.
- Full configured Jest: **102 suites / 1,120 tests PASS**, zero failures (backend 85 suites / 912 tests; frontend 17 suites / 208 tests). This adds two suites and 31 cases to the Phase 1 baseline of 100 / 1,089 without weakening or deleting any tests.
- Native CI: **90 native checks + 3 suites / 40 real auth/compatibility/2FA tests PASS** on Node20 Alpine, in addition to the local full suite.
- Dependency-lock scope check and application-source preservation diff: PASS.

Local evidence outside Git: `outputs/security-remediation-phase2a/` contains before/after clean-install logs, manifests/locks and hashes, audits, actual dependency trees, exact lock-scope JSON, full Jest result/log and downloaded native CI evidence (`ci-849afee/`). The committed tests/native harness and workflow are reproducible without production data.

## Complete changed-file inventory

- `package.json`, `package-lock.json`: exact backend bcrypt migration only.
- `src/services/__tests__/BcryptCompatibility.test.ts`: legacy/new hash and backup compatibility.
- `src/services/__tests__/fixtures/bcrypt-5.1.1-compatibility.json`: eight public non-production old hashes.
- `src/api/routes/__tests__/bcryptAuthRegression.test.ts`: real unchanged routers against isolated in-memory persistence.
- `scripts/qa-bcrypt-native.cjs`: fail-closed native musl/fixture/dependency proof; never imports application startup.
- `.github/workflows/security-phase2a-bcrypt.yml`: explicitly owner-authorized, exact-feature-branch-only CI; no deployment.
- `docs/SECURITY_REMEDIATION_PHASE2A_BCRYPT.md`: this evidence report.
- `docs/AI_HANDOFF.md`: required concise handoff.

## Untouched scope and next step

No production application source, password policy/cost, UI, financial logic, Crypto Card, Copy Trading/Nazar/Ksenia histories, Trade/matching, Wallet/balances, Futures, Analytics, Arbitrage, market-data logic, schema/migrations, Dockerfile, Render configuration or production secrets changed. No merge to main or deployment is authorized. Only this isolated Phase 2A branch may be pushed.

Next after owner review: separately scoped **qs 6.16.0 + backend uuid 11.1.1** remediation. No such upgrade is included here.
