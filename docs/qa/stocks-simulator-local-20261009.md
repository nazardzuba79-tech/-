# Stocks simulator — local review evidence, 2026-10-09

Fresh-fetched main: `cb5559db24c7c8ba4cae75997a1c9145a193151f`. Isolated implementation branch: `codex/stocks-simulator-source-check-20261009`, based on PR #481 `1cc0e7a5a5c3f7a56c26cc7d0ebbbf913588cfe6`, preserving its PR #471 design. Main and unrelated worktrees were not changed. New simulator changes are local; they are not published in either existing PR. No merge, deploy, production migration or real financial operation.

## Results

- 31 Node engine/provider/HTTP/persistence tests passed. They cover USDT and USDC, non-parity conversion, weighted entry, fees, PnL, reservations, cancellation, freshness/session admission, idempotency, concurrency, failed persistence, editable audited test capital, and rejection of real financial/API routes or browser-injected quotes.
- 24 existing Stocks tests passed across stockOrderPanel, stockWidgetLifecycle, stocksPresentation and stockNavigation.
- TypeScript and enabled simulator Vite build passed. Final flag-off Vite build passed with zero `/__stocks_simulator/` endpoint strings in generated JS. Existing unrelated >500 kB chunk warnings remain visible in build logs.
- Official TradingView charts displayed on desktop and mobile. The simulator never reads their data. AAPL real minute quotes came from the public Twelve Data trial. NVIDIA/USDC was shown with execution disabled and a key-required error. NVIDIA/USDC accounting was tested with explicitly identified unit fixtures, not claimed as a real-quote browser trade.

## Actual browser cycle (AAPL/USDT)

Fee 0, explicit fixed-test-rate 1 USD per test USDT, initial test cash 10,000 USDT:

| Action | Shares | Actual execution price | Evidence |
| --- | ---: | ---: | --- |
| Market buy | 1.5 | 335.05 | Open position cost 502.575; cash 9497.425 |
| New verified quote | — | 335.125 | Unrealized PnL +0.1125 |
| Sell 50% | 0.75 | 335.00 | Realized PnL -0.0375 |
| Sell remaining, mobile 390 px | 0.75 | 335.00 | Closed position, cumulative PnL -0.075 |
| Submit buy Limit at 100, then cancel | 0.2 | No fill | 20 USDT reserved, then fully released |
| Submit buy Limit at 400 | 0.1 | 335.04 | Price improvement, filled at verified quote |
| Submit sell Limit at 300 | 0.1 | 335.04 | Position closed; no additional PnL |

Result: 6 orders (5 filled, 1 cancelled), 5 fills, zero open shares, zero reserved cash, **9999.925 USDT**, **10000 USDC**, realized **-0.075 USDT**. Page reload and service restart preserved this exact accounting and history. The settings panel then saved the same balances with a separate audit record; it did not rewrite fills/PnL. Fee/conversion controls remain locked after the first order.

The deterministic test suite also verifies a genuinely waiting limit executing on a later eligible quote and refusing stale crossings; the browser crossed immediate limits plus cancellation using actual market quotes.

## UI and isolation evidence

Desktop viewport 1440×1000: chart rect x=288..1092, ticket x=1096..1426, so no overlap. Document width 1440. Mobile viewport 390×844: document width 380 (no horizontal overflow); positions/history and ticket stack with independent readable controls. No browser warnings/errors observed in the captured session.

The captured trade-cycle network trace contained 133 requests with no loading failures. All 9 observed POSTs targeted `127.0.0.1:4436/__stocks_simulator/` (orders/cancel/refresh); no external order POST was observed. The later balance-setting action used the same local namespace. Read-only quote requests are made by the standalone local server, not a broker or production API.

Live review URL: `http://127.0.0.1:4436/stocks/XNGS%3AAAPL`. Quotes require the server, provider availability/quota and the regular US trading session. Outside these conditions execution fails closed. No fake quote fallback.

Local artifacts (outside Git) are under `output/stocks-preview-481-20261009/` in the task workspace:

- `simulator-desktop-1440-position.jpg`: real open-position/revaluation evidence.
- `simulator-final-desktop-1440.jpg`: final desktop ticket, chart, balances and fills.
- `simulator-final-mobile-390-history.jpg`, `simulator-final-mobile-390-ticket.jpg`: mobile review.
- `simulator-mobile-390-nvda-blocked.jpg`: honest missing-key state.
- `simulator-browser-network.json`, `simulator-tests.log`, `stocks-regression-tests.log`, `simulator-final-builds.log`, `default-off-final-build.log`.

Public/commercial data licensing, multiuser hosting and execution for all symbols are not completed by this preview. See the simulator README for provider rights, conversion and execution limitations. No remote CI run or new PR publication is claimed.
