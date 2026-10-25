# VOLTEX Stocks 58-token Solana discovery — 2026-10-25

## Exact status

This is a **localhost-only, trading-disabled Stocks research catalogue** based on PR #613, not an activated exchange feature.

- Official issuer API: `https://api.xstocks.fi/api/v2/public/assets?page=N`, first 15 pages traversed: **1,467 distinct issuer Solana token mint addresses** across those pages (not necessarily all issued tokens, tradable, or liquid).
- Bounded DEX discovery scan: 200 selected symbols; **58** issuer-mint-matched xStocks/USDC DEX pools reported by DEX Screener. 36 candidates had **at least 10 reported transactions / 24h AND $2,000 reported liquidity** at scan time. These are not a minimum viable exchange liquidity guarantee.
- **Only 7 ticker assets** from the earlier programme received independent direct Solana program-owner/mint/SwapEvent checks. The 51 additional entries are explicitly `verifiedOnChain:false`. Previously verified pool may differ from the DEX Screener best-activity candidate.
- All 58 are developer-preview candidates with external GeckoTerminal iframe references; loading/rendering every iframe was not validated end-to-end.
- Legal rights to commercially embed charts for tokenized securities remain **unverified**; generic GeckoTerminal embeds are not blanket license permission, see https://www.geckoterminal.com/terms-conditions .
- No balance, stock trade execution, routing, production flag, secrets, DB schema, server or deployment changes.

## Receipts

- Official / DEX discovery (58 matched): https://github.com/nazardzuba79-tech/-/actions/runs/40174085251
- Earlier 33 discovery: https://github.com/nazardzuba79-tech/-/actions/runs/40173792295
- Exact-head typecheck and full frontend build for **58** entries: https://github.com/nazardzuba79-tech/-/actions/runs/40174452017
- Previously verified on-chain issuer and pools: https://github.com/nazardzuba79-tech/-/actions/runs/40164440585 and https://github.com/nazardzuba79-tech/-/actions/runs/40168364646

## Implementation

- `frontend/src/pages/stocks/onchainDiscoveredCandidates.ts`: 58 issuer-mint matched candidate pools. All 58 marked not individually on-chain-verified by this scan.
- `frontend/src/pages/stocks/onchainEmbedPreviewData.ts`: original 7 exact allowlisted on-chain-verified Raydium pools.
- `frontend/src/pages/stocks/StocksOnchainEmbedPreview.tsx`: union of 7 verified and additional candidates (58 distinct ticker entries), search, select, status and attribution. Local-only.
- `frontend/src/pages/stocks/StocksPage.tsx`: route conditional requires `127.0.0.1`, Vite DEV and `VITE_STOCKS_ONCHAIN_EMBED_PREVIEW=1`. Public hosting cannot activate through the flag.
- `frontend/src/pages/stocks/stocksOnchainEmbedPreview.css`: responsive layout.

Windows PowerShell local run from `frontend` (ordinary local VOLTEX authorization is still required):
```powershell
$env:VITE_STOCKS_ENABLED='true'
$env:VITE_STOCKS_WIDGET_PREVIEW='true'
$env:VITE_STOCKS_ONCHAIN_EMBED_PREVIEW='1'
npm run dev -- --host 127.0.0.1
```
Then browse `http://127.0.0.1:5173/stocks` (port may vary). The normal Stocks login guard is unchanged.

## Release gates

1. Obtain/establish rights to display securities-token charts in the intended public VOLTEX context; do **not** assume general embed docs override GeckoTerminal's Terms.
2. On-chain verify candidate pools individually and live smoke-test displayed charts before promoting them as available.
3. Confirm source continuity/staleness, full range backfill and public performance/capacity; maintain no invented prices.
4. Preserve STOCKS buy/sell as disabled until separately authorized.

**No production merge or deploy**. The original Draft PR #613 is unchanged.

## Follow-up local integration and browser evidence — 25 October 2026

- The updated local-only UI combines 58 DEX candidate tickers, 7 direct on-chain-verified pool addresses and 19 GeckoTerminal API-indexed pools (22 distinct tickers have one or both kinds of additional source evidence). All per-pool claims remain separate.
- 36 of 58 candidates met the historical >=10 trades/24h and >=$2,000 liquidity screen; those numbers are third-party snapshots, not a current trading suitability promise.
- Stocks pool selector, source attribution, filter and explicit no-trading controls are available; production Stocks remains OFF.
- Chromium desktop QA of all 58 at https://github.com/nazardzuba79-tech/-/actions/runs/40176512351: 58 iframe HTTP 200, 58 iframe load events and 58 iframe canvases. Actual visible OHLCV candlesticks were reviewed from saved screenshots for SPYx and CRCLx only.
- The instant mobile screenshot after reload was blank during GeckoTerminal chart initialization. A separate browser retest was added to wait for chart loading before capturing mobile evidence.
- Commercial embedding rights for tokenized securities, independent verification for the other 51 pools and full historical price accuracy are **not** established.
