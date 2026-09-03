# VOLTEX — shared Claude/Codex workflow

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
