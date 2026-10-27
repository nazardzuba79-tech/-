# History20 private Spot test: integration, activation and rollback playbook (dry run)

**Status: a plan only. Nothing here has been executed.** Every numbered step needs the owner's separate approval. The owner approved the private, test-only SIMUSDT design (PR #551, 2026-10-19). That approval does not cover merging, deploying, migrating, flipping a switch, funding a live account or any public exposure.

Code under review:
- PR #553, branch `claude/voltex-mobile-audit-7rpjni`, reviewed head `c28689dc`, base `main` `f81df788`;
- PR #555, the CFD QA weekend fix (`b387d4b6`; QA script only). #553 already carries the same commit as a merge.

The mode itself is described in `docs/HISTORY20_PRIVATE_SPOT_MODE.md`.

## 1. Switches (all off by default)

| Switch | Where | Effect when set |
|---|---|---|
| `HISTORY20_PRIVATE_TEST=enabled` | Worker `market-edge` | Admin may *start* (publish) a private test. Without it: `PRIVATE_TEST_DISABLED`. |
| `HISTORY20_PRIVATE_TEST=enabled` | Render API | Admission: the private gate, the synthetic sale, funding and `/api/v1/private-test/*` serve participants. Without it, all of them refuse. |
| `PRIVATE_TRADING_ENABLED=true`, `PRIVATE_TRADING_OWNER_ID` | Render (existing) | The owner is a participant only while both are set and the account is an unblocked `ADMIN`. |
| `PRIVATE_TRADING_TEST_USER_IDS` | Render (existing) | Comma-separated UUIDs, at most 100. Any invalid entry disables the whole list. Testers must be unblocked; their role does not matter. |

The guards that keep VHX/SIMUSDT away from real value do **not** depend on any switch. They are active as soon as the code is deployed.

## 2. Data-rights restrictions (`HISTORICAL_RIGHTS_UNVERIFIED`)

- A History20 window is never published as a public listing. The Worker and Render both refuse it, and the private exception does not change that.
- A private test serves only its participants. Every private response carries `rights: HISTORICAL_RIGHTS_UNVERIFIED` and the source fields from the pack: provider, asset, first/last date, licence.
- The History20 pack is not in the repository. It is loaded only from a local `HISTORY20_PACK_DIR`.
- Until a rights review clears a source, private tests should use synthetic or appropriately licensed series only. Its candles, prices and books must not be redistributed or shown publicly, including in screenshots or exports.

## 3. Merge order (dry run)

1. **#555 → `main`.** QA script only; independent of #553.
2. **#553 → `main` as a merge commit.** No squash, so the merged heads of #544, #546, #548 and #551 keep their provenance.
   - Mergeable `clean` at `f81df788`.
   - If `main` moves: merge `main` into #553 (merge commit, no rebase) and wait for exact-head CI.
3. **After the merge:**
   - `main` CI must be green;
   - #544/#546/#548/#551 can be closed as superseded (owner decision);
   - #552 stays a reference.

There are no migrations, no new dependencies and no schema change.

## 4. Deploy with every switch off (dry run)

1. Render API, then the frontend, then the Worker. `HISTORY20_PRIVATE_TEST` stays unset on both.
2. **Expected:** no user-visible change. The public catalogue stays as it is (on 2026-10-19, `revision 4`: `AITH/USDT` only).
3. **Read-only smoke checks:**
   - `/health`, and the public catalogue unchanged;
   - `GET /api/v1/private-test/markets` with the owner's token → **404** (switch off);
   - `GET /api/v1/market/test-assets/VHX07-SIMUSDT`, `/orderbook/VHX07-SIMUSDT`, `/market/ticker/VHX07-SIMUSDT` → **404**;
   - NRX and AITH pages unchanged; an ordinary Spot pair loads its chart and book;
   - browser network panel on `/trade` and `/markets`: no request to `/private-test/` for an ordinary user.

## 5. Production checks before any activation (read-only; **BLOCKED from the code session**: no production access)

1. **Worker listing store** (`GET /internal/listings`, admin bearer):
   - no draft or published listing other than a History20 window uses a symbol matching `^VHX\d{2}$`;
   - none is named `SIMUSDT`.
   - If one exists, its asset becomes refused everywhere once this code is deployed (fail closed). Resolve it before deploy.
2. **Database**, read-only; every query must return zero rows:
   ```sql
   SELECT asset, count(*) FROM "Balance"     WHERE asset ~ '^VHX[0-9]{2}$' OR asset = 'SIMUSDT' GROUP BY asset;
   SELECT asset, count(*) FROM "DemoBalance" WHERE asset ~ '^VHX[0-9]{2}$' OR asset = 'SIMUSDT' GROUP BY asset;
   SELECT pair,  count(*) FROM "Order"       WHERE pair  ~ '(^|/)(VHX[0-9]{2}|SIMUSDT)(/|$)' GROUP BY pair;
   SELECT asset, count(*) FROM "Deposit"     WHERE asset ~ '^VHX[0-9]{2}$' OR asset = 'SIMUSDT' GROUP BY asset;
   SELECT asset, count(*) FROM "Withdrawal"  WHERE asset ~ '^VHX[0-9]{2}$' OR asset = 'SIMUSDT' GROUP BY asset;
   SELECT action, count(*) FROM "AuditLog"   WHERE action IN ('HISTORY20_PRIVATE_TEST_FUNDING', 'HISTORY20_PRIVATE_SIMULATION_SOLD') GROUP BY action;
   ```
