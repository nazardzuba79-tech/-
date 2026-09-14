# Private trading review — 2026-09-14

Base: `e5ae1e4f62815a396662e268ffbba20d40b176be`, fetched again before final review.
Branch: `codex/private-trading-replay`. No merge or production deployment.

## Validation

- Backend TypeScript/build: passed. Collector TypeScript/build: passed.
- Prisma client generation: passed. Additive migration applied successfully to
  the isolated Neon test branch, never production.
- Final frontend TypeScript and production build: passed (5,768 modules).
- Private backend/model/provider/runtime/API plus shared demo-balance tests:
  197 passed in the full candidate run, no failures. All 12 opt-in PostgreSQL
  integration cases separately passed in bounded batches on the test branch.
- Final frontend follow-ups: 100 tests passed across four focused suites,
  covering private forms/cards, route splitting, reference book and Futures
  preservation. This follow-up includes CSS-only direct-entry dependencies,
  centered dialogs, authenticated card links and PNG delivery compatibility.
- Full candidate: 211 suites; 183 passed, 26 failed, two skipped. Tests:
  3,154 passed, 88 failed, 29 skipped; 363.72 seconds.
- Pristine exact-main baseline: 202 suites; 175 passed, 26 failed, one skipped.
  Tests: 2,926 passed, 88 failed, 23 skipped; 405.612 seconds.
- Exact new failure identities: **0**. No additional suite-level errors and no
  missing baseline suites. No successful baseline test was changed to skipped.
  The full comparison predates the final frontend export/style follow-up;
  those changed paths were subsequently revalidated by the 100-test run and
  the final production build. Full raw reports remain in ignored `outputs/`.
- Exact assertion names, report hashes and skip transitions:
  [private-trading-suite-comparison.json](private-trading-suite-comparison.json).

## Actual browser workflow

Preview: `http://127.0.0.1:4220/__qa/start` on this computer. This loopback-only
test entry creates a session on the dedicated test database for the pinned
owner. It is not a production sign-in shortcut or a remotely accessible URL.

1. Allocated 1,000 USDT from the owner's existing test-clone demo balance.
2. Calculated and confirmed a historical BTCUSDT Long, 10x, with 200 USDT
   scenario capital, entry requested at 2026-09-14 06:00 UTC. Actual next-bar
   model entry was 06:01 UTC at 77,586.214140, quantity 0.012. Verified result
   was frozen at 08:14 UTC: net 1.3080554844072 USDT, displayed ROI 1.40%.
   The historical row survived reload and backend restart; its 200 USDT escrow
   stayed separate from live demo capital.
3. Previewed and confirmed an actual-quote private Market Long, 10x,
   quantity 0.012, entry 77,852.800000. Closed 0.006, verified remaining 0.006,
   then closed the rest. The row moved to History with frozen net P&L
   -2.231194650000000000 USDT and displayed ROI -2.38%.
4. Placed a non-crossing Limit Long at 60,000, quantity 0.016; it appeared in
   Open Orders with zero fills. Cancelled the remainder; open orders returned
   to zero and available capital returned to 797.77 USDT (after the live loss).
5. Private copy-history showed the live and historical results in effective
   time order, with scenario totals separate. No public history was modified.
6. Created immutable live and historical result cards. The protected direct
   card URL loaded the original snapshot. Logging out made both private entry
   and the card URL redirect to normal login; restoring the test session
   restored access.
7. Desktop 1920x1080 and narrow 1100x900: full book height, no page overflow,
   no clipped sampled book prices; ticker identities remain visible. Mobile
   390x844: no page overflow, internally scrolling position table, accessible
   form, centered result dialog within viewport.

The PNG artifact below is the **exact browser-generated PNG**, read from the
rendered image's data URL and saved without rerendering: 2400x1520, PNG magic
and dimensions verified, visually inspected. The Save action completed after
reauthorization; this in-app browser did not expose a native download event or
an OS download file. Therefore native download-manager behavior is not claimed
as verified here. The ordinary download anchor and exact-byte conversion are
covered by focused tests. Chrome was unavailable to this automation session.

- [Historical result PNG](private-trading/VOLTEX-BTCUSDT-historical.png)
- [Desktop position screenshot](private-trading/terminal-desktop.png)

## Scope and remaining limits

The flag is off by default; owner ID, ADMIN role and current session are checked
server-side for reads, actions, jobs and cards. The pilot supports four active
contracts and 20 combined positions/orders on one backend instance. Live quote
freshness is five seconds; the 60-second reviewed consent is not a stale-quote
execution permission. A fresh confirmation quote must remain inside the frozen
quantity, price and spending bounds.

Historical execution is a documented next-bar model with mark-based risk,
fees, funding and explicit ambiguity/gap rejection. It is not an assertion of
exact Bybit tick-by-tick execution. Current instrument tiers/funding interval
are a versioned model assumption, not a fabricated historical entitlement.
Historical capital remains escrowed in this version; gains are never credited
to live or public balances. USD is unavailable without a verified conversion
snapshot. See [model](../private-trading-model.md) and
[operations](../private-trading-operations.md).

Real-money balances, production matching, Futures/CFD formulas, public Copy
Trading and follower execution remain unchanged. Existing demo-balance updates
were made atomic specifically to prevent concurrent allocation overwrites.
Production migration, activation and release remain outside this review.
