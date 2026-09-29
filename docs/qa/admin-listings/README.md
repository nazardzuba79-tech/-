# Admin → Listings — local end-to-end evidence

`node scripts/qa-admin-listings.cjs` (see the header for the build command). Local only:

- **Real:** the market-edge Worker bundle in workerd (SQLite Durable Object on disk), the Render admin router with the real `requireAuth`/`requireAdmin` and `CloudflareListingStore`, the Render trading registry and Spot gate, and a production frontend bundle in Chromium.
- **Synthetic:** the two accounts (a fixture user table instead of Neon), other `/api/v1` reads (fixtures), and all addresses and prices. External requests are blocked.

The pair `QRB/USDT` exists nowhere in the code. It is created in the admin form (Kyiv wall time, logo upload, automatic seed), previewed, and published through the dialog. It is then opened from Markets on the same bundle and the same Worker process, with no rebuild or redeploy, and it opens at the configured minute. `report.json` lists the 17 checks and the request counts. The first check covers the half-finished rollout states: Render settings missing, and a token the Worker refuses. Both show «Листинги не подключены» with Create disabled.

| File | What it shows |
|---|---|
| `not-connected-unset-1440.png`, `not-connected-mismatch-1440.png` | Rollout not finished: a clear "not connected" state, never a success |
| `create-form-1440.png` | Create form: time zone and UTC echo, logo, seed mode, Spot switch |
| `preview-1440.png` | Private Preview of the draft |
| `publish-dialog-1440.png`, `published-list-1440.png` | Confirmation and the published version |
| `markets-prelisting-1440.png` | Markets row with its Europe/Kyiv time |
| `trade-prelisting-{1440,390}.png` | Countdown in the ordinary Spot terminal |
| `trade-live-{1440,390}.png` | After the opening: price, chart, book, order form |

These screenshots are not production evidence. Nothing here touched production, Neon or any balance.
