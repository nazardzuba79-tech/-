# npm dependency audit, 2026-09-26

The audit ran on a fresh `origin/main` at `480d98f2` with npm 10.9.7 and Node 22. The lockfiles audited:

- `package-lock.json` (backend, 512 packages);
- `frontend/package-lock.json` (324 packages);
- `workers/notification-edge/package-lock.json` (91 packages).

`workers/support-edge` and `workers/kyc-edge` have no npm dependencies.

## Counts

| Lockfile | Before (crit / high / mod / low) | After |
| --- | --- | --- |
| backend, all | 0 / 3 / 4 / 0 | 0 / 0 / 1 / 0 |
| backend, production only (`--omit=dev`) | 0 / 2 / 4 / 0 | 0 / 0 / 1 / 0 |
| frontend, all | 0 / 1 / 4 / 0 | 0 / 1 / 4 / 0 (unchanged, all dev-only) |
| frontend, production only | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| notification-edge | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

## Findings and decisions

| Package | Sev. | Advisory | Path | Prod/dev | Reachable in VOLTEX? | Action |
| --- | --- | --- | --- | --- | --- | --- |
| multer 2.2.0 | high | GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4, GHSA-qvfw-j98x-7q72 | direct | prod | **No.** Nothing imports it: KYC upload moved to the Cloudflare edge and `/kyc/submit` on Render answers 410. The package was still in the Docker image. | **Removed** with `@types/multer` (7 packages leave the lockfile) |
| nodemailer 9.0.1 | high | GHSA-2x7j-588g-ccc2 (addressparser O(n²)), GHSA-wmmp-3585-3rmp, GHSA-cc9r-2j5m-2m83, GHSA-8m3c-c648-2xjj | direct | prod | **No** today: the only user, `KycEmailService`, is not wired into any route, and its recipient is a fixed env address, not user input. | **9.0.1 → 9.1.1** (minor, same major; the pinned-exact style is kept) |
| qs 6.15.3 | moderate | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx | via express, body-parser (and superagent, dev) | prod | **No:** these need `plainObjects` / `allowPrototypes` / `comma: true`. Express parses `req.query` with the defaults. | Fixed by **express 4.22.2 → 4.22.3** (patch), which brings `qs 6.16.0` and `body-parser 1.20.8` |
| express 4.22.2, body-parser 1.20.6 | moderate | via qs | direct / transitive | prod | as qs | as above |
| js-yaml 3.15.1 | high | GHSA-2883-xcg3-v3hh | ts-jest → babel-plugin-istanbul → @istanbuljs/load-nyc-config | dev | **No:** jest coverage config loader, not in the image | **3.15.2** (patch, lockfile only) |
| uuid 9.0.1 | moderate | GHSA-w5hq-g745-h8pq (v3/v5/v6 with a caller-supplied `buf`) | direct | prod | **No:** every call is `uuidv4()` with no buffer | **Not changed.** The only fix is uuid 11+ (major), and the code sits in the matching engine and order and position services. Recommended as its own small PR. |
| vite 5.4.x | high | GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3 | direct | dev | **No:** dev-server only. Production is the static `dist/` on Cloudflare Pages, and the dev server never runs there. | Not changed: the fix is vite 6.4.3+/8 (major) |
| esbuild ≤0.24.2 | moderate | GHSA-67mh-4wv8-2f99 | via vite | dev | **No:** dev-server only | as vite |
| @capacitor/cli, xcode, uuid 7 | moderate | GHSA-w5hq-g745-h8pq | Android build CLI | dev | **No:** local Android build tool, not in the web bundle | Not changed: the npm-proposed "fix" is a major change of the CLI |

## Supply chain

- **Registry and integrity:** every lockfile entry resolves from `registry.npmjs.org` and carries an `integrity` hash. There are no git, tarball or other registry URLs.
- **Signatures:** `npm audit signatures` verified 511 registry signatures for the backend and 278 for the frontend. The rest are optional platform binaries that are not installed.
- **Install scripts:**
  - Backend: `@prisma/client`, `@prisma/engines`, `prisma`, `bcrypt` (all expected), plus `fsevents` (optional, macOS).
  - Frontend: `esbuild` and `fsevents`, both dev.
- **Deprecated versions:**
  - `uuid@9` (prod), as above;
  - `glob@7`, `inflight`, `rimraf@2`, all dev, pulled by jest;
  - frontend `uuid@7` and `whatwg-encoding`, both dev, pulled by the capacitor CLI and jsdom.
- **Duplicate majors:** 19 in the backend and 9 in the frontend. All are small transitive helpers (debug, semver, yargs, lru-cache…); none is a security or runtime concern.

## Not touched

Trading math, liquidation, funding, deposit rules, Cloudflare Support/KYC, Telegram notifications, Prisma (still 5.x) and the schema.

## CI coverage for dependency changes

Before this change, no GitHub Actions workflow ran on a PR that only touched `package.json` or `package-lock.json`, so only the Cloudflare Pages build ran. Both files are now in the `pull_request` path filters of two workflows, so a backend dependency change gets a real CI run:

- `deposit-minimum.yml`: backend and frontend build, deposit/auth/admin jest, embedded Postgres and browser acceptance;
- `kyc-edge.yml`: migrations on an empty Postgres, KYC Postgres integration, Nodemailer compatibility, browser QA.

Neither workflow deploys anything.
