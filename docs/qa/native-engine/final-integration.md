# Native Futures engine integration

This is an integration/review candidate, not a release or a production trading certification.

## Sources and scope

- Fresh-main integration base: `87f1d8370f7d529dc2e4b9450abd6f537a5527a7`.
- Reviewed PR #123 source: `94b58a81473b0e2db671f1a3d14f5df18000400f`.
- Reviewed R11/R12 WIP source: `6da0eb7095b4da75077658cd293eea564eac1520`.
- Integration branch: `codex/native-futures-engine-final`. No merge of the source branch, rebase, production database mutation, merge to main, or deployment.

Selected native-engine changes were ported and reconciled with current main. Main's collateral eligibility switch, closed customer-error display boundary, account binding, ordinary Futures layout, Wallet, Copy Trading, chart drawing tools, order-book rendering/cadence and schema are retained. The three other reports in this directory describe the PR #123 input; their older measurements are not final-candidate evidence.

## Execution and accounting contract

- Live MARKET OPEN and CLOSE consume validated server-side depth, share consumption by contract/provider timestamp/side/price, and record actual filled quantity. The market order's unfilled remainder is cancelled (IOC); a protective close's unfilled remainder remains pending.
- A resting live LIMIT requires executable observed opposite-side depth. A last-price crossing alone supplies no fill. Its settlement is the explicitly named `MAKER_MODEL` at the limit price, with the observed level retained as `sourcePrice`. This is a maker model, not evidence of an exchange queue fill.
- Live TP/SL emits a zero-cashflow, zero-fee `TRIGGER`. Only subsequent observed-depth fills settle money. Partial fills retain one action ID, quantity and trigger evidence; new protection cannot overwrite a pending exit. The original position table projects this state as `TRIGGERING`.
- Decisions journal the pre-execution portfolio observations and collateral, not just the selected contract. A changed valuation persisted by a card/refresh also receives journal evidence. An expired MARKET decision is retried once from fresh observations, then rejected without commit if still expired.
- Fill-margin admission uses unclamped equity minus margin and reserves. A display-level clamp to zero never creates available collateral.
- Isolated liquidation uses the declared bankruptcy/insurance settlement, with excess losses and fees recorded as shortfall rather than charged to another risk bucket. Cross liquidation settles at mark, explicitly labelled `MARK_SETTLEMENT`; neither is labelled as an observed order-book fill.
- Funding retains the existing fixed-rate, boundary-mark model. Historical entries retain their declared OHLC path model. Historical marks/risk are separated from live observations, including when both families hold the same contract.
- Checkpoints fingerprint ordered instruction bodies, including prices, context, collateral and books. New instructions record a stable history-resolution anchor. Legacy journals that never recorded their original decision inputs cannot retrospectively prove those missing inputs.
- Ordinary-account submit behaviour is preserved. A named reduce-only close carries the exact position ID and risk bucket, disables the opposite closing side, and stays a LIMIT when LIMIT was selected. The table now carries the server's actual reduce-only flag.

## Regression evidence

`nativeJournalFinal.test.ts` covers:

1. Admission on fresh observations of another exposed contract, with no write on refusal.
2. Pending stop remainder cannot be replaced by new TP/SL.
3. Historical/live positions sharing a contract retain separate marks.
4. Later completed candle extremes cannot trigger/liquidate a live position.
5. Partial stop fills at 99/98/97, exact fees/PnL, one action ID and replay across a closed minute/another service instance.
6. Card valuation/collateral persistence reproduces from the journal.
7. Same command ID with altered decision data invalidates a checkpoint.

The R11/R12 suites compare FULL, CHECKPOINT and stored state, cover empty/insufficient depth, cancellation without fill, source price versus maker settlement, shared snapshot consumption and partial pending exits. Existing lifecycle/invariant suites exercise weighted entry, partial/full close, fees, Cross/Isolated, funding, leverage, exact reduce target, races, 30-contract exposure and ledger reconciliation.

## Browser verification

Ran the built ordinary `/futures` page through the local review server on loopback port 4231, with a disposable fixture repository. Opened a 0.02 BTC MARKET long, placed a 0.01 BTC reduce-only LIMIT at 55,000, verified the pending row, cancelled it, and closed the position by MARKET. After fixing the dropped reduce-only flag, repeated the open/LIMIT flow and observed the checkmark in the table. Inspected 1440×1000 and 390×844 renderings; returned the viewport to its default afterwards.

This harness supplies synthetic account/chart/valuation fixtures while the unchanged order-book widget can still read public market data. The resulting displayed prices are not a production feed-consistency test. No real trades were placed. The harness is not a PostgreSQL integration test.

## Release limitations

- PostgreSQL integration tests require an explicitly opted-in disposable loopback database. They were skipped locally; the subsequent PostgreSQL 16 CI run executed them successfully (see CI evidence below).
- The full baseline is already red. Exact failing test names are compared rather than presenting a red suite as green.
- Modelled historical outcomes, maker fills, fixed funding and insurance settlement remain distinguishable in the data model. They are not evidence of real executed performance.
- No merge/deploy is authorized by this integration task.

Final build, suite comparison and benchmark measurements are recorded in the accompanying validation artifacts.

## Final validation (2026-09-19)

