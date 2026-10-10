# Stocks simulator: quote-source gate (local only)

> Historical investigation, superseded later on 2026-10-09 by [the implemented local simulator and browser evidence](stocks-simulator-local-20261009.md). The explicit `interval=1min&timezone=UTC&prepost=false` AAPL public trial returns usable, verified intraday quotes. The original request below used the default daily interval. The AAPL trade cycle is now implemented and verified; NVIDIA/TSLA still require an entitled key. Keep the earlier findings below as a record, not current implementation status.

Checked 2026-10-09, Codex. No production access, deployment, migration, merge, external order, paid subscription or account registration.

## Fresh source state

- Fresh `git fetch origin`: main `cb5559db24c7c8ba4cae75997a1c9145a193151f`.
- PR #471: open Draft, unmerged, `13fe4a8f9aad5d873612fdb0be57c027767336c6`.
- PR #481: open Draft, unmerged, `1cc0e7a5a5c3f7a56c26cc7d0ebbbf913588cfe6`, stacked on #471.
- Isolated local branch `codex/stocks-simulator-source-check-20261009` preserves exact #481 design. Current main and other task files remain unchanged. No application code changed.

## Available candidate and actual blocker

Twelve Data describes Basic as free, with 8 API credits/minute and 800/day. Its individual-plan policy explicitly permits non-production development/testing and internal use; it does not permit redistribution or commercial third-party display. This is a candidate for the owner's private local simulator, not permission for a public VOLTEX trading product.

Sources checked live:
- https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage
- https://support.twelvedata.com/en/articles/5335783-trial
- https://support.twelvedata.com/en/articles/9935903-us-equities-market-data
- https://finnhub.io/terms-of-service
- https://docs.alpaca.markets/us/docs/about-market-data-api

No matching provider credential environment names were configured in the execution environment. The source and isolated preview's root/frontend `.env` and `.env.local` locations had no configured provider keys. This is a bounded local check, not a claim that no credentials exist anywhere on the machine.

Documented public Twelve Data trial key probed with read-only `/quote` GETs at 2026-10-09T17:07:24Z:

| Symbol | HTTP | Result |
| --- | --- | --- |
| AAPL | 200 | Timestamp 1791552600 = 2026-10-09T13:30:00Z, daily datetime; does not establish a fresh execution quote |
| NVDA | 401 | Provider explicitly requires an owner's own API key |
| TSLA | 401 | Same explicit rejection |

Raw responses are in the task's external `output/stocks-preview-481-20261009/quote-source-*.json` directory. They contain the public trial response, no private credentials. No data was read from the TradingView iframe for order execution.

**BLOCKED_STOCKS_QUOTE_CREDENTIALS**: an authenticated, entitled quote source covering AAPL/NVDA/TSLA is not currently available to this local environment. The public trial key cannot satisfy the requested simulator. Do not turn stale daily quotes, fixtures, widget DOM or invented prices into execution data.

Next dependency: owner configures a private Basic API key locally (never in chat, Git or frontend bundle), then verify actual quote timestamps/session metadata, quota and use scope. Do not register an account, accept subscription contracts or purchase access automatically. A public release requires a separate data-rights review.

## Preserved preview

The exact #481 frontend was built with `VITE_STOCKS_ENABLED=true` and `VITE_STOCKS_WIDGET_PREVIEW=true`; TypeScript/Vite build passed. Live local URL: http://127.0.0.1:4435/stocks/XNGS%3AAAPL . Static preview only, no backend or collector.

Actual official TradingView charts rendered for Apple, NVIDIA and Tesla. Desktop 1440px chart ends at x1092; trade panel starts at x1096. Mobile 390px chart ends at y673.51; ticket starts at y677.51. No overlap or horizontal overflow in those checks. Buy/Sell and Market/Limit select correctly, but submit remains disabled; unknown balance and totals remain dashes. Mobile instrument drawer and NVIDIA switching passed. Final observed browser warning/error log was empty.

Desktop/mobile screenshots and browser-checks.json are stored outside Git in the task output directory. Trade-cycle, balance, PnL and persistence simulator tests were not run because the source gate is blocked; the simulator is not implemented. No real balances, orders, users, AITH, NRX, Spot, Futures or CFD state changed.
