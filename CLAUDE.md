# VOLTEX — Claude collaboration rules

Claude Code shares this repository with Codex. The canonical working branch is `integration/claude-codex` until the owner explicitly promotes it to `main`.

Before editing:
- Read `AGENTS.md` and `docs/AI_HANDOFF.md`.
- Start from the latest `integration/claude-codex`, not from an older `claude/*`, `codex-test`, or `main` snapshot unless explicitly instructed.
- Inspect recent shared-branch commits in the area you will touch.
- Preserve valid Codex work already integrated. Do not replace it from an older Claude branch wholesale.

For visual reference tasks, the owner's approved ZIP/archive is the visual source of truth. Preserve newer real data, API behavior, routing, security, accessibility and interaction logic while reconciling the visual layer.

After every task, append a concise factual handoff entry to `docs/AI_HANDOFF.md`: agent, task, commit, material files, what was preserved from the other agent, and unresolved work. Never claim tests/QA you did not run.

If a conflict appears, reconcile intent rather than choosing `ours`/`theirs` wholesale. Functional correctness stays intact first; visual parity is reapplied on top.
