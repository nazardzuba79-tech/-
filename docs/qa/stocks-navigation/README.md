# Stocks navigation follow-up

Review-only navigation change on PR #471, based on 8b28fdeef56823f348b2b24f01080e070e2c52a0.

Stocks is a single item in the shared Trading submenu (Spot, Futures, CFD, Stocks and indices). Existing Futures top-level shortcut remains. Mobile Trading opens the same markets; bottom navigation still has four buttons. Stock routes, build flag, API, service/storage, crypto logic and locale dictionaries are unchanged. Existing stocks.title/closed keys provide all seven translations.

Built-bundle QA: 49 menu views, seven locales at 1920/1440/1366/430/390/360/320; all within viewport. HomeHeader checked in seven locales. Actual menu navigation Spot → Futures → CFD → Stocks → Spot at 1920 and all four mobile widths, browser Back/Forward, direct /stocks and instrument reload. Terminal computed classes/colors/panel styles and route pair/market state matched before/after Stocks. This verifies retained route state, not a new promise to preserve unsubmitted form input across unmounts. Support launcher cannot cover the stock menu choice. Zero page errors and zero write requests. All requests restricted to isolated fixtures; external traffic blocked.

Relevant navigation/header regressions: 86 tests passed. TypeScript and Vite build passed (existing large-chunk warning). Browser driver: scripts/qa-stocks-navigation.cjs; stock-enabled loopback build required. See report.json and screenshots.

Prior stock data licensing and resource-performance blockers remain unchanged. No merge/deploy or production writes.
