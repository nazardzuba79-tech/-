# Header navigation — 2026-10-03

Local synthetic fixtures render the actual shared Nav, terminal Nav and HomeHeader components. No production API, account, infrastructure or financial writes were used. Network requests are intercepted; external traffic and WebSockets are blocked.

Validated 12 combinations: three header contexts × 1920 / 1440 / 1366 / 390 px. The existing breakpoint is preserved: below 1440 px the hamburger drawer contains independent Futures and Tools entries, with Trading and Knowledge Center disclosures.

- Futures and Tools remain direct root links (`/futures`, `/tools`).
- Trading contains exactly Spot and CFD.
- Knowledge Center links directly to `/academy`; its disclosure contains learning, knowledge base, FAQ and glossary. System Status is excluded.
- Checked keyboard open/Escape/focus return, CFD navigation, mobile drawer closing, dropdown viewport bounds, horizontal overflow and navigation/account-control overlap.
- Shared/terminal laptop spacing is compact; terminal Knowledge Center text remains visible even where the existing secondary-link rule hides Card/OTC.
- 70 focused Jest regression tests pass. Frontend TypeScript/Vite production build passes, with the existing >500 kB chunk warning.

Run Vite on `127.0.0.1:4288`, then `node scripts/qa-header-navigation.cjs` with Playwright available (`PLAYWRIGHT_MODULE` can identify a separate QA installation). The fixture HTML is not a production build entry or app route.

| Width | Shared app | Trading terminal | Homepage |
| --- | --- | --- | --- |
| 1920 | [Screenshot](app-1920.png) | [Screenshot](terminal-1920.png) | [Screenshot](home-1920.png) |
| 1440 | [Screenshot](app-1440.png) | [Screenshot](terminal-1440.png) | [Screenshot](home-1440.png) |
| 1366 | [Screenshot](app-1366.png) | [Screenshot](terminal-1366.png) | [Screenshot](home-1366.png) |
| 390 | [Screenshot](app-390.png) | [Screenshot](terminal-390.png) | [Screenshot](home-390.png) |

No merge or deployment performed.
