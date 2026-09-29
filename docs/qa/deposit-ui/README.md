# Deposit picker and address UI — review evidence

## Scope and diagnosis

Started from fresh main `08e4af19594d16421ad9814608916dd0e1c368a5`; rebased onto `48f9522ccb717439bc1d22cdf5cabd97fb774b7f` after unrelated Admin Users PR #321 landed. No production access or writes in this task.

The exact reported single mouse-click failure did **not** reproduce in the original mounted Wallet component at 1440/390/320 or reduced height: BTC → USDT selected USDT. We do not claim its cause was proven.

A related, deterministic interaction failure **did** reproduce: focus USDT while BTC is selected → parent render → Enter leaves BTC selected. The original shared Modal's `[open, onClose]` focus effect runs again for Wallet's inline callback and steals focus; the Select's fresh `options` dependency also refocuses the selected option. `baseline-results.json` and `baseline-focus-loss.png` record the original result. `scripts/repro-deposit-picker.cjs` mounts the original component from the pinned Git base and removes its temporary fixtures afterwards. The equivalent mounted scenario now passes for both entrypoints in `scripts/qa-deposit-ui.cjs`.

## Implementation

- Header and Wallet manual-catalogue entrypoints mount the same `DepositCatalogueDialog`. Scoped styles and focus lifecycle; global Select/Modal unchanged.
- Full-name/ticker asset rows, distinct local icons, local search, explicit network selection. One catalogue-derived `assetId:networkId` destination, no transient mixed labels/address.
- Neutral asset/network warning, full selectable address, 48px gold copy action, locally generated QR. Clipboard success is conditional on resolution and guarded against a selection/unmount race. Future nonempty memo remains separate; empty TON memo is absent.
- Flag-OFF treasury/minimum behavior remains in the original legacy components. No storage, auth, financial, trading, balance or production configuration changes.
- All 22 new strings localized in seven languages; existing locale fingerprints preserved excluding only explicitly named new keys.

## Validation

| Check | Result | Evidence |
|---|---|---|
| Existing deposit/catalogue/auth/localization suites | 149/149 PASS, 9 suites | Dedicated catalogue CI; local Jest output |
| Mounted Header + Wallet interactions | 133 assertions PASS | `browser-results.json` |
| Widths/height, mouse/touch/keyboard/focus | 1440×1000, 390×844, 320×568, 1440×480 PASS | Same report and screenshots |
| Clipboard failure and late completion | PASS, no false success | Mounted browser fixture |
| QR after USDT network switch | PASS, independently decoded by jsQR | Mounted browser fixture |
| Real router/service with synthetic store and auth | 9 integration scenarios PASS | `integration/browser-results.json` |
| Disabled/unconfigured, future memo, changed-address reopen | PASS | Both browser runners |
| Backend/frontend TypeScript and production bundle | PASS | Build output; Vite reports external outDir and a 504.37kB main chunk warning |
| Browser errors/external icon or QR requests | 0 | Mounted fixture report |

### Request accounting

One existing public `GET /api/v1/deposit-catalogue` per open, still through Render. No browser→Cloudflare migration. Manual retry adds one GET.

Selection/search/copy/QR: **0 extra API requests**. Actual 60.1 seconds idle: **0 requests** for each entrypoint. Public catalogue route: **0 auth/Neon calls, 0 financial writes**. Existing service tests explicitly forbid Prisma/financial access; backend source is unchanged.

The full Wallet integration cold open also made seven existing background page requests (8 total, only 1 catalogue request). These are separately recorded and are not attributed to Deposit. The integration harness's Admin edits affect an in-process synthetic store only.

## Interactive local preview

From `frontend`, run Vite with `VITE_MANUAL_DEPOSIT_CATALOGUE=true` and `VITE_API_URL=/api/v1` on port 4262. Open:

`http://127.0.0.1:4262/qa/deposit-preview.html`

This page mounts the actual Header and Wallet entrypoint components and supplies synthetic catalogue responses. It is not imported by the application entrypoint or included in the production build. Never send funds to fixture addresses.

Run browser checks with `QA_PLAYWRIGHT_MODULE`, `QA_JSQR_MODULE`, `QA_PNGJS_MODULE` pointing at installed Playwright/jsQR/pngjs (or install them in the default module resolution path):

```
node scripts/repro-deposit-picker.cjs
node scripts/qa-deposit-ui.cjs
node scripts/qa-deposit-catalogue.cjs
```

CI starts the local preview, executes these checks with external requests blocked, and uploads evidence. It never deploys.

## Screenshots

- [Asset list: USDT selected, BTC unselected](wallet-assets-usdt-selected.png)
- [ERC-20 / TRC-20 selector](wallet-networks.png)
- [Address and successful copy](wallet-address-copy.png)
- [TON without empty memo](wallet-ton.png)
- [Mobile 390](wallet-390x844.png)
- [Compact mobile 320](wallet-320x568.png)
- [Short viewport and scrolling](wallet-list-1440x480.png)
- [Actual Wallet page integration](integration/customer-desktop.png)

Equivalent Header screenshots are also included.

Merged: **NO**. Deployed: **NO**. Production addresses changed: **NO**. Balances changed: **NO**. Neon catalogue access added: **NO**. Blockchain monitoring added: **NO**. New Deposit polling added: **NO**.

### CI follow-up
VOLTORA listing CI on the first review head failed because its browser assertion hard-coded September while the fixture now schedules October 1 (current time + 48h). The same assertion exists on clean main. Corrected only the harness to compare the actual fixture UTC day/month/hour/minute; no VOLTORA runtime or listing change. Re-ran its isolated browser QA at 1440/430/390/360/320: PASS, zero writes/errors/overflow. Deposit runtime and its screenshot evidence are unchanged by this follow-up.
