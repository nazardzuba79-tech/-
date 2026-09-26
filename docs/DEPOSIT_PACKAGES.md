# Deposits: accumulated packages, manual approval only

Owner policy, 2026-09-26. Supersedes `DEPOSIT_ADMIN_APPROVAL.md` (one-transfer
admin credit, including below the minimum) and `DEPOSIT_MINIMUM_ACCEPTANCE.md`.

## Rules the server enforces

- Minimum for a credit: **300 USD** per *package* = one user + one asset + one
  network, the exact sum of that user's proven, network-final, uncredited transfers.
- A transfer below 300 is stored and waits for a top-up. It never expires and is never deleted.
- Reaching 300 only makes the package **reviewable**. Nothing credits automatically:
  not discovery, not the watcher, not a client claim, not a confirmation count.
- The only credit path is `POST /admin/deposit-packages/confirm` (an authenticated
  ADMIN). It is refused below 300; no override exists in the UI or the API.
- A credit books the whole approved package in **one transaction**. That transaction:
  - locks the rows in id order;
  - re-checks each row's revision;
  - creates a `DepositBatch` with a unique idempotency key;
  - marks every transfer `CREDITED`;
  - applies one balance increment for the exact total;
  - writes one `DEPOSIT_CREDITED` audit per transfer and one `DEPOSIT_BATCH_CREDITED`;
  - pays the existing 5% referral per transfer.
- Before that transaction, every transfer is re-proven on chain, outside any DB
  transaction: allowlisted contract, recorded treasury recipient, exact amount,
  SUCCESS receipt, finality and confirmations. A proof older than 5 minutes at commit is refused.
- The package is fingerprinted: ids, revisions, amounts and owner. Any change
  between Preview and Confirm returns `PACKAGE_CHANGED`, so the admin must review
  again. A newly arrived transfer is never added silently.
- Same idempotency key again (double click, retry after timeout) returns the first
  result. A second admin, or an overlapping confirm, gets `ALREADY_CREDITED`.
- USDT/USDC/DAI/USD count 1:1 **as a minimum-evaluation policy**, not as a market-rate
  claim. Other assets need a non-stale price fetched within 2 minutes. If the price is
  unknown or old, the package goes to «Требует уточнения»; it never passes by default.
- Amounts are exact decimals. `299.999999` is below 300.

## Ownership (attribution)

- A shared treasury address does not identify the sender. Transfers stay **unattributed** until an admin uses
  «Привязать к пользователю» (`POST /admin/deposits/:id/attribute`).
  - This is audited as `DEPOSIT_ATTRIBUTED` and never touches a balance.
  - Moving an attributed transfer needs an explicit reassign.
  - A credited transfer can never be moved.
- A client TXID claim (`POST /deposits/claim/:chain`) only stores a `DepositClaim` hint.
  - It makes no chain call and does not attribute or lock anything.
  - Several users can claim the same hash.
  - The answer is a neutral 202 with no amount.
  - It is capped at 50 claims per user per day.
- Old `CREDITED` transfers never count toward a new package.

## What clients see

- `/deposits/me` returns `CREDITED` transfers only.
- Pending amounts never reach balances, equity, trading, withdrawal or referral.

## «Игнорировать» (old wallet history, own transfers)

- **Where:** available on each transfer in «Непривязанные».
- **Reason is required:**
  - Историческая операция кошелька;
  - Мой собственный перевод;
  - Не является депозитом клиента;
  - Другое (with a note).
- **What it records:**
  - The row is **never deleted**. Hash, asset, chain, amount and timestamps are unchanged.
  - Written: `ignoredAt`, `ignoredReason`, `ignoredNote`, `ignoredByAdminId`, a revision bump and a `DEPOSIT_IGNORED` audit entry.
