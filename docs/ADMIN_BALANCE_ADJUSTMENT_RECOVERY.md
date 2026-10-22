# Manual balance correction: original-operation recovery

This is an additive admin-only endpoint. The original `/adjust-balance` endpoint and its existing service method are unchanged for compatibility. New UI must use the receipt endpoint below; this does not retrofit idempotency onto old callers.

## Contract

`POST /api/v1/admin/users/:id/balance-adjustments`

```json
{
  "asset": "USDT",
  "amount": "-10.125",
  "reason": "Operator-provided correction reason",
  "idempotencyKey": "7f30c36e-3c3c-4c21-8d59-d3b53895b39f"
}
```

This corrects the ordinary **SPOT available** balance only. It does not touch reserved funds, demo balances, Futures/CFD, P&L, fee rules or order execution. Test-only assets remain prohibited on this ordinary balance path. The new endpoint refuses sub-column precision beyond 18 decimal places rather than rounding a requested correction.

An accepted request returns a durable receipt:

```json
{
  "status": "APPLIED",
  "operationId": "7f30c36e-3c3c-4c21-8d59-d3b53895b39f",
  "userId": "fixture-user",
  "account": "SPOT",
  "asset": "USDT",
  "amount": "-10.125",
  "reason": "Operator-provided correction reason",
  "availableBefore": "100",
  "available": "89.875",
  "locked": "7",
  "createdAt": "2026-10-03T10:00:00.000Z"
}
```

`GET /api/v1/admin/users/:id/balance-adjustments/:operationId` returns that same original receipt only to its creating administrator and for its original target user. Responses are private/no-store. A 404 (`RECEIPT_NOT_FOUND`) says that no committed, authorized receipt was found; it is **not** permission to issue a new key. An in-flight transaction may still commit. A retry of the original POST with the original key and identical intent safely waits for/returns the original result.

The key binds the administrator, target, canonical asset, exact signed decimal delta and trimmed reason. Reusing the key for different intent returns 409 `OPERATION_CONFLICT`. Equal decimals (`10`, `+10.000`) are equivalent. The service returns the original before/after amounts even after subsequent balance changes; it never substitutes the current balance into an old receipt.

## Transaction and compatibility

No schema migration or new service is needed. `AuditLog.id` (existing unique string key) is the operation UUID. `BALANCE_ADJUSTED` metadata retains the existing asset/delta/newAvailable/reason/actor fields and adds receipt version, original key, account, beforeAvailable and locked amount.

Within one existing PostgreSQL transaction:

1. Acquire a parameterized transaction-scoped advisory lock on a namespaced operation key.
2. Read the unique receipt; return it for matching intent or reject a conflict before touching the wallet.
3. Call the existing `mutateSpotBalance` without changing its conditional debit/upsert implementation.
4. Read the row protected by the mutation lock and insert the receipt atomically.

An audit insertion failure rolls back the balance change. There is no automatic transaction retry or external request. Different operation keys still use the existing atomic row mutation, preserving concurrent wallet changes. Receipt retention must remain durable; do not prune these audit IDs while a client could recover an operation.

The legacy mutation remains deliberately unchanged. The new router must be mounted and the new UI migrated together in the later narrow PR; a UI must not fall back to the old route after an uncertain new request.

## Executed isolated evidence

- Before implementation, replaying the old correction with the same supplied key changed 100 → 120 instead of 110; captured in `output/admin-practicality/balance-retry-red.log`.
- New service regression plus existing legacy correction tests: **21/21** pass (`balance-retry-unit.log`).
- `scripts/test-admin-balance-adjustments-postgres.cjs`: **10/10** real HTTP + Prisma + disposable loopback PostgreSQL checks pass (`balance-adjustment-postgres.json`): 401/403, 20 simultaneous same-key requests, 8 independent atomic corrections, old receipt after later changes, every bound-field conflict, administrator/target lookup isolation, actual dropped HTTP response after commit, signed debit/reserved preservation, invalid/insufficient requests, and database-triggered audit failure rollback followed by healthy API and successful recovery.
- Test database is newly initialized, migrated, populated only with synthetic records, and stopped in `finally`. No production URL or account was used.

These results do not authorize a merge, deployment or production correction.
