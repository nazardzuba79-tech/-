# Stocks — GeckoTerminal rights, chart alternatives and release blockers (Issue #618)

Review date 2026-10-25. Docs only; no Stocks code, frontend, PR #613, server, DNS, database or production change. Not legal advice (§8).

**Коротко для власника.**
1. **Публічний VOLTEX з поточним iframe GeckoTerminal — NO GO.**
   - Умови GeckoTerminal дають лише обмежену персональну ліцензію.
   - Републікацію вони дозволяють тільки на **некомерційному** сайті.
   - Самі умови стосуються лише криптовалют, а **не** інструментів, які за законом Сінгапуру вважаються цінними паперами. xStocks за документами емітента — саме цінні папери.
   - Самообслуговуваного дозволу для біржі немає. Без письмового дозволу цей шлях закритий, і обходити його не можна: проксі, скріншоти, скрейпінг не допускаються.
2. **Найпрактичніша законна альтернатива — власні графіки з публічних угод Solana.**
   - Ціни обчислюються самостійно з даних блокчейну через платний RPC-тариф, без чужого графічного контенту.
   - Орієнтовна вартість — **≈ $50–100 на місяць** інфраструктури, разово до ≈ $250 на відновлення історії, плюс 2–3 тижні розробки. Розрахунок спирається на виміряну активність пулів.
   - Фронтенд уже має власний рушій графіків.
3. **Незалежно від джерела даних лишається регуляторний блокер.**
   - xStocks не пропонують у США і в забороненій юрисдикції.
   - Публічний показ цін цінних паперів на біржі потребує юридичної оцінки за вашою юрисдикцією.
   - BUY/SELL лишається вимкненим.

## 1. What was checked, and how

| Source | Access on 2026-10-25 | Used as |
|---|---|---|
| https://www.geckoterminal.com/terms-conditions | Direct request **HTTP 403** (bot-challenge page). The archive copy (web.archive.org snapshot 2026-09-25) is unreachable from this environment. I did **not** bypass the challenge. | Clause wording via search-engine index excerpts of that URL, plus the owner's reading in Issue #618 (comment 6395588608). |
| https://about.geckoterminal.com/embed-charts | **HTTP 200**, full HTML read | Primary |
| GeckoTerminal embed URL (`/solana/pools/<pool>?embed=1…`) | HTTP 307 → 200; no `X-Frame-Options` or CSP `frame-ancestors` header | Technical only |
| https://docs.xstocks.fi/docs/product-legal-overview and https://docs.xstocks.fi/docs/how-xstocks-work | **HTTP 200**, full text read | Primary (issuer) |
| CoinGecko API terms / pricing, DexScreener API terms, Birdeye pricing, Helius pricing / terms, TradingView widget policy | Search-index excerpts; the CoinGecko pages answer 403 directly | Secondary; marked "verify" |
| Public production `https://voltextech.net` bundle (`index-Bx_szNa5.js`, `StocksPage-DncnVTJR.js`) | HTTP 200, read-only | Production state |
| Stocks branch `work/stocks-onchain-local-embed-20261025` | Current head `cff4af5e` (Issue checkpoint `33d610a7` is an ancestor, 5 commits behind) | Code review |

Because the live terms page could not be read directly, every terms quote below is an **index excerpt**. Before any external use, confirm it once in an ordinary browser. None of these quotes is read as a permission; they are only reasons not to assume one.

## 2. Five separate questions

These are kept apart on purpose.

| Question | Answer | Evidence |
|---|---|---|
| A. Does a browser technically load the iframe? | **Yes**, locally: 58/58 HTTP 200, load events and Canvas. | Codex CI run 40178027705; the provider sends no frame-blocking header. |
| B. Does the Gecko API index the pool? | 19 pools API-indexed, others not checked. | `docs/STOCKS_ONCHAIN_58_CANDIDATES_20261025.md` |
| C. Are trades independently confirmed on-chain? | 7 of 58 checked (program owner, mint, SwapEvent); 51 are `verifiedOnChain:false`. | Same document; Codex Issue #615 |
| D. May VOLTEX show these charts commercially on a public exchange? | **No self-service basis found** (§3). | GeckoTerminal terms excerpts |
| E. May VOLTEX trade or offer these tokens? | **Not established.** They are securities in Jersey/EU and not offered in the US. Distribution goes through licensed distributors. | xStocks legal overview |

