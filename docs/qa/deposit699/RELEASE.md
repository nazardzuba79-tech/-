# #699 — «Нове надходження» means a new on-chain receipt; dust and history are summarised

Scope: three API modules and the existing notification Worker. No frontend, no
database migration, no schedule change, no wallet/address change, no credit,
attribution, balance, withdrawal, Copy Trading, Futures, Wallet or listing change.
Nothing is deleted: every transfer stays in `Deposit` and in Admin → «Пополнения».

Status: code candidate on an isolated PR. **Not merged, not deployed.** A release
needs the owner's separate permission.

## What happened on 11 November (evidence)

Private identifiers (TXIDs, the recipient address, exact amounts and block
times) are deliberately not in this public document or in any test fixture
(the fixtures use synthetic values). They were reported to the owner privately.

- **Public chain, read-only (VERIFIED).** The watched recipient received exactly
  five native TRX micro-transfers (each a few millionths of one TRX, all
  `SUCCESS` `TransferContract`) in the **evening of 10 November, Europe/Kyiv,
  after the 20:00 slot**. No other native TRX transfer reached it between that
  slot and noon on 11 November.
- At 12:00 Kyiv on 11 November those five transactions were 16–18 thousand
  blocks deep (3-second blocks, i.e. 14–15 hours old), which is exactly the
  «16–18 тисяч підтверджень» shown in the five Telegram messages.
- The watcher's automatic slots are 12:00 / 16:00 / 20:00 Kyiv (plus the first
  admin opening after 07:00). The transfers arrived after the last evening slot
  and were first read by the next slot, 12:00.
- **Conclusion.** The five messages were not week-old history replayed by the
  7-day backfill. They were real on-chain dust transfers from the previous
  evening, each announced separately as «Нове надходження» with no transaction
  time, 14–15 hours after they happened. Such micro-transfers to an active TRON
  address are common unsolicited "dust"; who sent them is NOT_VERIFIED and is
  not assumed.
- **Not verified from this work session:** the production database rows
  (`createdAt`, `verifiedAt`, the `deposit-notice` records) and the API log of
  the 12:00 run. No server access was available. `forensics-readonly.sql` in
  this folder prints exactly those facts, read-only, for the operator.

## Defects fixed

1. `notifyVerified()` selected rows by `Deposit.createdAt` (when the exchange
   first recorded the row) and never looked at `blockTimestamp` (when the
   transaction happened). A transfer first recorded today was "new" however old
   it was on chain: an initial 7-day backfill of a watched address, or an admin
   checking an old TXID, produced «Нове надходження».
2. Every proven transfer, including 0.000001 TRX, produced its own message.
3. The message carried no transaction time at all, so a transfer from yesterday
   evening read as if it had just arrived.
4. The signed event's `timestamp` was the record time and was the only time
   the Worker had.

## Behaviour after the change

Every proven, finalized transfer without a notice record is classified once
(`src/services/deposits/depositNoticePolicy.ts`):

| class | rule | Telegram |
|---|---|---|
| `FRESH` | amount at or above the micro threshold and either (a) the chain time is at most 48 h older than the moment the row was first recorded, or (b) the watcher itself recorded it late (up to 7 days) for an address and asset it was already watching when the block was mined | one «Нове надходження» with coin, amount, network, **transaction time**, detection time, TXID, confirmations, status |
| `MICRO` | amount strictly below 1 TRX / 1 USDT (possible dust), whatever its age | no individual message; counted in the daily digest |
| `HISTORICAL` | already more than 48 h old when first recorded AND mined before the watch of that address began (initial backfill) or entered by hand (an admin checking an old TXID); or more than 7 days old | no individual message; counted in the daily digest |
| `TIME_UNKNOWN` | no chain time from the provider, or a block time in the future | no individual message; counted in the daily digest |

- Age is the chain time against the **record** time, so a late confirmation, a
  retried delivery or a notification outage never turns a real receipt into
  history. 48 h covers the longest regular gap between scans (20:00 → 12:00)
  plus a missed slot. Rule (b) covers a scanner backlog, pause or outage: a
  transfer that arrived while its address was watched is still announced
  individually, with its real transaction time, however late it was read.
  7 days is the notification Worker's own event retention.
- The digest is at most **one message per Kyiv day**
  (`deposit-digest:tron:<day>`): counts, sums and chain-time ranges per class
  and asset. It never says «нове надходження» and carries no TXID. Transfers
  found after the day's digest join the next day's. A digest the Worker
  refuses as malformed is closed as `REJECTED` (recorded, never retried) so it
  cannot block later digests.
- Each transfer keeps exactly one `AuditLog` record `deposit-notice:<depositId>`
  (`DEPOSIT_NOTIFICATION_DELIVERY` for an individual alert,
  `DEPOSIT_NOTICE_DIGESTED` / `DEPOSIT_NOTICE_SUPPRESSED` otherwise). A rescan,
  an API restart, a redeploy or a Worker restart cannot announce it again. The
  Worker's durable per-event claim is unchanged.
- The micro threshold is a Telegram presentation threshold. It is not the
  deposit minimum, credits nothing and says nothing about the sender.
