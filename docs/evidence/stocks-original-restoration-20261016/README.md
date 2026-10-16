# Stocks archive catalogue and matching terminal proposal

The owner approved `project-bolt-sb1-aivkklb7 (1).zip` as the catalogue reference. The unchanged 71,273-byte archive has SHA256 `88e8c25fd764c962ce1a80ff4492cfb9a78933a8796ad59136acd95019eb8576`; it remains in the recovered local `stocks-original-reference-20261016` folder with its 32-file extraction manifest. Archive fixtures, generated prices, router, dependencies and incomplete detail chart were not transplanted into the application.

## Review proposal — not approved for publication

- `/stocks` restores the cream/white/gold catalogue composition: compact header, index cards, country/favorites tabs, search, exchange/currency filters and responsive table. Sector information is explicitly unavailable because the current API does not provide it. Index cards have no invented prices or sparklines.
- `/stocks/:instrumentId` keeps the existing trading ticket, positions, account/history, markers, chart and mobile tabs. The proposed change uses the archive palette and header, while retaining the Professional B terminal geometry. The archive did **not** define this Buy/Sell screen: this is a separate proposal awaiting the owner's visual approval.
- Canonical source IDs are preserved. Selecting a row opens that exact instrument; favorites keep the existing storage key. The catalogue reads only the existing authenticated catalogue endpoint and does not start history, quote demand or financial writes. Session fencing, hidden-tab polling and manual bounded overload recovery remain enforced.
- Existing local-host/build gates stay intact; no public production activation. Trading calculations, permissions, engine, SQLite durability and history are unchanged. The preceding separate commit adds only the non-executable pre-demand readiness explanation documented in `../stocks-quote-readiness-20261016/README.md`.

## Visual evidence

| Screen | Archive / previous | Restored proposal |
| --- | --- | --- |
| Catalogue desktop 1440 | [Archive](reference-catalogue-1440.jpg) | [Preview](catalogue-1440.jpg) |
| Catalogue mobile 390 | [Archive](reference-catalogue-390.jpg) | [Preview](catalogue-390.jpg) |
| Terminal desktop 1440 | [Previous Professional B](terminal-before-1440.jpg) | [Proposal](terminal-1440.jpg) |
| Terminal mobile 390 | [Previous](terminal-before-390.jpg) | [Chart](terminal-chart-390.jpg), [trade form](terminal-trade-390.jpg) |
| Terminal desktop 1920 | Existing large-chart geometry retained | [Proposal](terminal-1920.jpg) |

Screenshots use the existing isolated two-trader fixture launcher, a new dedicated fixture directory and a separate build. The two instruments, synthetic observations and accounts are explicitly labeled fixtures. This preview is not a claim of real provider availability, real funds or an owner/Xenia production-wallet adapter. Unavailable catalogue prices remain dashes. No order was submitted during the visual review; the amount field was filled only to inspect the existing total display. Earlier fixture ledgers and frozen load evidence were preserved.

Local URLs while the launcher is running:

- `http://127.0.0.1:4460/__stocks_fixture/` — select an isolated fixture account.
- `http://127.0.0.1:4460/stocks` — catalogue.
- `http://127.0.0.1:4460/stocks/BYBIT%3AAAPLXUSDT` — terminal.

## Validation

- Focused frontend: **126 PASS / 6 suites**, no skips. Includes unchanged provider-branding gate, catalogue read isolation/session fencing/recovery, routing, viewer protection, mobile settings and readiness boundaries.
- Final complete frontend: **4504 PASS / 278 suites**, zero failures/skips/runtime errors, no open handles; 264.342 s.
- Frontend and backend TypeScript: **PASS**.
- Production frontend build: **PASS**; existing >500 kB shared-chunk warning retained.
- Stocks server regression: **227 PASS**; strict workflow guard: **14 PASS**.
- Browser: **20 geometry views**, catalogue at 320/360/390/430/768/800/1440/1920, terminal chart at 320/360/390/430/1366/1440/1707/1920, trade form at 320/360/390/430. No page-wide horizontal overflow, no chart/ticket overlap. Desktop chart heights 480/612/606/786 px; bottom account panel 112/112/120/120 px. Search, favorites, exact row routing, Market/Limit form switching, mobile tabs and settings checked; no captured browser warnings/errors.
- Two confirmed presentation defects were repaired: light-theme input contrast and the mobile settings button opening a hidden panel. Hidden-tab manual catalogue recovery also now cancels correctly and remains latched for an explicit retry.
- First complete frontend run retained **4503 PASS / 1 FAIL**: the new identity allowlist was in presentation source. It was moved unchanged into the existing pure `stocksIdentity` contract module; the branding guard and all its assertions remain untouched. Final complete rerun is recorded in `validation.json`.

No new performance/capacity test, merge, deploy, production operation or data-rights change. Existing constrained-load/crypto-coexistence failures, unverified Hetzner capacity, MOEX block and uncleared commercial redistribution rights remain release gates. Review the light terminal proposal before integration approval.

## Final mobile support correction

Final screenshot review found the pre-existing global Support launcher over the mobile price-scale corner. The Stocks-only <=767 px stylesheet now reserves a 64 px bottom dock and confines catalogue/terminal scrolling above it. Shared Support/Nav, desktop layout, account logic and permissions are unchanged; leaving Stocks removes the overrides.

[Before obstruction](terminal-support-overlap-before-390.jpg) / [corrected chart](terminal-chart-390.jpg) / [corrected order form](terminal-trade-390.jpg). Additional [25 geometry checks](support-dock-geometry.json) cover chart/trade/account/catalogue at 320/360/390/430, scrolling and a 390x500 viewport: no visible control overlap or horizontal overflow; minimum launcher clearance 10 px. Support close/composer remain within the viewport at 390x844 and 390x500. Exiting to Futures restores body block/visible and root padding 0 px; desktop also retains root padding 0 px. Build PASS, 6194 modules, existing shared-chunk warning retained. No order or support message submitted.

The 4504-test full frontend and CFD/Chart/Support/OTC CI results on parent a5488c26 passed before this CSS-only correction; final exact-head CI is reported on the PR, not inferred from that parent.
