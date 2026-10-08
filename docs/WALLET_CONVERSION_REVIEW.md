# Funded wallet conversion and customer activity — review only

Owner decision: **0% commission**, automatic last market trade price. This is
an internal conversion of existing **available Funding/Spot Balance**, not a
bank/card payout, blockchain transfer or external venue order. Existing manual
balance credits and confirmed deposits land in this same ledger. Locked funds,
DemoBalance, synthetic/managed listing assets and native simulation funds are
not admission sources. No migration, production write, merge or deploy performed.

## Price and admission

- Reuse the existing Kraken spot feed and freshness metadata, no new provider,
  credentials, polling, cron or network client. Use actual USD pairs, inverse
  fiat pairs where available; USD is the numeraire. Ignore `/USDT` mirror aliases.
- Stablecoins require their actual USD market quote; do not assume a 1:1 peg.
- Quote age at most 15 seconds; stale, future, missing or invalid quotes fail
  closed. No automatic repricing: if either price changes before confirmation,
  the user must calculate and explicitly confirm a new preview.
- Supported assets are discovered from this feed. Do not promise every fiat or
  crypto currency in the Login banner. Unpriced assets cannot be converted.
- Exact decimal strings, isolated decimal context, destination rounded down
  once to the existing ledger's 18 places. Fee exactly zero. No global financial
  formula change; old crypto/stablecoin portfolio valuation policy stays intact.

Price semantics: [official ticker API](https://docs.kraken.com/api-reference/market-data/get-ticker-information)
(`c[0]` last trade), [spot pairs](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs).
The cache timestamp describes feed freshness, not guaranteed recent trading in
every instrument. This is a last-trade conversion as requested, not executable
bid/ask depth or slippage assurance.

## Settlement and recovery

Quote preview is server-owned and bound to user/intent/prices in AuditLog; it
does **not** reserve or move funds. Explicit confirmation serializes conversion
attempts per user with a transaction advisory lock, performs conditional atomic
source debit and destination credit through existing WalletMutation, then writes
one durable `WALLET_CONVERTED` receipt in that same transaction. Existing other
writers retain their conditional atomic updates. Any failure rolls back both legs.

The unique receipt `conversion:<quote UUID>` makes retries idempotent. Customer
receipt reads are owner-filtered and work during price outages. The UI stores
only the pending opaque UUID before sending; storage failure prevents submission.
Timeout is **unknown**, not failure: new conversion is blocked, with explicit
receipt lookup or retry of the same UUID. No automatic retry. A null receipt
alone does not prove the original request failed.

Quote and confirm POSTs are authenticated and rate-limited (20/minute/user).
Legacy/revoked sessions and pending-2FA tokens use unchanged requireAuth.

## Activity

Existing deposit, withdrawal and fill history remains. An additive owner-filtered
read shows real `BALANCE_ADJUSTED` credits/debits and durable conversions once;
no Demo, quote previews, admin identity/reason or fabricated historical entries.
Each source is bounded; the existing UI displays its most recent 50 results.
Partial source outage is explicitly shown and does not erase loaded deposits.
Seven languages, decimal formatting and hidden-balance privacy are preserved.

## Reproduce QA (disposable only)

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix frontend
npx prisma generate
npm run build
npm run build --prefix frontend
npm install --prefix output/wallet-qa-deps --no-save --ignore-scripts pg@8.23.1 playwright@1.58.2
output/wallet-qa-deps/node_modules/.bin/playwright install chromium
WALLET_QA_PG_BIN="$(pg_config --bindir)" WALLET_QA_BROWSER=1 node scripts/test-wallet-conversion-postgres.cjs
```

Linux uses the installed PostgreSQL client/server tools (`pg_config`, `initdb`,
`pg_ctl`), but not any existing server or cluster. CI verifies those tools first;
the fixture also puts Unix sockets inside its own temporary directory.
Windows: additionally install `@embedded-postgres/windows-x64@18.4.0-beta.17`
in the QA-only prefix and omit `WALLET_QA_PG_BIN`. The runner
ignores DATABASE_URL, creates a fresh loopback-only temporary PostgreSQL cluster
and dedicated fixture DB, applies repository migrations **only there**, stops it
in `finally`, and never starts production index/watchers. Browser uses the real
production React bundle and real conversion/activity routes on that disposable
DB; unrelated read endpoints and credited deposit display rows are fixtures.
External browser network is denied. Reports/screenshots are ignored local QA
output and CI artifacts, not production delivery evidence.

Acceptance covers concurrency/replay, overspend, reserved funds, precision,
both directions, price failure/expiry/change, audit and destination failure
rollback, other-user/auth denials, lost-response recovery, owner-only activity,
responsive 1920/1440/1366/430/390/360/320 and partial history outage.

## Rollout boundary

This PR requires a coordinated backend + frontend release and final owner
approval. Until the new backend is present, conversion must remain unavailable
(no fabricated success), while ordinary deposit history continues with a partial
activity warning. Before any later rollout recheck exact main/head/CI, financial
review, database schema compatibility and actual active financial writers.
Existing migration/operational release procedures still apply. No server access,
settings changes, production migration/audit, real financial QA or automatic
rollout is authorized by this implementation task. OTC policy remains unchanged.