- **What an ignored transfer can do:** it leaves «Непривязанные» and its counter, and appears under «Игнорированные». It can never be attributed, join a package, become ready or be credited, and the watcher does not re-prove it.
- **Refused:**
  - CREDITED or batched transfers;
  - an attributed transfer that is part of its owner's active package (detach it first);
  - any other attributed transfer without an explicit `confirmAssigned`.
- **«Вернуть в очередь»:** ADMIN only. Clears the ignore fields and writes a `DEPOSIT_IGNORE_RESTORED` audit entry. No balance change, no credit.
- **Migration `20260926180000_deposit_ignore`:**
  - Additive only.
  - It marks as `LEGACY_IGNORE` the unattributed, uncredited transfers that were already hidden with the old feed's «Игнорировать» (`IgnoredIncomingTransfer`), so they do not reappear in «Непривязанные».

## Accumulation card (one user + one network + one asset, until credited)

Every component transfer is listed: amount, txHash, confirmations, block time and status. A later top-up is added to the card; it never replaces the first transfer.

| Transfers | Total | Remaining | Status |
| --- | --- | --- | --- |
| 15 | 15 | 285 | Ожидает доплаты |
| 15 + 100 | 115 | 185 | Ожидает доплаты |
| 15 + 100 + 185 | 300 | 0 | Готов к проверке — «Проверить и зачислить 300 USDT» |

After the manual credit, every component is CREDITED. The package moves to «Зачисленные» as one card with its transfers, the balance is increased exactly once, and a repeat confirm credits nothing.

## Counters

| Tab | Counts |
| --- | --- |
| Непривязанные | active, not ignored, unattributed transfers |
| Ожидают доплаты | **packages** below 300 |
| Готовы к проверке | **packages** at 300 or above, not yet approved |
| Игнорированные | ignored transfers |

## States in Admin → Пополнения (derived, not stored)

| Tab | Meaning |
| --- | --- |
| Непривязанные | proven or observed, no owner yet |
| Ожидают подтверждений сети | owner known; not proven, not final, or too few confirmations |
| Ожидают доплаты | package below 300 |
| Готовы к проверке | package at or above 300; «Проверить и зачислить» |
| Требуют уточнения | failed/foreign transfer, amount mismatch, or no valid price |
| Зачисленные | credited packages (latest 30 batches) and pre-package credits |
| Игнорированные | not client deposits; kept, restorable |

## Deposit watcher (USDT / TRC20 only)

- **Daytime schedule, Europe/Kyiv** (owner, 2026-09-26; replaces the fixed 6-hour cadence). Off by default: an admin turns it on with «Включить автопроверку».
  - The day's first scan runs when an admin first opens Admin → Пополнения at or after 07:00 (`POST /admin/deposit-watch/open`), once per Kyiv day.
  - Automatic slots at **12:00, 16:00 and 20:00**, configurable with `DEPOSIT_WATCHER_SLOTS`. Only slots between 07:00 and 22:00 are accepted.
  - **No automatic scan 22:00–07:00, and no night catch-up.**
    - A slot missed while the API slept runs later the same day, before 22:00 and before the next slot.
    - Otherwise the next daytime admin-open or slot continues from the checkpoint.
  - **Dedupe:** an automatic or admin-open trigger within 45 minutes (`DEPOSIT_WATCHER_DEDUPE_MINUTES`, clamped 30–60) of any successful scan does nothing (`NOT_DUE`), and counts that slot as done.
- **No push, email or other notification.** The owner's wallet app (Trust Wallet) is the real-time source.
- **Manual controls, always available:**
  - «Проверить новые поступления»: one bounded scan now, even at night or while automatic scans are off.
  - «Проверить TXID»: prove one transaction and store it.
  - They share the cursor and the lease, so there is never a duplicate concurrent scan. Neither credits or attributes anything.