- Optional environment (defaults in brackets; none is required):
  `DEPOSIT_NOTICE_FRESH_HOURS` [48, clamped 1–168], `DEPOSIT_NOTICE_MICRO_TRX`
  [1], `DEPOSIT_NOTICE_MICRO_USDT` [1] (0 turns the micro class off for that
  asset), `DEPOSIT_NOTICE_DIGEST` [`daily`; `off` journals without Telegram].
- Unchanged on purpose: the 07:00–22:00 schedule and slots, the 7-day initial
  backfill (needed so no transfer is missed), proof and finality gates, the
  approved-recipient check, manual attribution and credit.

## Verification (isolated only; none of it is production evidence)

- `scripts/qa-deposit-notice-699.cjs` — temporary PostgreSQL, compiled watcher
  and signer, the real Worker code, local TronGrid, fake Telegram: 22 checks
  (first scan with history, five dust transfers → one digest, TRX and USDT
  separately, late finality, rescan/restart/redeploy, rows announced by the
  previous release, next-day digest, Worker outage, cutover with the old
  Worker, crash between delivery and record, ambiguous Telegram timeout, digest
  failures, TronGrid outage, digest off, a receipt recorded three days late,
  an admin-entered old TXID, a late digest on the next day, a rejected digest,
  signed-event shape, logs, financial sentinels).
- `scripts/qa-deposit-notice-699-reproduce.cjs` — the incident shape against any
  build. `origin/main`: 7 «Нове надходження» (5 dust, 1 old, 1 real), none with
  a transaction time. This branch: 1 real alert + 1 digest.
- Worker: `npm test` in `workers/notification-edge` (unit + real workerd/SQLite
  restart). API: Jest suites for the policy and the signer.
- Existing acceptance still passes unchanged in behaviour:
  `scripts/qa-trx693.cjs`, `scripts/qa-deposit-packages.cjs`.

## Controlled release (after the owner's permission)

Production base to re-read, never assume: API image `voltex-trx697:6388c5ed`
(`sha256:c73d58eb…`, itself `voltex-deposit693:0ab4c0fc` + one module);
notification Worker deployment/version as recorded after #693. Stop on drift.

1. **Read-only preflight.** Run `forensics-readonly.sql` (sections 3, 4 and 6)
   and keep the output: section 6 predicts what the first scan after the
   release will send. Re-read the API image ID, the installed hashes of
   `services/deposits/DepositWatchService.js` and
   `services/TelegramNotifications.js`, confirm
   `services/deposits/depositNoticePolicy.js` does not exist yet, and record the
   Worker's current version. Snapshot both for rollback.
2. **Worker first.** Upload a new version of `voltex-notification-edge` from this
   commit without deploying, inheriting every binding (`EVENTS`, secrets,
   `DEPOSIT_SIGNING_PUBLIC_KEY`, route, compatibility date; no DO migration),
   inspect it, then deploy 100 %. It is backward compatible: the API release
   still running sends events without `blockTime`, which stay accepted. Until
   step 3 those are titled «Надходження» with «Час транзакції: не передано».
   A merge to main does not deploy the Worker: `deploy-kyc-edge.yml` only
   verifies on push and deploys on a manual run (`workers: notification-only`).
3. **API second.** Build FROM the pinned installed image, COPY only the three
   compiled modules above, label the source SHA. Compare every installed JS
   hash: exactly two changed, exactly one added, none deleted; bootstrap, index
   and mounts identical. Offline smoke: the three modules load, the signer
   produces a `/v1/deposit` body with `blockTime`, and the policy classifies a
   0.000001 TRX row as `MICRO`. Install with the existing Compose chain and
   `--no-deps api-production`; do not edit runtime configuration.
4. **Acceptance.** Health 200, unsigned private routes 401, watcher status
   unchanged (same cursors, same schedule, `enabled` as before). Do not start a
   scan and do not synthesise a transfer. At the next regular slot read the one
   log line `[deposit-watch] notices {…}` (counts only) and compare Telegram
   with section 6 of the preflight. `Deposit`, `Balance`, `DepositBatch` and
   `Withdrawal` row counts are not changed by this release.
5. Record the actual image ID, source SHA, Worker version and the first-slot
   outcome outside this commit.

## Rollback

- **API:** pin the previous image (`voltex-trx697:6388c5ed`) with the same
  Compose chain and mounts; verify health and private-route 401.
- **Worker:** pin the previous version with a 100 % deployment. Roll the API
  back first: the previous Worker refuses the new event shape, so a new API in
  front of an old Worker delivers nothing (nothing is lost either: unanswered
  events stay due and are sent once a compatible Worker returns).
- Nothing to undo in the database: no migration, no financial write. Keep the
  `deposit-notice:*`, `deposit-digest:*` and `deposit-digest-ack:*` records and
  the Worker's durable claims. With them in place the previous API code cannot
  re-announce anything already handled. Transfers still waiting for the next
  day's digest would, under the previous code, be announced individually again
  (the old behaviour).

## Known limits (unchanged or by design)

- A message Telegram itself rejects or times out on is never retried (the
  existing at-most-once rule from #693, kept to rule out duplicates). The
  outcome is recorded (`FAILED` / `UNKNOWN`) and the transfer stays in the admin
  queue. Changing that is a separate decision.
- A transfer sent after the 20:00 slot is still first seen at the next scan; the
  schedule was not changed. The message now states when it really happened.
- The exact production rows and the 12:00 log remain to be read by the operator.
