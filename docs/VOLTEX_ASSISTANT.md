# VOLTEX Assistant — review only

Base: `1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4` (`origin/main`, checked 2026-09-30).
Branch: `codex/voltex-assistant-ru`. No merge, deployment or production access.

## Contract

- One existing global `SupportWidget`, with Assistant and Specialist modes. All generated text, labels, greetings, errors and buttons are **Russian**, regardless of the website language or question language. User-authored text is not translated. Ukrainian aliases exist only in the deterministic intent matcher.
- Exactly 14 approved FAQ topics; no model, remote chat API, polling, cron, persistent conversation or account-status lookup. Unknown, mixed, unsupported, low-confidence or explicit human requests open an editable, unsent specialist draft.
- Answers use the current deposit minimum and OTC tier constants. `sourceRef` and `verifiedAtCommit` document each answer in code, never in the UI. Copy Trading copy does not promise automatic execution or future returns. No unsupported deposit/withdrawal SLA or recovery guarantee.
- Only fixed, tested application routes or the existing deposit modal can be opened. No action is derived from arbitrary text. Navigation/deposit actions may perform their existing page reads; those are explicit actions, not FAQ traffic.
- Question limit: 600 characters; conversation: last 20 turns, memory only. Logout/account change remounts the widget via the existing `SessionContent` key. Refresh also clears it. Clear-dialog removes FAQ history.
- Recognized secret-shaped input is not retained in conversation or copied to the specialist form. The specialist form also blocks detected secrets. This is a conservative pattern guard, not a universal DLP system: unlabeled arbitrary credentials cannot always be distinguished from ordinary text/TXIDs. Never request a password, OTP, seed phrase or private key.

## Network budget

| Action | Additional requests |
| --- | --- |
| Mount / open FAQ / all 14 answers / idle FAQ | 0 |
| Guest handoff / tab switch to Specialist | 0 |
| Signed-in first opening of Specialist | At most one existing `getMe` prefill |
| Subsequent Specialist openings in this mount | 0 profile reads |
| Explicit valid Send | One existing Cloudflare support POST |
| Human handoff without Send | 0 POSTs |

The original `supportForm.ts`, endpoint, Cloudflare Worker, email contract, limits, honeypot, rate limiting, 20-second deadline, double-submit protection and failure-with-draft behavior remain. Context is appended to the draft only when the user explicitly asks. No backend, Neon, wallet, balance, KYC, deposit, trading or notification business logic changes.

## Claude #357 reconciliation

Reviewed the open PR at `012d0b13ad4ff48b7f01a50223f183bba9059d67`, without merging or cherry-picking. Kept its useful 50px headset launcher, subject radio chips, compact name/email layout, character counter, status icons and explicit submit hierarchy. Existing terminal status-bar docking and its gold icon color remain. The new assistant has graphite/gold styling, self-hosted IBM Plex Sans, visible focus, Escape/focus return, reduced-motion support and visual-viewport sizing.

## Validation and limitations

- Focused Assistant/form/i18n/routing/mail compatibility: 171 tests. Worker contract: 19 tests. Backend TypeScript and production frontend TypeScript/build checked separately.
- Real-browser fixture: production bundle + unchanged Worker code + recorded mail binding. No real email, authentication, database, deposit or order. All non-loopback HTTP and WebSockets blocked.
- Browser verifies English site + Ukrainian input -> Russian replies; all 14 answers -> zero API/Worker calls; signed-in handoff -> one prefill and zero POSTs; explicit double-click -> one POST/one recorded email; provider refusal preserves draft. 25-second real idle and one-day fake-clock unit check add no support traffic.
- Desktop 1366/1440/1920; mobile 320/360/390/430; reduced-height keyboard emulation. No horizontal panel overflow, submit/composer remain visible. Physical iOS/Android keyboards have **not** been tested.
- Full frontend run on Windows: **3012 passed, 14 failed (11 suites)**. All 14 failures reproduce in the same 11 suites on a clean detached checkout of the base SHA. They concern existing Windows path/line-ending/SVG-byte assertions and Spot balance source assertions, not this widget. They are not waived or repaired by this PR; Linux CI remains authoritative. Details: `qa/support-assistant-20260930/verification.md`.
- Vite retains the existing >500 kB chunk warning. No bundle-budget or unrelated UI refactor here.

### Reproduce the isolated browser run

Build with `VITE_SUPPORT_ENDPOINT=http://127.0.0.1:8799/v1/support` and an **empty** `VITE_API_URL` (uses relative `/api/v1`). On Windows Git Bash, do not pass a bare `/api/v1` environment value: MSYS converts it into a filesystem path. Then run `node scripts/qa-support-form.cjs` with `QA_PLAYWRIGHT_MODULE` pointing at a disposable Playwright installation; optional `QA_OUT` chooses an evidence directory. The existing support-form PR workflow runs this gate and preserves its evidence. No deployment trigger was added.

Screenshots and measured request counts: `qa/support-assistant-20260930/`.
