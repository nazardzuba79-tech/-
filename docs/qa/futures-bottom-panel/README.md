# PR #138 — Futures bottom panel

## Scope

CSS-only production change in `frontend/src/pages/trade-terminal/TerminalAccountPanel.css`: the bottom tab strip, position table typography and row rhythm, empty-state centring, and a lighter leverage-tier heading. No component data, columns, tab handlers, trading engine, positions, balances, fees, P&L, liquidation, or order-book cadence is changed.

Author branch: `claude/futures-bottom-panel`, original commit `05d631cb38092a2766de9df4a8eb9bbc47cff793`.

## Author's original measurements

These are local fixture measurements from the original author head, not a production verification or proof for a later merge tree.

| Width | Row before | Row after | Heading before | Heading after | Table overflow after |
| --- | --- | --- | --- | --- | --- |
| 1920 | 50 px | 62 px | 36 px | 31 px | 0 px |
| 1664 | 64 px | 62 px | 36 px | 31 px | 0 px |
| 1440 | 77 px | 62 px | 51 px | 31 px | 0 px |
| 1366 | 77 px | 62 px | 51 px | 31 px | 0 px |

The tab row was restyled to a 40 px header, a one-pixel active underline, primary active text, secondary inactive text and quieter counts. Position headings are kept on one line with narrower gutters at smaller widths. Close controls are on one row; the empty state fills and centres within the available content area. The leverage-tier heading is secondary text on a transparent background.

## Integration review

The original branch predates PR #137 and appends to the same CSS and handoff files. The integration tree is based on fresh `main` at `3b5887f61a30932d015a6ef7312a7d233a87970d`. It preserves ALL of PR #137: the far-left instrument row, both search entry points, temporary chooser, and the standing rail ending above the positions panel. The bottom-panel CSS section is appended after the existing main stylesheet.

The original bottom-panel handoff is retained here instead of replacing `docs/AI_HANDOFF.md`, whose newer search-review record is preserved unchanged. The original author handoff remains accessible in the original commit and PR history.

A dedicated read-only CI job runs `scripts/qa-futures-bottom-panel.cjs` on the integrated tree and uploads newly generated screenshots and metrics separately from the author snapshots. The existing harness refers to the author's absolute Playwright installation path; CI supplies a symlink to its pinned, disposable Playwright installation. No test assertion is skipped or weakened.

## Verification boundaries

The original harness exercises empty and single-position fixtures at 1920/1664/1440/1366 and switches all five tabs. It does not exercise populated leverage tiers or a many-row position table. The existing native/browser and large-value jobs remain separate regression gates. Do not treat the original screenshots as screenshots of production or of the integration commit. Production deployment must be verified independently after an owner-authorized merge.

The order-book 30-second snapshot task and native engine PR #123 are NOT included.