- **What it can do:** read the chain, store observations, prove them and refresh finality.
- **What it cannot do:** it has no credit, attribution, balance, referral, withdrawal or signing path. It never receives an admin identity.
- **The schedule is enforced by the service**, whoever triggers it. The answer is `NOT_DUE` with a reason: `NIGHT`, `BEFORE_FIRST_SLOT`, `SLOT_DONE`, `ALREADY_TODAY` or `RECENT_SCAN`. This costs one state read and no provider call.
- **In-process timer:** one timer aimed at the next slot, and it is unref'd. It does no work between slots.
- **Optional external trigger:** `POST /api/v1/internal/deposit-watch/tick` with `Bearer DEPOSIT_WATCHER_TOKEN`.
  - It covers slots the API slept through.
  - The route is 404 while the token is unset.
  - The token is accepted nowhere else, and the same schedule rules apply.
- **Checkpoint:** `DepositWatchCursor` per network + treasury address + token contract, stored in Postgres.
  - Scan windows are fixed: `[scannedThrough − 10 min, min(+24 h, now − 2 min)]`.
  - Pages are read oldest first: 200 per page, 10 pages per run.
  - A page's rows and the cursor advance commit in one transaction. A crash re-reads at most one page;
    duplicates collapse on `(chain, txHash)`.
  - A new window opens only after at least 60 s of new time.
  - The first scan of an address backfills 7 days, bounded; any backlog continues on the next run.
- **Proofs:** only new, unproven or unfinalized rows are proven, oldest first, at most 20 per run.
  The chain head is read once per run. Finalized rows are never re-proven.
- **Provider trouble:** outage, 429 with Retry-After, or a malformed page stops the run.
  - The cursor stays in place and the error is shown to the admin.
  - It is never reported as "no deposits".
- **Concurrency:** a DB lease prevents concurrent scheduled and manual runs.
- **Address changes:** every treasury address is kept in `TreasuryAddressHistory`.
  - Old addresses keep their cursor.
  - Transfers to them stay provable.

### TRON proof

- The node, not an indexer, answers `/walletsolidity/gettransactioninfobyid`.
  If the transaction is not solidified yet, `/wallet/gettransactioninfobyid` answers instead, with `finalized=false`.
- The receipt must be `SUCCESS`.
- Transfer logs are decoded here. The emitting contract must be the allowlisted mainnet USDT
  `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` with 6 decimals, and the recipient must be the checked treasury.
- Several matching logs in one transaction are summed into one transfer.
  Identity stays `(chain, txHash)`, so a legacy credited hash can never be re-created or re-credited.

### Measured, local fixture (`scripts/qa-deposit-packages.cjs`, not production)

| Trigger | Provider calls | SQL statements | Financial writes |
| --- | --- | --- | --- |
| Slot 12:00, nothing new (2 treasury addresses) | 2 | 29 | 0 |
| Slot already done / night / paused | 0 | 6 | 0 |
| Slot within 45 min of another scan (dedupe) | 0 | 7 | 0 |
| Admin open 07:05 with 1 new transfer | 4 | 34 | 0 |
| Manual scan with 5 new transfers | 8 | 54 | 0 |

A normal day is at most 4 automatic scans: the admin open plus 3 slots, all in daytime.

## Other networks

ETH/BSC/BTC/SOL/TON keep their existing verifiers:

- Their transfers are stored via «Проверить TXID» or «Проверить ленты других сетей» (on click only).
- They are credited through the same package confirmation.
- They are **not** covered by the watcher.
- Their "finalized" flag means only that confirmations ≥ the configured minimum.

## Release / rollback

- **Migration** `20260926150000_deposit_packages_and_watcher` is additive only: new nullable or defaulted
  columns on `Deposit`, plus new tables. No existing row, balance or credited deposit is rewritten.
- **Legacy rows:** uncredited rows start unproven (`verifiedAt` null). The watcher or «Проверить TXID»
  proves them before they can join a package.
- **Rollback:** redeploy the previous commit. The extra columns and tables are ignored by the old code.
  Do not drop them while any `DepositBatch` exists.
  Note that the old code allows the one-transfer credit this change forbids.
