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

- PostgreSQL integration tests require an explicitly opted-in disposable loopback database. No local PostgreSQL/Docker runtime was found; these tests remain skipped, not passed. Transactional concurrency still requires that run before release.
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
