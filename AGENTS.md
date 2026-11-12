# VOLTEX — shared Claude/Codex workflow

## Future listing presentation — owner requirement, 11 November 2026

All future listing implementations in the open presentation terminal use the ordinary
chart, countdown, watchlist and market-information layout. Add no visible DEMO,
SIMULATED, NO REAL TRADING, simulation/model warnings, translations, replacement
badges, icons, tooltips or footnotes. Admin controls use «Режим движения»,
«20 сценариев», «Предпросмотр». Preserve functional errors and scheduling states.
Keep truthful API provenance and every financial restriction. Public presentation
reads remain accessible. Never classify generated prices or activity as actual
venue quotes, real trades, proven investment returns or execution liquidity.
Preserve all previously published assets and history.
Run the production-component presentation tests and the full 20-regime terminal
browser suite at 1440/390, including reload/timeframe changes and zero financial
requests, whenever these surfaces or future-listing sources change.

After an original-regime listing opens, its ordinary Spot ticket is fully
interactive for every viewer, with all five order families, both conditional
execution variants, decimal drafts and percentage controls. Buy/Sell submission
and Enter return synchronously before permission checks, validation, state edits,
notifications or network calls. Preserve every entered value. Do not use disabled
buttons as acceptance evidence for these live regimes. Pre-listing restrictions
and execution on other pairs retain their existing behavior. Test real clicks,
Enter and unchanged drafts for every regime, viewport and access category.

This repository is edited by both Codex and Claude Code. The canonical working branch is `integration/claude-codex` until the owner explicitly promotes it to `main`.

## Before changing code
1. Read this file and `docs/AI_HANDOFF.md`.
2. Work from the latest `integration/claude-codex`; do not start from stale `codex-test`, `claude/*`, or `main` unless the owner explicitly asks.
3. Inspect recent commits on the shared branch before editing an area another agent touched.
4. For visual-reference tasks, treat the owner's approved ZIP/archive as the visual source of truth. Preserve newer real-data, routing, security, accessibility, and functional behavior unless the reference explicitly requires a functional change.

## Ownership is temporary, not exclusive
- If another agent is already changing the same files, do not independently rewrite them from an older base.
- Prefer a small follow-up commit on the shared branch after reviewing the prior agent's result.
- Never resolve a conflict by blindly taking `ours` or `theirs`. Reconcile intent: preserve both the approved visual target and the newer working behavior.

## Required handoff after every task
Append a short entry to `docs/AI_HANDOFF.md` containing:
- agent name (Codex or Claude)
- date/time if available
- task/area
- commit SHA
- files materially changed
- what was intentionally preserved from the other agent
- unresolved mismatches / next recommended step

Keep entries factual and concise. Do not claim tests or browser QA that were not actually run.

## Branch discipline
- Shared integration: `integration/claude-codex`
- `main` remains release/stable until the owner says to merge.
- Old agent-specific branches are historical inputs, not the place for new work.
- New work should be committed to the shared integration branch or a short-lived branch created from it and merged back immediately after review.

## Conflict rule
When visual and functional changes overlap, functional correctness wins temporarily, then visual parity is reapplied on top. Never delete working data/API behavior merely to make a screenshot match.