| Check | Result |
| --- | --- |
| Focused engine and native frontend helpers | 707 passed, 20 skipped, 0 failed; 38 passed / 2 skipped suites |
| Full candidate suite | 4303 passed, 130 failed, 37 skipped; 278 suites |
| Full pristine integration-base suite | 4115 passed, 132 failed, 37 skipped; 263 suites |
| Exact new assertion failures / suite-load failures | 0 / 0 |
| Backend TypeScript and emitted build | PASS |
| Collector TypeScript and emitted build | PASS |
| Frontend TypeScript and production build | PASS |

Both full-suite checkouts had a production frontend build, so build-dependent tests executed on both sides. `failure-comparison.json` contains the exact normalized failing test names, suite-load failures and two fixed isolated-margin tests. Three `sourcePrice` assertions were subsequently strengthened from string-type checks to exact observed prices; the final focused run above includes these stronger assertions.

Main advanced during validation to `03fc3e6c68fc926ae9eb11e85ba2d8046628cf72` (PR #147, order-book refresh/reconnect UI). The full baseline above is explicitly **87f1d8370f7d529dc2e4b9450abd6f537a5527a7**, not this later commit. The new main changes were inspected and do not overlap the engine files; they were not merged into this reviewed candidate. Revalidate the eventual merged result before release.

### Reproduce the checks

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node node_modules/typescript/bin/tsc --project tsconfig.collector.json
npm --prefix frontend run build
node node_modules/jest/bin/jest.js --runInBand --testPathPattern='src/private-trading|nativeChartExits.test|nativeCommandLane.test|nativeReduceTarget.test|nativeFuturesTerminal.test'
node node_modules/jest/bin/jest.js --runInBand --json --outputFile=full-suite.json
```

Use the same installed dependency versions and build the frontend before the full suite in the pristine base checkout as well. Compare normalized repository-relative file path plus the exact Jest `fullName`; also compare failed suites with no assertion results. Do not interpret skipped database suites as transaction/concurrency evidence.

## Performance evidence and limit

`benchmark.md`, `benchmark-pr123.json` and `benchmark-candidate.json` record the same script run sequentially on PR #123 and this candidate: Node 24.21, `BENCH_FRAME=1`, 120 operations at each of 1/10/20/30 contracts, zero simulated upstream latency. No full test suite was running during these measurements. They include compute and an in-memory repository; they exclude PostgreSQL, network and browser latency. The fixture loop does not yield enough for its event-loop monitor to sample usefully, so its reported zero is not responsiveness evidence.

| Contracts | OPEN p95 before → after | CLOSE p95 before → after |
| --- | --- | --- |
| 1 | 10.35 → 11.54 ms | 9.07 → 9.86 ms |
| 10 | 16.05 → 32.37 ms | 15.11 → 31.26 ms |
| 20 | 82.17 → 84.48 ms | 67.06 → 82.28 ms |
| 30 | 101.64 → 130.02 ms | 101.79 → 117.49 ms |

All measured OPEN/CLOSE calls filled with zero partial/rejected outcomes in this sufficiently liquid fixture; all command-failure maps were empty. At 30 contracts the candidate writes about 1.95 MiB of account-plus-revision payload per final commit versus 1.18 MiB before. Extra deterministic observations increase journal size and cost: this is not a performance improvement claim.

The initial 1000-operation run completed all four PR #123 scenarios. The candidate completed 1 and 10 contracts (OPEN p95 101.25 / 163.36 ms), then terminated during the 20-contract scenario with `Allocation failed - JavaScript heap out of memory`. Its in-memory repository retains every full immutable revision and receipt, multiplying history storage; this run does **not** establish whether the same failure occurs with PostgreSQL. It also does **not** pass the long-run capacity check. The bounded rerun above is explicitly a replacement measurement, not a claimed 1000-operation pass. Before release, measure retained-history memory/storage and latency with the actual repository and an explicit capacity budget.

## PostgreSQL and merged-result CI

Implementation commit: `086c3833acbf4806f59c3818fe8d62162da2d831`. Follow-up test-only commit: `3b46624076fdd2214dd8411f4b38bb7bdac9ae26`.

The first PostgreSQL run found an outdated race-test assumption that the two OPEN instructions were adjacent sequence numbers. R11 correctly inserts OBSERVE between them. The follow-up keeps the original race, revision, quantity and idempotency assertions, additionally checks the complete journal is contiguous and explicitly checks OPEN → OBSERVE → OPEN with sequence 1/3 for the two OPEN commands. No engine behaviour was changed for this test.

[Private trading and replay run 35445957999](https://github.com/nazardzuba79-tech/-/actions/runs/35445957999) passed: **21 suites / 626 tests, zero failed or skipped**, including both database integration suites on disposable PostgreSQL 16 and the actual P&L dialog/PNG browser step. Backend, collector and frontend builds also passed there. This CI tested GitHub's temporary merge result `90f28872c27fd60c8d5f33326eb76958de56287c` (head `3b46624076fdd2214dd8411f4b38bb7bdac9ae26` + main `03fc3e6c68fc926ae9eb11e85ba2d8046628cf72`). It is a CI merge ref, **not** a merge into main.

All eight PR workflows on that code head passed: private trading/replay, native engine/browser, native account access, customer-error wording, private reference UI, Futures bottom-panel geometry, Futures ticker labels and CFD terminal. This adds relevant coverage of the newer main; it does not turn the local full-suite baseline into a full comparison against that newer main. Long-run capacity remains a draft release gate.
