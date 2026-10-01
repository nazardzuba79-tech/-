# Arbitrage design review — 2026-09-30

Implementation: `20ff86afbb568be00287bc8825888c6180ebadf7`.
Base: `1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4` (current main after OTC #358).
Review only: no merge, deploy, Render/Neon mutation, financial operation or new dependency.

## Automated validation

- New model suite: **61 passed**, independent arithmetic reconciliation, invalid
  inputs, raw-state preservation, selection, sorting/filtering and tiny prices.
- Mounted UI suite: **5 passed**, real React components; mocked shell only.
  Validates live updates, blank input, reset, search, filters, sorts, budgets,
  details, focus trapping/restoration, inert/scroll cleanup and tiny-price display.
  Unexpected console errors fail these tests.
- Shared shell suite: **7 passed**, real Nav, ticker does not mount, cleanup and
  wallet/deposit/profile/auth contracts retained.
- Combined focused pass including current-main OTC and language-chunk checks:
  **109 passed / 5 suites**, no skipped tests.
- `frontend/node_modules/typescript/bin/tsc -b`: **PASS**.
- `frontend/node_modules/vite/bin/vite.js build`, `VITE_API_URL=/api/v1`: **PASS**.
  Existing shared bundle >500 kB warning remains; no new dependency.
- Final complete frontend run: **2,981 passed / 10 baseline failures**, 177
  suites (170 passed / 7 failed), zero skipped or todo. Its Windows baseline
  comparison is recorded in `frontend-tests.json` and `windows-baseline.json`.

The seven existing slash-sensitive suites have identical **73 passed / 10 failed**
results on clean main and the review branch. All seven test files are unchanged.
Nine normalized failure bodies match exactly. The remaining CSS inventory failure
also includes the new, properly scoped arbitrage stylesheet, while still failing
its existing forward-slash path comparison. No assertions were skipped or weakened.
Full baseline/branch logs and Jest JSON are retained locally in the sibling
`work/arbitrage-baseline-qa` directory. Linux PR CI is the independent full-suite gate.

## Browser evidence

Built app served by `scripts/serve-arbitrage-review.cjs`, loopback-only port 4271.
Synthetic `/me` identity; no real login, upstream proxy, write handler or database.
CSP permits only local resources and refuses off-origin connections.

| Viewport | Visible scenario presentation | Horizontal overflow | Editable text |
| --- | --- | --- | --- |
| 390 | Cards, then calculator | None | 16 px |
| 768 | Cards, then calculator | None | 16 px |
| 1366 | Table left, calculator right | None | 13 px |
| 1440 | Table left, calculator right | None | 13 px |
| 1920 | Table left, calculator right | None | 13 px |

Exact DOM measurements: [responsive.json](responsive.json).
Screenshots: [390](width-390.jpg), [768](width-768.jpg),
[1366](width-1366.jpg), [1440](width-1440.jpg), [1920](width-1920.jpg).
Modal: [desktop](detail-1440.jpg), [mobile](detail-390.jpg).

Verified through actual browser controls:

- Budget 25,000 survives BTC → ETH; calculator gives +207.43 USDT, while the
  table still explicitly uses 10,000 and +79.97 USDT.
- Search ETH, result filters, LINK keyboard selection and negative result
  (-89.21 USDT) work. Empty budget stays empty, shows an error and `—`, and
  disables the breakdown action. Reset restores the BTC scenario.
- Table/card detail uses its own 10,000 budget. Mobile calculator detail uses
  its edited 50,000 budget. The triangle strategy opens its distinct explanation.
- Modal focuses its close button, Tab/Shift+Tab wrap, Escape closes, and the
  document background is inert. The 390px dialog scrolls internally.
- Navigate to `/legal/about`, browser Back, and reload `/arbitrage`: page remounts
  normally, with no retained arbitrage reader. Shared Nav still contains
  Banking & Earn; no market ticker exists on the Arbitrage page.
- Scoped text-fill override fixes inherited near-white calculator numbers;
  duplicate select arrow removed without global style changes.
- No JavaScript warning/error reported by the preview tab during the final UI pass.

The existing global support button and mobile navigation remain unchanged and
can overlap content at their fixed viewport positions in full-page captures.

## Network / lifecycle

Recorded [network.json](network.json) across the whole review session:

- Arbitrage module: **0 API requests**, zero fetch/socket/EventSource/poll timers.
- Shared shell: **5 GET `/api/v1/me`** across loads, reload and navigation.
- Other-page shell: **2 GET `/api/v1/market/display/spot-snapshot`** occurred only
  while visiting `/legal/about`; the local host refused them (no upstream).
- Local JS/CSS/globe/font requests are static assets, not market polling.
- Controlled-clock tests cover a hidden day, return, unmount, another day and
  revisit with zero module network/timers; shared Nav additionally covers an hour.

Limit: this in-app browser reports `document.visibilityState = visible` even for
an unselected tab. Actual OS/browser background throttling is therefore not claimed
as verified; hide/return behavior is covered with controlled DOM events and clocks.
No real account, deposit, support submission, market execution or production load
test was performed. Page content follows the supplied Russian copy; shared shell
localization is preserved, but translations of the new content are not added.
