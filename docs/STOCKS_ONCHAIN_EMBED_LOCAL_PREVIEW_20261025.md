# VOLTEX Stocks — GeckoTerminal on-chain embedded chart local proof (25 Oct 2026)

**Status:** local-dev-only and trading disabled. This is NOT production activation nor permission to redistribute market data.

## What was implemented
- React component `frontend/src/pages/stocks/StocksOnchainEmbedPreview.tsx`, styled to fit dark Stocks terminal.
- Seven issuer-verified Solana tokenized-equity mints, each with a finalized on-chain checked Raydium CLMM pool; `onchainEmbedPreviewData.ts` pins the allowlist and generates immutable fixed-origin GeckoTerminal embed URLs.
- Search, asset switching, provider attribution, direct pool source link, responsive desktop/mobile layout.
- Trading controls disabled; no balance/order/position/withdrawal calls. Do not present the iframe's raw xStock DEX token prices as NASDAQ/NYSE equities prices.
- Gated under **all three**: hostname exactly `127.0.0.1`, Vite `import.meta.env.DEV === true`, `VITE_STOCKS_ONCHAIN_EMBED_PREVIEW=1`. The usual Stocks route remains unchanged everywhere else.
- Nothing routes third-party prices through VOLTEX API. The iframe stays provider-hosted.

## Proof
- GitHub Actions: https://github.com/nazardzuba79-tech/-/actions/runs/40170021425 — **PASS**: seven ticker/address allowlist assertions, default-OFF and origin guard assertions, full frontend `tsc -b && vite build` with flag OFF.
- Official GeckoTerminal embedded-chart integration: https://about.geckoterminal.com/embed-charts
- Verified selected active Raydium pools: https://github.com/nazardzuba79-tech/-/actions/runs/40168364646
- Issuer-verified seven mints: https://github.com/nazardzuba79-tech/-/actions/runs/40164440585

## Local developer invocation
From frontend directory, on dev machine bound to **127.0.0.1**:
```sh
VITE_STOCKS_ONCHAIN_EMBED_PREVIEW=1 npm run dev -- --host 127.0.0.1
```
Windows PowerShell: `$env:VITE_STOCKS_ONCHAIN_EMBED_PREVIEW='1'; npm run dev -- --host 127.0.0.1`.

View: `http://127.0.0.1:5173/stocks`. Actual port may differ.

## Explicit release blockers
1. GeckoTerminal advertises embeddable DEX charts for apps and sites; its general Terms separately restrict commercial use and refer to securities. This feature **has NOT been verified as permitted for commercial tokenized securities** on VOLTEX: https://www.geckoterminal.com/terms-conditions .
2. Availability of provider iframe/embedded xStocks symbols has not been smoke-tested end-to-end in a live unrestricted browser in this work.
3. There is no DEX-specific quote in VOLTEX backend order panel, and it cannot authorize Stocks trading. Stocks data source and p95 requirements of PR #613 remain separate launch blockers.
4. No merge/deploy, DNS/Cloudflare Pages change, production SQL, balances, order or public feature flag modifications.

The owner also has a **single self-contained HTML** preview as a ChatGPT attachment. It works without building the VOLTEX frontend, subject to external GeckoTerminal iframe reachability and provider restrictions.
