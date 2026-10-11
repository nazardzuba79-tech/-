# Integration gate: Desktop Futures PR #503 + #504

Source: #504 head `9e2d0ff0d0b275804adaf788609007dbdd852cfc` with #503 header-only change `83a899ee6cb9c3b70156f2153239b01e11fbd33b`. No changes to APIs, order processing, balances, DB, mobile, or Hetzner. Both original PRs remain independent.

Merged content:
- `FuturesBybitParity.css`: all 15 indicators, drawing rail 56px from #504; only global header 48px from #503.
- `FuturesFigmaDesktop.css` and `qa-futures-figma-desktop.cjs`: the unchanged design plus 48px check from #503.
- `docs/evidence/futures-header-48-20261010/`: full #503 report and screenshot evidence (original files retained).
- `docs/AI_HANDOFF.md`: retains #504 entry and provenance. The #503 entry lives in the full original evidence README; avoid simultaneous overlapping edits to the 1.4MB handoff.
- `qa-futures-chart-ux.cjs`: add a combined-run 48px header + chart-height check at 1366/1440/1707/1920. The same 121+ checks already include 15 real indicators, RSI hide/show panes, price scale white preview/persist, rail collapse and Spot/CFD sanity.

Expect 48px header and plot heights 468/600/600/780. Check order book 286px, ticket 300px, drawing rail 56px, no overflow in 7 locales, Spot/CFD/mobile unaffected, financial command paths unchanged.

Do not merge into main until this exact-head combined PR has green typecheck/build, full frontend CI, the new combined Playwright QA, and relevant other workflows. Cloudflare Pages main deployment may occur automatically after approved merge; Hetzner backend must remain unchanged.
