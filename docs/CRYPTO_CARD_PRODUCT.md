# Crypto Card eligibility and application contract

This document describes the implementation prepared on
`codex/crypto-card-product-final` on 2026-09-05. It is not evidence of a
backend deployment, a database migration being applied, or a card being issued.

## Authoritative eligibility

`src/services/CardApplicationService.ts` calculates eligibility on the backend:

```text
verificationApproved && (qualifyingDepositUsd >= 5000 || qualifyingTradingVolumeUsd >= 50000)
```

Verification is mandatory. Either financial condition is sufficient; both
are not required. Missing, invalid or blocked accounts cannot submit a request.
The frontend displays this result and does not grant eligibility from its
marketing copy, selected product, local storage or client-supplied balances.

The sources are:

| Field | Persisted source and definition |
| --- | --- |
| Verification | `User.kycStatus === 'APPROVED'` |
| Qualifying deposit | Sum of this user's `Deposit.amount` where `status === 'CREDITED'`, valued in USD |
| Qualifying trading volume | Sum of `Trade.price × Trade.quantity` for fills where the user is maker or taker, valued from the pair's quote asset into USD |

The deposit definition is cumulative credited deposits, not the current
spendable balance or a requirement to keep funds locked. Pending deposits,
Wallet display holdings, synthetic performance, referrals and pending orders
do not count. No artificial 30-day, 90-day or other trading-volume window is
introduced: the query includes all persisted history for the account.

Both real Spot settlement (`src/services/OrderService.ts`) and Futures
settlement (`src/futures/FuturesPositionService.ts`) write executed fills into
`Trade`. Demo execution writes to the separate `DemoTrade` model and is not
queried. A fill counts once for each legitimate participant, never twice for
one account; fills with identical maker and taker user IDs are excluded by
the query and again during calculation. This exclusion is not a claim of
cross-account wash-trade detection.

Existing limitation: `FuturesPositionService` catches errors around its
`Trade.create` call. The card service can only value fills actually persisted
in `Trade`; it cannot recover a missing historical fill or certify a complete
execution history independently of that source. This pass does not change
Futures settlement behavior.

## USD valuation and precision

`src/index.ts` injects only the existing
`WalletPortfolioService.pricesFor(assets)` quote method. It does not inject
or use the operator's presentation holdings. The quote method uses the
existing Kraken-backed crypto prices, the existing USD/stable-asset peg
convention and the existing configured EUR/USD provider.

The ledger stores asset quantities and execution prices, not historical USD
conversion marks. Consequently these totals are explicitly **current USD
valuations**, not historical deposit-date or fill-date USD amounts. The
response and stored eligibility evidence identify the bases as
`CUMULATIVE_CREDITED_DEPOSITS`, `ALL_PERSISTED_EXECUTED_TRADES` and
`CURRENT_USD_QUOTES`, with an `asOf` timestamp for the calculation. Non-USD
valuations may change when market prices change.

Decimal-derived values are summed using `BigNumber`. Threshold comparisons
happen before display values are rounded down to two decimal places; an
amount just below a threshold cannot round into eligibility. Negative,
non-finite or otherwise invalid values do not qualify. Zero quantity needs
no quote. An unavailable or invalid price contributes no qualifying value
and marks that financial route incomplete. A known qualifying amount may
still independently satisfy the OR condition. Price lookup failure never
creates eligibility from an unknown amount.

## Authenticated API and persisted request

- `GET /api/v1/card/application/me` returns the authenticated user's
  eligibility and their existing application, if any.
- `POST /api/v1/card/application` accepts only
  `{ "product": "TITANIUM" }` or `{ "product": "BLACK_SIGNATURE" }`.
  Extra fields, including a claimed user ID or eligibility flag, are rejected.
- Both routes use the existing bearer/session authentication and take account
  identity from `req.userId`, not a URL ID or submitted body. Responses carry
  `Cache-Control: no-store`.

`CardApplication` stores a unique `userId`, product, ID, submission timestamp,
`SUBMITTED` status and an eligibility snapshot. Creation also records
`CARD_APPLICATION_SUBMITTED` in `AuditLog` within the same transaction.
`SUBMITTED` means a real application was recorded. It does **not** mean a card
was issued, activated, funded, shipped or assigned delivery details. No issuer,
card-payment, freeze or shipping API is fabricated here.

The service obtains external quotes before a database transaction, then
re-reads account status, ledger inputs and existing applications inside a
serializable transaction. A new unquoted asset stays non-qualifying. The
unique account constraint and bounded whole-transaction retries for
serialization/unique conflicts prevent duplicate applications. Repeating the
same product returns the original request without replacing its ID, product,
timestamp or stored evidence. Trying to replace it with the other product
returns a conflict. Existing requests remain records of their submission,
not a fresh claim of current eligibility.

Ineligible new submissions return a denial; verified accounts whose
financial eligibility cannot be valued receive an unavailable result.
Unexpected errors do not turn into success. The frontend controller prevents
duplicate in-flight submits and reloads the server state after an uncertain
POST outcome, so a lost response does not fabricate or duplicate a request.

## Legacy interest is not an application

`User.cardWaitlistJoinedAt` is retained unchanged. The authenticated legacy
`GET /card/waitlist/me` remains read-only historical evidence. Legacy
`POST /card/waitlist/join` returns `410 CARD_APPLICATION_REQUIRED` and performs
no write. The current card page uses the application endpoints instead.
There is no backfill converting old interest timestamps into applications.

## Migration and review boundary

`prisma/migrations/20260905193000_card_applications/migration.sql` is additive:
it creates the two enums, `CardApplication`, its unique account index and
foreign key, plus maker/taker account indexes for the eligibility history
query. It does not delete or modify existing customer records. This task
prepares and validates the migration; it has **not applied it to a database**.
Deploying a write-capable backend requires an explicitly authorized migration
and backend rollout. Standard index creation should be scheduled with the
target database's size and locking constraints in mind.

The existing `voltex-review` service on `claude/review-ready` is a frontend-only
isolated visual-review environment, not a write-capable staging backend.
Its `/card` passes `reviewOnly`; account checks and application submissions
are disabled, and the existing network policy blocks account/API writes.
A successful review frontend deployment cannot prove that this migration or
the backend application flow was deployed. See `docs/STAGING_REVIEW.md`.

Main, production services and production databases are outside this pass.
