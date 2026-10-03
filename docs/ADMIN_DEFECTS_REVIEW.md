# Admin practicality — 1. Confirmed interaction defects

Review only. Based on main `7d9ee6fc6bfe76badaac680313e9728e5abd3550`. No merge, deployment, production connection or database migration. Independent of menu #399, sessions #400 and listings #401.

## Reproduced before implementation

| Trigger | Before | Corrected behavior |
| --- | --- | --- |
| Cancel withdrawal rejection prompt | Still posted rejection with undefined reason | Existing dialog: Cancel, Escape and Close issue no mutation; displays exact amount, recipient and the existing balanceHeld consequence |
| KYC read pending / rejected | Empty array rendered as no applications | Loading / error / retry / confirmed empty / stale last confirmed data |
| User A response arrives after route B | Replaces B with A | Per-account key and session ownership, transport abort and late-response rejection |
| User detail 500/offline/hanging request | Endless skeleton; error ignored | Bounded 15-second read, explicit error, retry; background failure preserves confirmed data; 401/403 clears it |
| KYC decision click / document 500 | Immediate write; failed read treated as missing document | Identity/reason confirmation, zero writes on cancellation, missing only after confirmed 404; protected blob lifetime follows account and mounted viewer |
| Address save succeeds, subsequent read fails | Success represented as save error; confirmed table removed | Separate write receipt and refresh error; last confirmed table retained, edits locked until revision is re-read |
| Back from OTC request | Filter and page reset | Same mounted list retained, hidden list reads suspended, current page refreshed on return |

## Verification

Nineteen baseline failing assertions were captured before fixes in four local logs under `output/admin-practicality/`. Final selected regression run: **88 tests / 7 suites passed**. Frontend TypeScript passed. The tests exercise rendered React components using synthetic identities and requests, including double clicks, uncertain responses, cancellation, timeout and session changes.

No withdrawal policy, balance arithmetic, reserve, credit, OTC fulfillment, password vault, password column or login implementation changed. Shared API module remains unchanged; abortable Admin read adapters are isolated in `adminReadApi.ts`. Writes are not automatically retried. Catalogue and OTC fixes use existing mutation/revision mechanisms.

Subsequent stacked reviews add bounded read APIs, measurements and workflow presentation. This first PR does not claim that pagination, all-page browser QA or the complete owner request is finished.
