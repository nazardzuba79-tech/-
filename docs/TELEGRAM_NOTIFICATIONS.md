# Event-only Telegram notifications

Worker: **voltex-notification-edge**, `https://notify.voltextech.net`.
Owner adds **TELEGRAM_BOT_TOKEN** and **TELEGRAM_CHAT_ID** in this Worker's
Cloudflare Dashboard Settings → Variables and Secrets. Chat ID supplied by
the owner is configured there, not committed. No bot token is needed in
GitHub, Render, the frontend or Durable Object storage. Start the bot in
Telegram before expecting private messages.

Until BOTH secrets exist, `/health` and authenticated events honestly report
`NOT_CONFIGURED`. `CONFIGURED` describes settings only, not delivery; `SENT`
requires Telegram `ok:true` and a message ID. Production delivery is not
claimed on the basis of synthetic tests.

## Paths and authority

- KYC's existing authorize/email/confirm flow is unchanged. Only AFTER email
  acceptance AND confirmed metadata (`created` or `exists`) does the KYC
  Worker call the private `KycNotifications` service binding. Deferred
  confirmations and sealed-receipt recovery use the same event ID. The
  already-authorized email/name/document type stay in transient memory (and
  the existing encrypted recovery receipt), never the notification store.
  No document is forwarded. No additional Render/Neon lookup.
- Deposit Watcher replaces its existing INSERT with `createManyAndReturn`
  (INSERT RETURNING, scalar fields only). Rows and scan cursor still commit
  together. Only successfully inserted rows emit events, AFTER commit.
  Overlapping pages/legacy rows/rollback do not emit. No new SELECT.
- Render signs the exact deposit body, timestamp and fixed path with Ed25519.
  A domain-separated HKDF key is derived locally from the existing server
  JWT secret; the secret and private key never leave Render. Deployment
  pins only its PUBLIC verification half in `DEPOSIT_SIGNING_PUBLIC_KEY`.
  If JWT_SECRET is rotated, rerun the key-pinning deployment step. Missing
  or mismatched keys fail closed for notification, never for discovery.
- Public HTTP accepts ONLY signed `DEPOSIT_DISCOVERED`, ±5-minute signature
  freshness, <=4 KiB body, fixed schema, no Origin/Sec-Fetch browser request.
  Public KYC/registration/message endpoints do not exist. KYC binding rejects
  deposit events. Neither endpoint grants trading or administrative authority.
- No balance credit, attribution, KYC update, user write, migration, funding,
  matching or trading change is performed by notifications.

## Storage, duplicates, failures

Each event has one SQLite-backed Durable Object. Atomic claim BEFORE the
Telegram side effect stores ONLY `eventId`, `eventType`, `status`, `timestamp`.
No name, email, amounts, transaction history, body, document, photo or token
is persisted. Concurrent duplicates/restarts observe that durable claim.

One-shot alarm deletes all storage after 7 days (plus at most 60 seconds of
accepted event clock skew). It does not reschedule, send, query or poll.
Expired signed event timestamps are rejected, including after deletion;
duplicates never extend retention. Cloudflare may retry a failed cleanup
alarm using its bounded platform retry policy; there is no periodic cron.

At-most-one **attempt**, NOT guaranteed exactly-once delivery: a crash after
claim or ambiguous Telegram timeout may lose a notification. UNKNOWN/FAILED
claims are terminal; no retry queue/outbox/reconciliation was added. Missing
secrets make no claim and do not queue/backfill old events automatically.
Sanitized logs contain fixed status codes only, not exception strings/URLs.
KYC uses waitUntil; Render dispatches a caught background promise. Telegram
failure cannot roll back, reject or delay the successful business operation.

## Content and truthful limitations

Discovery is not proof of finality or approval. The current watcher discovers
USDT/TRC20 treasury transfers **without an owner**. It sends amount/network and
`Непривязанный`, or `Готов к проверке` for >=300 USDT; this is not a credit.
It does not fetch email/aggregate balances just to enrich Telegram. The
formatter supports an already-known email/accumulated/remaining amount, but
the current discovery path does not have these facts and therefore omits them.
Registration, attribution, subsequent proof refresh and approval produce no
notification. No fictional accumulation or identity is displayed.

## Resource budget

With no events: zero notification HTTP calls, zero Telegram calls, zero extra
Render requests, zero extra Neon reads/writes. A pending one-shot retention
alarm may delete its own Cloudflare record without any external request.
Per event: one internal event call + one DO dispatch + at most one Telegram
call; small Cloudflare claim/status writes. No new Neon operation; only the
existing deposit insert returns its rows. Deployment alone reads the public
key endpoint to pin trust; event handling never fetches keys from Render.
The existing deposit chain-scanning schedule and KYC confirmation retries
are preserved, not new notification polling.

## Tests and release

- `node --test workers/notification-edge/test.mjs workers/notification-edge/integration.test.mjs workers/kyc-edge/test.mjs`
- `npx jest --runInBand --runTestsByPath src/services/__tests__/TelegramNotifications.test.ts`
- `npm run build && node scripts/qa-deposit-packages.cjs`

Only synthetic payloads, mocked Telegram and isolated local PostgreSQL.
Real workerd/SQLite tests cover concurrency, restart and minimal storage
cleanup; PostgreSQL tests cover committed new rows, overlap, rollback,
publisher zero queries and notification failure isolation.

CI verifies PRs before owner-authorized merge. The main-branch KYC deployment
workflow deploys notification Worker first, then its KYC service binding,
then pins the public Render key and checks health WITHOUT sending an event.
Render auto-deploy is not duplicated. No production KYC/deposit is generated
to test this feature. Enable Telegram by adding secrets in the Dashboard;
no code deployment or production data repair is needed for those secrets.
