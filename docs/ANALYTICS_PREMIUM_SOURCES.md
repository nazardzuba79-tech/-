# Analytics premium sources

VOLTEX Analytics supports optional server-side CoinGlass API data when `COINGLASS_API_KEY` is configured.

The key is read only by the backend. It is never returned to the frontend and these feeds are read-only analytics inputs; they are not used for matching, mark price, margin, funding, liquidation, balances, PnL, or execution.

Current optional sections:

- Liquidation heatmap: CoinGlass Pair Liquidation Heatmap Model1. Requires a CoinGlass Professional or Enterprise API plan.
- ETF flows: BTC, ETH, SOL and XRP ETF flow history. Available across CoinGlass API plans.
- Exchange balance changes: BTC, ETH and XRP according to the provider's supported balance symbols.
- Whale activity: labelled large on-chain transfers. Requires Startup or higher.

To enable the complete set, configure a CoinGlass Professional (or Enterprise) API key as `COINGLASS_API_KEY` on the backend. `COINGLASS_API_BASE_URL` is optional and defaults to `https://open-api-v4.coinglass.com`.

When the key or entitlement is absent, the corresponding user-facing panels remain hidden rather than showing fabricated values or provider error text.