A "yes" to A–C says nothing about D or E.

## 3. GeckoTerminal: what the terms say

**Scope.**
- The terms state that the Site pertains only to cryptocurrency and not to instruments classified as "securities" under the Singapore Securities and Futures Act (Cap. 289).
- The operator is a Singapore private limited company. The owner read "Latest Version 11 August 2025" (Issue #618 comment).
- The privacy policy repeats the same carve-out for "all Content and Site Services".

**Licence.**
- **§4.4:** a "limited, **personal**, non-exclusive, non-sublicensable, non-transferable licence" to use Site Content.
- **§4.6:** "You may republish some or part of our Site Content ('ScreenCaptures') and links … on your own **non-commercial** website".
- **§4(B):** otherwise, nothing may be copied, distributed or published without the company's prior written consent. All Content and Site Services, including the GeckoTerminal API, are protected by copyright.
- **Branding:** may not be used for any purpose without prior written consent.

**The embed page** (about.geckoterminal.com/embed-charts) is a code generator and marketing page:
- "Get a fully-featured chart component directly on your app…", "Available for both Web and Mobile";
- a «Partner with Us / Platform Partners — Contact Us» section.

Its static text contains **no licence grant**, no commercial-use statement and no mention of securities. A technical capability, and the absence of a frame-blocking header, are not permission.

**Conclusion (D):**
- Under the terms as indexed, an exchange is a commercial site, and a tokenized security is outside the Site's declared scope.
- The only explicit republication right is for non-commercial sites, and anything else needs prior written consent.
- There is no published self-service path that covers a public VOLTEX Stocks page.
- **NO GO for the public iframe.** The owner has ruled out asking the provider. Proxies, screenshots or scraping would breach the same terms and are not proposed.

## 4. Alternatives compared

Assumptions:
- **Scope:** 58 pools today, planning for 50–70 assets and up to about 100 pools.
- **Measured activity (Appendix A, public Solana RPC, 2026-10-25):** the 7 verified pools carry **4,000–20,000 transactions/day each, about 52,000/day together**. 30–45 % of those transactions failed, which is bot traffic. For all 58 pools I plan for **60,000–150,000 transactions/day, of which roughly 40,000–90,000 are successful**.
- **History:** since the xStocks Solana launch on 30 June 2025 (Backed press release), about 16 months. That is an estimated **15–50 million** historical pool transactions; earlier months were probably quieter.
- **Prices:** all prices are list prices from the providers' pages as indexed. Verify at checkout; no free licence is assumed.

| | Current GeckoTerminal iframe | Licensed data API (self-service paid plan) | Own index from Solana DEX trades |
|---|---|---|---|
| Rights basis | Personal / non-commercial; securities out of scope → **NO GO** | Each provider's API terms. CoinGecko paid plans state commercial use with attribution, but **securities scope unverified**. DexScreener API allows commercial use but has no OHLCV history and a non-compete clause. Birdeye terms not found | Public ledger data computed by VOLTEX. The RPC provider is infrastructure (Helius terms forbid giving *the RPC product* to third parties, not showing derived results). **No third-party chart content** |
| Data cost / month | $0 | CoinGecko from ~$29–129 (secondary sources); Birdeye $99–999 | RPC $49 (Helius Developer: 10M credits, 50 RPS). Live ingestion fetches only successful transactions: ~1.2–2.7M credits/month at 1 credit per `getTransaction`. Optional second provider $0–49 for failover. Business $499 only if a dedicated stream becomes necessary |
| One-time | — | — | History backfill ~1.5–5M credits with `getTransactionsForAddress` (10 credits / 100 tx), spread over 1–2 months of the plan. On plain RPC it is 15–50M credits ≈ $75–250 extra at $5 / 1M |
| Storage | — | — | ~10–20 GB in year 1 (≈15–30M trade rows plus 1m/1h/1d rollups) on the existing PostgreSQL; raw trades can be pruned to 90 days once rolled up |
| Build effort | done (localhost) | ~1 week API adapter | ~2–3 weeks backend MVP, plus 3–5 days to wire the existing frontend chart |
| Run effort | provider-dependent | low | ~1–2 days/month (new pools, program upgrades, multiplier events, RPC changes) |
| Latency | provider ("secondly") | provider | ~1–3 s after confirmation over WebSocket |
| SLA | none | plan-dependent | self-operated; two RPC providers for failover |
| Asset coverage | whatever Gecko indexes | whatever the provider indexes | exactly the allowlisted, on-chain-verified pools |
| Regulatory blocker (§8) | yes | yes | yes |

**Recommendation:** build the own index. It is the only option that needs neither a written permission nor an unverified securities carve-out, and it reuses VOLTEX's existing chart engine (`lightweight-charts`, Apache-2.0, already in the production bundle). Keep a licensed API as the fallback only if its terms are confirmed in writing on the checkout page to cover tokenized securities.

## 5. Proposed architecture for own charts

This is analysis only; **nothing is built** until the owner chooses this option.

1. **Allowlist.**
   - Each entry is pool address, program (Raydium AMM v4 / CLMM / CPMM, Orca Whirlpool, Meteora), the two vault token accounts, the xStock mint and the USDC mint.
   - Only pools Codex verified on-chain (#615) are admitted. Unverified pools are never charted.
2. **Live ingestion.**
   - One standard Solana WebSocket connection with `logsSubscribe` (`mentions: [pool]`), one subscription per pool.
   - For every new signature, one `getTransaction` at `confirmed` commitment.
   - This design is not tied to a provider-specific stream (no LaserStream/gRPC needed at this volume).
3. **Trade extraction, program-agnostic.**
   - From `meta.preTokenBalances` / `postTokenBalances`, take the raw deltas of the two pool vaults.
   - xStock out of the vault with USDC in is a buy, and the reverse is a sell. Price = ΔUSDC / ΔxStock.
   - Skip transactions where both vaults move the same way (liquidity add/remove).
   - This avoids decoding every program's instructions, and aggregator multi-hops still net correctly per pool.
4. **Corporate actions.**
   - xStocks use Token-2022 **Scaled UI Amount**: a multiplier on the mint, changed for dividends and splits; the raw balance never changes.
   - Measured on all 7 verified mints (owner `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`): `scaledUiAmountConfig` carries `multiplier`, `newMultiplier` and `newMultiplierEffectiveTimestamp`.
     - AAPLx: 1.0026642 → 1.0032690, effective 2026-08-08 00:30 UTC.
     - TSLAx and MSTRx: 1.
   - The multiplier in force is `newMultiplier` once its timestamp has passed; reading only `multiplier` would be wrong.
   - Store the multiplier history from the mint (`UpdateMultiplier` events).
   - Compute price per displayed token from raw amounts and the multiplier in force at the trade's block time. Do not rely on `uiAmount` from RPC.
   - Mark multiplier changes on the chart, and offer a multiplier-adjusted series so a dividend does not look like a crash.
5. **Storage.**
   - `StocksDexTrade(pool, signature, slot, blockTime, side, baseRaw, quoteRaw, multiplier, price)` with a unique `(signature, pool)` index.
   - 1m/1h/1d candles are rolled up from trades.
   - `confirmed` data is replaced once the slot is `finalized`, so a dropped fork never sticks.
6. **Backfill and gap repair.**
   - Per pool, page `getTransactionsForAddress` (or `getSignaturesForAddress` + `getTransaction`) back to pool creation.
   - On every reconnect, resume from the last stored slot.
   - Record coverage per pool; candles outside coverage show "no data", never a guessed price.
7. **Serving.**
   - Existing API: `GET /stocks/dex/:pool/candles?tf=…&from=…`, plus the latest candle by polling at the existing chart cadence (or SSE later).
   - Every response carries source = "Solana on-chain swaps, computed by VOLTEX", the pool and the coverage window.
8. **Frontend.**
   - Replace the iframe in the Stocks preview with the existing chart component fed by that endpoint.
   - That frontend is owned by ChatGPT. This document only defines the contract.
9. **Monitoring.**
   - Staleness per pool (no trade ≠ outage).
   - RPC error rate, and failover to the second provider.
   - Daily reconciliation of the candle count against a fresh RPC sample.

## 6. Security and operations review of the current iframe preview (`cff4af5e`)

| Item | Finding | Severity |
|---|---|---|
| DOM / token isolation | Cross-origin iframe: the provider cannot read the VOLTEX DOM, `localStorage` (`exchange_token`) or cookies | OK |
| `sandbox` | **Absent.** The provider page may run scripts, open popups and attempt top navigation (browsers require a user gesture for cross-origin top navigation). Recommend `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, without `allow-top-navigation` | P1 if ever public |
| Permissions | `allow="fullscreen"` only; clipboard-write removed | OK |
| CSP | `voltextech.net` sends **no CSP**; `frontend/public/_headers` sets cache headers only. Recommend at least `frame-src` limited to the one provider, as part of a site-wide CSP | P1 if ever public |
| URL allowlist | Ticker and pool come from compiled allowlists; unknown query parameters are ignored, never interpolated | OK |
| Referrer | `strict-origin-when-cross-origin`: the provider sees the VOLTEX origin only | OK |
| Gating | `mayMountOnchainEmbedPreview(hostname, import.meta.env.DEV, VITE_…)` requires 127.0.0.1 + dev build + flag. The public production chunk `StocksPage-DncnVTJR.js` contains **no** `geckoterminal` reference (read-only check, 2026-10-25) | OK |
| Provider outage | Neutral warning after 20 s and a manual reload; no fabricated price | OK |
| BUY/SELL | Disabled in the UI; server execution gates OFF (#613) | OK; must stay |
| Asset labelling | UI says "DEX prices of tokens, not ordinary stock prices". Recommend also naming the instrument: «xStock — трекер-сертификат Backed Assets (JE)» and the multiplier | P2 |
| Privacy | A third-party iframe sends the visitor's IP / UA to the provider; the public privacy policy would need to disclose it | P1 if ever public |

## 7. Release map

| | State |
|---|---|
| Technically ready locally | **Yes.** The localhost-only preview loads 58/58 iframes. This is not a data audit. |
| Public with the GeckoTerminal iframe | **NO GO** (P0-1) |
| Public with own on-chain charts | **Not built.** The architecture is viable (§5). It still needs P0-2 resolved. |
| Trading BUY/SELL | **NO GO** (P0-3) |
| Production now | Stocks preview not public. Main `98261cc8`; no change made. |

- **P0-1** — there is no self-service right to show GeckoTerminal charts of tokenized securities on a commercial site. It is removed only by choosing another data source (§4). A written licence has been ruled out by the owner.
- **P0-2** — regulatory review for public display of security-token prices (US and prohibited jurisdictions; EU financial-promotion rules). It is removed by a jurisdiction-specific legal opinion, geo/eligibility gating and agreed disclaimer text.
- **P0-3** — trading or offering these instruments. xStocks are distributed through licensed distributors; VOLTEX holds no such licence on record. BUY/SELL stays disabled.
- **P1:**
  - on-chain verification of the 51 unverified pools (Codex #615);
  - multiplier-correct history;
  - backfill coverage evidence;
  - `sandbox` + CSP + privacy disclosure if any third-party frame is ever public;
  - two-provider RPC failover.
- **P2:**
  - instrument labelling;
  - an SLA definition;
  - capacity test for public traffic.

## 8. Limits of this review

- This is not legal advice and not a jurisdiction-specific opinion. Whether displaying prices of tokenized securities counts as marketing or solicitation depends on where VOLTEX operates and whom it serves.
- The GeckoTerminal clauses come from search-index excerpts because the live page is bot-protected. They must be confirmed in a browser before anyone relies on them, in either direction.
- Prices and credit costs are list prices from secondary or indexed pages; confirm on the providers' live pricing pages.
- Swap volumes and history depth are estimates. Phase 1 of the plan measures them before any build commitment.

## 9. Phased plan (on the owner's go-ahead for §4 "own index")

1. **Measure (1–2 days, read-only).** For the 7 verified pools, count historical transactions and the current swap rate on one RPC trial key. This turns the §4 ranges into numbers.
2. **Backend MVP (2–3 weeks).**
   - ingestion, vault-delta extraction, multiplier history, candles, backfill, API;
   - disposable-PostgreSQL tests against recorded transactions.
3. **Frontend swap (3–5 days, ChatGPT).** Replace the iframe with the chart component; localhost-only first.
4. **Expand.** Add pools as Codex verifies them (#615); run monitoring for 2 weeks.
5. **Legal gate (P0-2), then a public catalogue view.** BUY/SELL stays OFF.

## Appendix A — measurement (read-only, public RPC `api.mainnet-beta.solana.com`, 2026-10-25 ~09:30 UTC)

Method:
- For each pool: `getSignaturesForAddress(pool, limit 1000)`, paged 15 times (15,000 latest signatures). Rate = count ÷ time span.
- For each mint: one `getAccountInfo(jsonParsed)`.
- No key, no write, no indexer. The 15,000 sample covers only the latest days, so it says nothing about full history.

| Ticker | Pool | Window (days) | Tx/day | Failed in sample | Mint multiplier → new (effective) |
|---|---|---|---|---|---|
| AAPLx | `ApniVWuZ…qrAZT` | 3.75 | 3,996 | 30 % | 1.0026642 → 1.0032690 (2026-08-08) |
| TSLAx | `8aDaBQkT…NpFF` | 2.22 | 6,764 | 29 % | 1 → 1 |
| NVDAx | `49iMatQt…yyw6` | 1.81 | 8,288 | 31 % | 1.0009181 → 1.0017012 (2026-09-10) |
| SPYx | `4pCZCVEi…NXhRw` | 0.75 | 19,884 | 46 % | 1.0039092 → 1.0057146 (2026-06-18) |
| GOOGLx | `B8YAwjGY…sobRw` | 3.71 | 4,042 | 23 % | 1.0019267 → 1.0023773 (2026-09-04) |
| MSTRx | `RyhF4cks…pbGv` | 2.87 | 5,235 | 42 % | 1 → 1 |
| QQQx | `GMjGLWzv…aG` | 3.53 | 4,250 | 43 % | 1.0027250 → 1.0034561 (2026-09-19) |

Transactions are pool transactions: swaps, plus a small share of liquidity operations. They were not decoded.

## Sources

- GeckoTerminal Terms & Conditions — https://www.geckoterminal.com/terms-conditions (403 direct; index excerpts)
- GeckoTerminal Privacy Policy — https://www.geckoterminal.com/privacy-policy (index excerpts)
- GeckoTerminal Embed Charts — https://about.geckoterminal.com/embed-charts (read 2026-10-25)
- xStocks Product Legal Overview — https://docs.xstocks.fi/docs/product-legal-overview (read 2026-10-25)
- How xStocks Work — https://docs.xstocks.fi/docs/how-xstocks-work (read 2026-10-25)
- Solana Scaled UI Amount — https://solana.com/docs/tokens/extensions/scaled-ui-amount ; Solana Foundation xStocks case study — https://solana.com/news/case-study-xstocks
- Backed launch press release (30 June 2025) — https://tools.prnewswire.com/en-us/live/20823/release/20250630EN21069
- CoinGecko API pricing / terms — https://www.coingecko.com/en/api/pricing , https://www.coingecko.com/en/api_terms (index excerpts)
- DexScreener API Terms — https://docs.dexscreener.com/api/api-terms-and-conditions (index excerpts)
- Birdeye pricing — https://docs.birdeye.so/docs/pricing (index excerpts)
- Helius plans / credits / terms — https://www.helius.dev/docs/billing/plans , https://www.helius.dev/docs/billing/credits.md , https://www.helius.dev/terms (index excerpts)
- TradingView widget and policy pages — https://www.tradingview.com/widget-docs/faq/general/ , https://www.tradingview.com/policies/ (index excerpts; TradingView's free widgets carry TradingView's own data and require its attribution; no xStocks symbols were found)
