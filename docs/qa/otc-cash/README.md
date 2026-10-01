# Historical local fixture evidence

The committed screenshots and `result.json` in this directory belong to the
local implementation review published at `f148d0bccd5b946f95bf6805f18cf4d4a635257a`.
They are **not evidence that a later GitHub Actions run executed or passed**.
They are retained unchanged for design review, not uploaded as fresh CI artifacts.

Current CI writes to a new temporary directory per run/attempt. Download the
`otc-cash-<head SHA>-<run ID>-<attempt>` artifact from that exact head's workflow.
`run.json` records checkout SHA, run ID, attempt, timestamps and actual step
outcomes (including failures/skips). Logs and step JSON files are freshly created;
`jest-results.json` exists only if Jest produced results. `browser-*/result.json`
exists only after that browser run completes its assertions. Missing/skipped
evidence is never a passing result. Local browser reruns use ignored
`output/otc-cash/browser-*` directories rather than overwriting these files.
