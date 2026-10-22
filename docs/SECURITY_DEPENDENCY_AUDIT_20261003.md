# Dependency security audit — 2026-10-03

Baseline: `d9b52648dc00e1b838bd08907381aebb77a0e25a`  
Audit run: GitHub Actions `37129579550`  
Candidate after retired mail removal: `b24b8cc75fc6b7e2476a493508d3bad5acc97856`  
Candidate audit run: `37129989009`

## Production dependency result

| Scope | Baseline | Candidate |
| --- | --- | --- |
| Backend `--omit=dev` | 1 high + 1 moderate | 0 high + 1 moderate |
| Frontend `--omit=dev` | 0 | 0 |
| Notification Worker package | tooling-only: 1 high + 2 moderate | unchanged |

The backend high finding was `nodemailer@9.1.1`. The only runtime source importing Nodemailer was
`src/services/KycEmailService.ts`, whose own source marked it **LEGACY — NOT WIRED INTO THE APP**.
Current KYC document delivery is handled by `workers/kyc-edge` and Cloudflare Email Routing; support
mail is handled by `workers/support-edge`. Removing that retired service and dependency removes the
high production finding without introducing a new mail implementation or changing the current KYC path.

## Remaining backend production finding

`uuid@9.x` is reported for GHSA-w5hq-g745-h8pq / CVE-2026-41907. The issue applies to UUID v3/v5/v6
when callers provide an external output buffer with invalid bounds. Current VOLTEX runtime use is v4,
plus one v5 call in `VtaDemoSales.ts` using only `(name, namespace)`; no runtime call supplies a
buffer/offset. Therefore the current call sites do not exercise the vulnerable API shape.

Do not use `npm audit fix --force`. The patched 11.x line is `11.1.1`, but moving the exchange's
identifier dependency across major versions should be a separate reviewed change with matching,
orders, Futures, CFD and deterministic VTA receipt regressions.

## Development-only findings

The all-dependency audits include Jest/ts-node-dev on the backend and Vite/Tailwind/Capacitor tooling
on the frontend. Frontend production audit is zero. These should be remediated separately rather than
mixed into runtime financial code.

The notification-edge findings come through the Wrangler/Miniflare/Undici developer/deploy toolchain.
The audit reports a non-major Wrangler update as available. It is not Worker runtime application code;
update and Worker contract/dry-run tests should be a separate scoped change.

## Evidence and rules

- Both audit runs executed from committed lock files with Node 22.
- No install scripts, application start, database access, secrets or deployment were used by the audit.
- Candidate KYC/Support CI removes only tests for the deleted legacy SMTP implementation; Cloudflare
  Worker contract and browser/API tests remain.
- No merge or deployment is part of this audit/remediation branch.
