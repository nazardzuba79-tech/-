# PR #347 — terminal presentation and release review

## Handoff reconciliation — 30 September 2026

The append-only `docs/AI_HANDOFF.md` additions from this feature conflicted with the subsequently released Admin, VTA presentation and Copy Trading entries. The shared log is retained byte-for-byte from main `41cb5a1db321113be3018c65ed457409ca5be095`; the feature-specific handoff is indexed here rather than replacing those newer entries.

The complete original feature handoff, including every historical check result and owner follow-up, remains preserved in Git at:

- [Original feature handoff at reviewed head df28741](https://github.com/nazardzuba79-tech/-/blob/df28741bb5dbb5bb7e92b1e8f208f3bce6e4b98a/docs/AI_HANDOFF.md)
- [Original feature source](https://github.com/nazardzuba79-tech/-/tree/df28741bb5dbb5bb7e92b1e8f208f3bce6e4b98a)
- [PR #347](https://github.com/nazardzuba79-tech/-/pull/347)

This is documentation-only conflict reconciliation. No runtime file was selected wholesale from an older main. GitHub must still merge the current main and the feature changes normally, and the final combined source must pass CI before release.

## Feature scope preserved from Claude

- Futures-only chart settings: default green/red, classic white/orange and reversed presets; body, border, wick, background, grid, crosshair, watermark, volume and last-price line. Browser-local storage is normalized field by field. Price and order data are not changed.
- Futures opens on 120 bars. Volume follows the configured candle colours at 0.75 opacity and uses its own 0.8/0.2 pane split. Hiding volume returns its hidden series to pane 0. Existing drawings, position lines, RSI and MACD remain.
- Desktop Futures folds the heading into the toolbar and preserves the VOLTEX/TradingView switch. Phones retain their heading.
- Self-hosted IBM Plex Sans, restrained order-book depth fills, Bybit-shaped margin/leverage controls and 48px floating-label price/quantity fields. The balance transfer plus is removed; TP/SL controls and trading handlers are preserved.
- The latest original handoff records the owner's selection of tone 2, Bybit black. Earlier graphite and near-black alternatives were preview-only. This release review does not select another tone.
- The positions table gets an approximate USD line for USD/USDT/USDC quotes only. Engine amounts and ROI remain authoritative; non-dollar quotes are not relabelled as USD.
- Spot/CFD retain their separate presentation unless explicitly changed in their own already released PRs. In particular, current main's VTA connectivity/measurement and Spot button-colour corrections must remain.

## Additional review fixes — ChatGPT, 30 September 2026

- `d27284b768827abdae05d8c4a42398100276ba5a`: `ChartSettingsDialog.tsx` now discards an unsaved preview on component unmount, including pair or route changes. Cleanup after Ok preserves the already saved choice. Escape is contained and Tab/Shift+Tab wrap within the modal instead of navigating to the trading ticket. Focus is restored only to a still-connected opener.
- `60f619dc7658f1c4ab2a22b3b2e3c66781b94f0d`: added four actual React/JSDOM component regressions for unmount rollback, Ok persistence, keyboard containment and Escape/focus restoration. Translation and CSS loading are the only component harness stubs; tests do not call account or order APIs.
- These additional tests were not executed locally: this review runtime does not have the repository's React/JSDOM/Jest dependencies. Final-head GitHub CI is required. Do not report the original head's successful checks as checks of these later commits.
- No balances, ledger history, authorization, order execution, VTA lifecycle, NRX configuration, infrastructure settings or production secrets were changed by these review fixes.

## Release status at this commit

- Codex #351 was already merged while the review was in progress.
- Claude #350 passed all nine final-head PR workflows on `86e1ae204ac6ef68b95b643137e62c1ea812e3e4` and was merged as `41cb5a1db321113be3018c65ed457409ca5be095`.
- PR #347 is not yet released. Its new final-head CI, clean merge against current main, deployment and production checks remain required.

## Claude follow-up — 30 September 2026 (P&L cells exactly as Bybit)

Owner, with a Bybit screenshot: «розширити чуть панель, і там дублювати в USD»; then «Я не бачу щоб на байбіт пригушалось % прибутку … в точності як на байбіт».

This entry follows the reconciled layout above: the shared `docs/AI_HANDOFF.md` stays as main has it, and the feature log lives here.

- **`TerminalGraphite.css`, desktop ≥901px.**
  - The positions panel is `clamp(230px, 24vh, 262px)` instead of a fixed 230px. It is 262px on the owner's 2000×1090 screen and stays 230px at 1440×900 and 1366×768.
  - The folded (compact) panel is not touched.
- **`TerminalGraphite.css`, archive P&L cells.**
  - The figure, its unit, the ROI and the «≈… USD» line are all 13px/500, line-height 17px, opacity 1, in the one profit/loss colour. Before, the ROI was 12px at .85 opacity, the approx line 12px, and the unit .9em.
  - Realized P&L and its «≈… USD» line follow the same rule.
  - Presentation only; the figures are the engine's.
- **Test:** `terminalGraphite.test.ts` pins both rules.
- **Screenshot:** `pnl-vs-bybit.png` (Bybit vs this branch, fixture data).
- **Checks actually run** (local, fixture data, `LANG=en_US.UTF-8`), on this commit's tree, which includes `d27284b7`/`60f619dc`:
  - `npx jest frontend/`: 169/169 suites, 2876 tests PASS. That run includes `chartSettingsDialogLifecycle.test.ts`.
  - Frontend build: PASS.
  - Browser scripts, all PASS:
    - `qa-native-demo-browser` (full run and `NATIVE_QA_PNL_ONLY=1`)
    - `qa-futures-bottom-panel`
    - `qa-futures-visual-polish`
    - `qa-spot-cfd-terminal`
    - `qa-order-panel-refinement` and `qa-futures-tiny-price`, both run before the typography step
- **Still different from Bybit, left for the owner:**
  - Bybit shows the USDT figure to 4 decimals with no «+» on profits. VOLTEX keeps its 2 decimals and the sign, which existing guards pin.
- **Not done:** no merge, no deploy.
