# VOLTEX xStocks v7 multipool evidence — 25 October 2026

Status: **read-only research**. No merge/deploy, account balances, order routing, Stocks feature flags or PR #613 change.

## Result: seven issuer-verified xStocks, eleven independently on-chain-verified Raydium CLMM pools

Official Solana token mint identities and corporate-action histories were checked for all 7 via the issuer public API:
https://github.com/nazardzuba79-tech/-/actions/runs/40164440585

Earlier seven pool checks:
- https://github.com/nazardzuba79-tech/-/actions/runs/40125222923
- https://github.com/nazardzuba79-tech/-/actions/runs/40126847509

DEX Screener pool discovery: https://github.com/nazardzuba79-tech/-/actions/runs/40168276876 .
It reports 24-hour activity; these third-party transaction counts are discovery hints, **not independently audited on-chain daily counts** and **not rights to redistribute a market-data feed**.

Four newly verified Raydium CLMM pools on-chain (program owner, exact issuer token mint + USDC, finalized transaction SwapEvents):
https://github.com/nazardzuba79-tech/-/actions/runs/40168364646

| Ticker | New pool address | Finalized SwapEvents sampled | DEX Screener reported 24-hour buys+sells |
|---|---|---:|---:|
| AAPLx | `ApniVWuZbZoruTAJdyJcLBA4AVw4DKGdV5fHxo6qrAZT` | 4 | 1,013 |
| NVDAx | `49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6` | 4 | 4,296 |
| SPYx | `4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw` | 4 | 7,221 |
| QQQx | `GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG` | 2 | 960 |

Previous pool data remains valid and is not replaced. The most active pool can vary; no automatic source switch.

## Local research package v7

The tested local package is **voltex-solana-xstocks-indexer-v7.zip**.
- SHA256: `2cd27a489b830e6aa5412f09d32d1fa49bf6756e3bfeb49eaff0374fe2d76e6d`
- 18 source/research files, Node.js built-in runner: **34/34 local deterministic tests PASS**.
- Contains 11 allowlisted CLMM pools and `--pool=ADDRESS` explicit selector for each asset with multiple pools. Default v6 source is preserved.
- The **full source ZIP is attached to the ChatGPT conversation; it is NOT committed to this branch**. This markdown is a handoff/evidence record, not a deployment artifact.

## Limitations and launch gates

1. Do not present DEX Screener's displayed price/volume as an independently licensed exchange data feed.
2. Orca Whirlpool markets also have reported activity but require a distinct on-chain decoder and transaction-order verification; **not included** in v7.
3. An on-chain proof of a few swaps does not prove complete 1h/day OHLCV backfill, no missing signatures, sustained RPC throughput, or durable archive.
4. Chart completeness remains bounded to the original Raydium pool and historical window independently scanned; v7 does not merge multiple pools into a single chronology.
5. Legal/commercial display rights are unverified. Stocks BUY/SELL remain disabled for all users.
6. No production deployment, release change, schema migration, secret, financial adjustment, or main merge was made.

Next useful gate: choose one of the more active **on-chain-verified** CLMM pools, prove a complete 10–15 minute trade-time series with an affordable RPC/archive plan, then compare candle completeness before any broader implementation.
