# #693 — native TRX detection and asset-correct notifications

Scope: four API modules and the existing notification Worker. No frontend,
database migration, credit policy, balance, wallet address, trading flag or
listing changes. The existing manual package approval and fresh chain proof
remain the only route to credit. Copying an address is never a deposit.

## Verified preparation

- Main/source baseline: `6260ae7731652831480824d4c1eb911c0bef2b87`.
- Installed API image: `voltex-order-ticket:19ca4e3c`, local image ID
  `sha256:60f1d2bd5332afa6c6b665aed98042d2335918db35ef4286b1e721ed2af121d2`.
  Source is composed (base `41a755a9`, withdrawal `8a5b6a5d`, ticket
  `19ca4e3c`); do not replace its index, bootstrap, mounts or Compose chain.
- All four installed module hashes match the captured production baseline;
  their source has no baseline-to-main differences. Overlay only compiled
  `services/deposit-verifiers/TronDepositVerifier.js`,
  `services/deposits/DepositWatchService.js`, `services/TelegramNotifications.js`,
  `api/routes/depositAddressCopies.js` on that exact image.
- Bootstrap SHA256 remains
  `1a76646d2a0987b9560cb70d2cabe870656b9eab1d7e698d764b2a9aee631866`.
- Notification Worker deployment before release:
  `04459fa3-1f01-4bda-85d3-7e42cb11de9f`, version
  `54df907b-ae3f-4740-afca-0e06b2c2a761`. Downloaded production bundle matches
  the compiled main source (excluding comments). Retain all secrets, DO
  namespace `EVENTS`, compatibility date, routes and private KYC entrypoints.
- Real PostgreSQL **18.6**: atomic cursor rollback, mixed TRX/USDT, pending
  finality, wrong recipient/failed execution, provider outage, delivery crash,
  restart, no duplicate sends and financial sentinels PASS. Existing package
  acceptance and 1440/390 admin browser checks PASS. Native asset rows are
  also checked in the built admin at both widths with financial calls blocked.
- Worker real workerd/SQLite restart integration plus unit cases: 34 PASS.
  Exact-head GitHub results must be read after push, not inferred from local QA.
- Live provider gate: production has no TronGrid API key; an initial bounded
  scan received HTTP 429 and correctly retained its cursor without a deposit
  or notification. Anonymous page/head/proof reads now share one paced
  transport (one-second spacing), retaining the same 40-call/60-second budget
  and provider backoff. Configured-key behavior is unchanged. Local fixtures
  disable the wait only; fake-time tests prove spacing and the unchanged cap.
- First exact-head CI (`fe30b1ba`): 7/8 workflows SUCCESS. Full frontend has
  two hash assertions failing in the unchanged `futuresTickerHeader.test.ts`.
  Both that test blob `e98f0c0e3358c69ef050dfb229a1bca1be5d4f41`
  and `api.ts` blob `6de3f1e75ec3f366352370ffcaa1f79ba8efec03`
  equal fresh main. A single narrow local run reproduced those same two
  failures (38 other cases PASS). Neither file nor any pin/guard is changed.
  The narrow deposit/API/Worker release contains no frontend bundle.

## Incident and controlled recipient gate

Read-only node-level chain proof found the reported native TRX receipt (a
four-figure TRX amount, evening of 7 November Europe/Kyiv) to the unchanged
catalogue USDT/TRON recipient. Solidified body and receipt agree; measured
confirmations exceed the configured 19. The exact amount, block number, block
time, TXID and recipient stay in protected server evidence, not this public
document: together they would identify the private deposit address on the
public chain (redacted here on 2026-11-11, Issue #699). Attribution to a particular account is NOT_VERIFIED:
an address-copy event does not prove who sent funds. Tiny other inbound
transactions are separate transfers, never combined with this incident.

At preparation the catalogue recipient was absent from approved treasury
history and cursors, and automatic watching was OFF. The owner confirms the
recipient is their controlled wallet. Do not trust arbitrary catalogue edits
or copy events in code. Reconcile only this exact confirmed unchanged address
through the existing treasury-history mechanism, with an audit record. Never
replace the current treasury or catalogue destination. Any watcher activation
is detection-only and must be explicitly recorded; it cannot credit or attribute.

## Install / smoke / rollback

1. Re-read API image, installed module hashes, runtime/Compose mounts and
   Worker canonical version. Stop on drift or concurrent release. Snapshot
   previous image, Worker content/settings and monitoring metadata server-side.
2. Build FROM the pinned installed image, COPY only the four files; label the
   source SHA. Compare every installed JS hash: exactly four changed, no
   added/deleted module. Isolated no-network smoke must load the verifier,
   watcher and copy router, verify native and USDT signed payloads locally,
   and retain the existing #691 boundary modules and bootstrap/index hashes.
3. Upload a new Worker version without deployment, inheriting all existing
   bindings. Inspect its bindings, then deploy 100% only that version. This
   rejects legacy unproven deposit messages during the short API cutover,
   while copy/registration/KYC contracts remain valid. No DO migration.
4. Install only the API image override using the existing Compose chain and
   `--no-deps api-production`. Do not edit runtime secrets/configuration.
   Require healthy, health HTTP 200, unsigned private APIs 401 and preserved
   #691 middleware/index. Roll back that image immediately on failure.
5. Register the single owner-confirmed unchanged recipient if still absent,
   preserving prior treasury history. Use bounded existing watcher scans;
   persist verified transfers unattributed/PENDING, never CREDITED. Check
   exact incident amount/recipient/TXID, real Worker SENT acknowledgement,
   existing admin queue at 1440/390, restart/repeat deduplication, and unchanged
   financial flags and balances. Do not synthesize a production transfer or
   infer a user from a copy event. Do not call confirm/attribute/credit.
6. Record actual API image ID and overlay source SHA, Worker version/deployment
   IDs, notification receipts and outstanding gates outside this source commit.

Rollback: pin previous API image above, same Compose chain and mounts; verify
health, index/bootstrap and private-route 401. Pin previous Worker version
above with a 100% deployment. Never erase verified Deposit observations,
delivery acknowledgement AuditLog records or DO dedupe state: rollback must
not resend, credit or rewrite history. Restore monitoring enabled state if
it was changed; retain honest received-transfer history for manual review.
No down migration, balance rollback or transfer reversal is involved.

## Reproduction (isolated only)

`npm run build`; focused verifier/notification/copy/deposit tests;
`npm ci --prefix workers/notification-edge` and its `npm test`;
`node scripts/qa-trx693.cjs --browser` and
`node scripts/qa-deposit-packages.cjs --browser`.
Use `DEPOSIT_QA_DEPS` for a pinned embedded PG/pg package root and
`QA_PLAYWRIGHT_MODULE` for Playwright. Never supply a production database URL.
The existing disposable harness initializes a loopback-only cluster and stops
it in finally. Expected fault-injection errors are retained in test logs.