3. **Venue collision.** Check whether any venue VOLTEX prices from lists a ticker `VHX01`–`VHX99`, using its public symbol list. If one does, VOLTEX refuses that coin (no order, price or value). That is acceptable but should be known.

## 6. Activation (each step a separate approval)

1. Fix the participant list: the owner (as above) and the tester UUIDs.
2. Set `HISTORY20_PRIVATE_TEST=enabled` on the Worker and on Render.
3. **Admin → Listings**, on a History20 window:
   - choose «Приватный тест (SIMUSDT)»;
   - use a reserved ticker `VHXnn`; owner allocation stays 0;
   - set funding of at most 1 000 000 per asset;
   - preview, then «Запустить приватный тест».
4. **Verify:**
   - the listing is absent from the public catalogue;
   - `/api/v1/private-test/markets` lists it for the owner and each tester;
   - it answers 404 for another ADMIN and for an ordinary user.
5. **Funding**, per account:
   - run `node scripts/fund-history20-private.cjs --listing-id <id> --user-id <uuid>` (a dry run) and check the printed plan;
   - then run the same command with `--confirm`, once;
   - verify the AuditLog receipt `history20-funding:<listingId>:<userId>` and the balances: base and SIMUSDT credited, **USDT unchanged**;
   - a repeated `--confirm` must answer `applied: false`.
   - The script re-validates the listing's full configuration before any write, so a forged or stale store entry (funding above 1 000 000, an owner allocation, a non-reserved ticker, a replay) is refused with the Worker's own message.

## 7. Financial checks before testers trade

Record, per participant, USDT and BTC (`available + locked`) before funding and after every check below. All of them must stay unchanged.

| # | Check | Expected |
|---|---|---|
| 1 | Orders `VHX07/USDT`, `VHX07/BTC`, `USDT/VHX07`, `SIMUSDT/USDT` (owner and tester) | refused before any write |
| 2 | Withdraw VHX07 or SIMUSDT; transfer either to Futures; a purchase priced in SIMUSDT; OTC; demo top-up | refused |
| 3 | Another ADMIN: private reads; an order on `VHX07/SIMUSDT` | 404; refused |
| 4 | Owner ↔ tester on `VHX07/SIMUSDT`: LIMIT fill, cancel refund, STOP / OCO / TP on the model price | fills in SIMUSDT only. Per-asset totals across participants equal the funded totals. |
| 5 | Wallet | VHX07 and SIMUSDT show no USD value. Card volume unchanged. |
| 6 | Restart Render with resting private orders | the orders survive. Nothing fills or prices from a venue. |
| 7 | Worker unreachable: a Render restart (cold registry) and a stale registry | Rows 1–2 still refuse in both states. On a cold start the private pair itself is refused too, and the private list is empty. On a stale snapshot, participants may keep trading the private pair in SIMUSDT. |

## 8. Rollback

1. **Fast, no deploy:** unset `HISTORY20_PRIVATE_TEST` on Render and the Worker.
   - The private gate, sale, funding and reads refuse; no new test starts.
   - Funded VHX/SIMUSDT balances stay inert, because the guards are switch-independent.
   - This is also the only way to *stop* a running private test: the store has no retire or unpublish action.
2. **Code revert** (`git revert -m 1 <merge>`) is safe **only while production holds no VHX/SIMUSDT `Balance`, `DemoBalance` or `Order` row** (the queries in §5).
   - Once anything was funded, keep the guard: `src/shared/history20PrivateSymbol.ts`, `isSimulationSettled` and its refusal sites, the `spotPriceSource` / valuation / public-route 404s.
   - Revert only the wiring, or rely on the switch. Without the guard, a funded VHX balance on a cold registry is the 50-USDT exploit again.
3. **No migration**, so no database rollback. Funding receipts stay in `AuditLog` for audit.
4. **Not implemented:** a post-test cleanup of inert VHX/SIMUSDT balances. The admin adjustment refuses these assets by design. Removing them would need a separate, reviewed and audited procedure.

## 9. Monitoring during a test

- `AuditLog` actions `HISTORY20_PRIVATE_TEST_FUNDING` and `HISTORY20_PRIVATE_SIMULATION_SOLD`.
- Per-asset sums of `Balance` for the private base and SIMUSDT: they must not exceed the funded totals.
- Participants' USDT/BTC: no movement caused by the test.
