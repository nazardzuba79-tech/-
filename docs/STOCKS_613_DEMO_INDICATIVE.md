# Stocks #613: demo/indicative prices (owner decision 30.10.2026)

The owner's decision: the Stocks section is a public mock-up for presentations. Prices may be delayed as on TradingView's
free tier (15 minutes); real licensed data comes at the real launch. Wanted: many tokenized stocks and ~20 Russian
companies. This profile is **OFF** unless `STOCKS_DEMO_INDICATIVE_ENABLED=true`. Without it nothing changes: no
`XSTOCK:` row exists and MOEX stays `MOEX_UNVERIFIED`.

## Sources (no CEX, nothing invented)

| Rows | Source | Price | Delay | Requests |
|---|---|---|---|---|
| 55 xStocks (`XSTOCK:<token>`, e.g. `XSTOCK:SPYx`) | the token's own Solana DEX pool (Raydium CLMM 31, Orca Whirlpool 21, Meteora DLMM 2, Meteora DAMM v2 1), public RPC `api.mainnet-beta.solana.com` | pool price in **USDC** (sqrt price / active bin, decimals from the mint accounts) | snapshot every 15 s, labelled "up to 15 min" | 1 `getMultipleAccounts` per snapshot for all 55 pools (≈ 4/min) + once for the mints |
| 20 MOEX equities (`MOEX:TQBR:*`) | Moscow Exchange ISS (`iss.moex.com`), free delayed data | last trade in **RUB** | 15 min (ISS) | list: 1 request/min for all 20; quote: 1 per instrument per 10 s; candles cached 1–10 min |

- The list of mints, pools and DEXes is the recorded catalogue evidence (`research/solana-xstocks/proof-615-20261025`).
  The three FluxBeam-only tokens (SGOVx, APPx, ITAx) are left out: their thin pools gave prices far from the asset.
- Decoders were checked on live mainnet accounts against an independent aggregator the same minute (SPYx 756 / 752,
  NVDAx 202.7 / 202.4, AMDx 501 / 500, AVGOx 323 / 322, XOMx 182 / 188). Four recorded pool accounts are the
  offline test fixture (`services/stocks-global/testing/demo-pools.fixture.json`).
- A pool that cannot be read or does not match its listed mints/USDC has no price (`QUOTE_UNAVAILABLE`), never a guess.
  If the RPC fails the last price goes stale after 30 s (the existing freshness rules).
- No USD/USDT/USDC parity is assumed: xStocks are shown in USDC, MOEX in RUB (the quote carries only its own currency).

## Candles

- xStocks: built from the snapshots — 1-minute buckets for 2 days, 1-hour buckets for a year (1m/5m/15m/30m from
  minutes; 1h/4h/1D from hours), saved to `STOCKS_DEMO_INDICATIVE_DATA` (a JSON file, ≈ 1–5 MB) every ~5 minutes and
  on shutdown. **History starts when the collector starts**: run it some days before a presentation (minutes look
  good after a few hours, 1D after weeks). Volume is not available (0).
- MOEX: ISS 1-minute (last 2 days), 1-hour (14 days) and 1-day (a year) candles, newest first.

## Safety

- View only: the gateway refuses every order on an indicative row or a MOEX row (`INDICATIVE_ONLY`, before any
  authority command); the terminal shows the indicative/delay label instead of the order form. No "demo"/practice
  wording reaches the screen (owner rule 22.10, `plainLanguage.test.ts`).
- Labels: "Индикативная цена из пула DEX Solana · задержка до 15 минут" / "Данные MOEX с задержкой не менее 15 минут",
  and the existing "задержка 15 мин" in the header.
- Not the six-gate own-source history: `SOLANA:<mint>:<pool>` identities and `admitStockHistory` are unchanged.
- Rights: the owner accepted the mock-up as is; ISS terms for public display of delayed data were not confirmed
  (help@moex.com); xStocks rows keep `commercialRightsVerified:false` in the evidence.

## Running it (release gateway)

```
STOCKS_DEMO_INDICATIVE_ENABLED=true
STOCKS_DEMO_INDICATIVE_DATA=/var/lib/voltex-stocks/demo-candles.json   # optional, persists candles
# STOCKS_MARKET_DATA_ENABLED stays false (no CEX rows)
```

Outbound HTTPS needed: `api.mainnet-beta.solana.com`, `iss.moex.com`. Resources measured locally: well under the
200–300 MB / <10 % of one core estimate given to the owner (one RPC call per 15 s, MOEX reads cached).

## Checks run

- `services/stocks-global/demo-indicative.test.mjs` 8/8 (offline; in `stocks-focused-review.yml`); Stocks gateway
  unit 417/417; Stocks frontend Jest 28 suites / 300 tests; frontend `tsc` and the hosted `vite build`.
- `scripts/qa-stocks-demo-indicative.cjs` (manual: live sources, disposable PostgreSQL, ordinary login), Chromium 1440
  and 390: 9/9 — catalogue 55 xStocks + 20 MOEX online with list prices and no CEX row; SPYx ≈ 757 USDC with the
  indicative label and the 15-minute delay; NVDAx; SBER ≈ 296 RUB with minute candles; the ticket shows the demo
  notice and no order request is sent; the gateway refuses an order; no page error.
