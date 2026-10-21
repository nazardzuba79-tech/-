# Owner-approved one-shot browser QA control

Supersedes the inactive template and earlier local NOT_RUN instructions in README.
Owner authorization and CTO6313565744: exactly one free Ubuntu24.04 browser job.

Existing PR base: codex/stocks-private-topology-133cb85a-20261021,
42c6aca1f8ce1071b0447d0d8c7f39295b85569a. Remote review branch:
review/stocks-native-browser-qa-20261021. Only QA/control/docs are changed here.

The source candidate has not been published as an application branch. Opening a
PR containing its frontend/API diff against42c6 would run general CI. Instead,
reviewed-candidate.bundle delivers the exact approved534736a0 and its original
5ed0d70 application ancestry without changing the PR application tree. The job
verifies bundle153823 bytes/SHA2562a80000f043412eb65e908a2cf58453a3067bc166005b1e7144e35b53a5f43ee,
imports offline, checks out534736a0 in a separate source worktree, and verifies
application diff from5ed is empty. This follows the previous isolated build's
candidate-bundle mechanism; it does not change any trading code or source SHA.

The original534 runner is preserved in that bundle. The control runner differs
only by an explicit source-root option, a pinned Node22.23.3 check, and clearing chart hover/waiting two animation frames before the captured-candle pixel assertion. It remains
browser-unverified until the one run. Original local failure evidence stays labeled
historical. The active workflow is .github/workflows/stocks-native-browser-qa.yml;
the .template remains inactive historical preparation.

Playwright1.63.0 and full `install --with-deps chromium` are copied from the existing
chart-workspace recipe (original workflow unchanged). Official registry metadata
says Node>=20, compatible with22.23.3. No local package/browser-install experiment.

Trigger: exact owner label owner-approved-stocks-browser-qa, same repository,
exact head/base branch and base SHA, Draft PR, public repository, run_attempt1.
No push/synchronize/dispatch trigger. Standard github-hosted Ubuntu24.04 asserted.
No secrets/services/DB/Docker/provider calls. Dependency scripts disabled; Vite
bundles only the browser artifact. One browser invocation, no retries;15-minute
bound. Three-day evidence retention. Initial browser/install errors preserved.

Publication preflight JSON contains fresh sanitized provider findings. GitHub
workflow path/event inspection found no opened-event job matching this QA diff;
other label-triggered workflows fail their existing label/branch conditions.
No existing workflows or provider settings are changed. Artifact URL and verdict
will be posted to Issue558 after the single run. Browser dispatch proves the two
synthetic traders reach submitObserved and intentional stub503, not new financial
execution. Previous58/PG/TLS/Prisma/Docker evidence is not rerun.
