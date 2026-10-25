# VOLTEX Stocks — local technical acceptance and public release decision

Updated: 25 October 2026. **Status: LOCAL TECHNICAL CANDIDATE / PUBLIC RELEASE NO-GO.**

This file reports separately: verified GitHub evidence, programmatic source invariants, browser rendering observations, and unverified conditions. It is **not** evidence of a securities market-data license, a brokerage license, or audited market prices.

## Verified source state

| Question | Result | Source |
|---|---|---|
| Issuer-mint-matched discovery candidate tickers | 58 | `onchainDiscoveredCandidates.ts`, Actions #40174085251 |
| Historical minimum activity filter (>=10 reported trades/24 h AND >=$2,000 reported liquidity) | 36 / 58 at snapshot time; **not live metrics** | same generated discovery data |
| Previously independently checked source ticker pools | 7 ticker assets; no fresh proofs claimed | `onchainEmbedPreviewData.ts`, Actions #40164440585 / #40168364646 |
| GeckoTerminal API pool-address matches | 19 ticker entries | `onchainXStocksCatalogue.generated.json` |
| Tickers with at least one of the preceding two levels of extra evidence | 22 (overlap included once) | deterministic `scripts/stocks-onchain-release-gate.mjs` |
| Tickers without either extra source check | 36 | as above |
| Browser iframe navigation and Canvas | 58/58 HTTP 200 + iframe load + Canvas in an isolated GitHub Chromium session | Actions #40178027705 |
| Desktop graphs visually inspected | 10 sample screenshots contain candlestick charts, not OHLCV audits | Actions #40178027705 artifact |
| Follow-up asset/pool deep links, reload/retry, mobile, no trading writes | 3/3 targeted iframe sources + navigation checks + zero local write requests | Actions #40179793034 |
| Actual on-chain audited multi-day OHLCV for all assets | **NOT CONFIRMED** | Only isolated SPYx 10-minute sample Actions #40169011065 |
| Legal basis for GeckoTerminal commercial embeds of tokenized securities | **NOT CONFIRMED** | Official terms linked below |
| Function usable on public VOLTEX | **NO**. Vite DEV + loopback + opt-in gate only | `onchainEmbedPreviewData.ts`, `StocksPage.tsx` |

All automated counts are structural claims from local source snapshots; the gate cannot determine whether liquidity or API access remains available today.

## Official primary-source blockers

1. xStocks issuer documentation classifies xStocks as structured instruments / tracker certificates, not direct ordinary equity holdings. Primary source: https://docs.xstocks.fi/docs/product-legal-overview .
2. GeckoTerminal Terms (latest listed 11 August 2025) define site scope as cryptocurrency and exclude instruments classified as securities under the Singapore Securities and Futures Act. Primary source: https://www.geckoterminal.com/terms-conditions .
3. GeckoTerminal's public embed page provides iframe instructions for crypto charts but no specific proof permitting commercial display of these tokenized securities on VOLTEX. Primary source: https://about.geckoterminal.com/embed-charts .

**Decision:** do not promote public GeckoTerminal Stocks until the applicable display rights are affirmatively established, even if all iframes load. No letters to providers are planned. The alternative of a VOLTEX-owned chart pipeline from independently verified public Solana execution events remains a separate architecture and operating-cost decision, and does not automatically eliminate securities regulatory duties.

## Engineering gate

```bash
node --test scripts/stocks-onchain-release-gate.test.mjs
node scripts/stocks-onchain-release-gate.mjs
```

- Reads exactly the checked-in 58 candidates, seven previous direct-proof source rows and 19 GeckoTerminal API-indexed entries.
- Fails on mismatched issuer mint, malformed pool address, duplicate ticker/issuer mint, falsely claimed on-chain verification or unsafe changes to `rightsToRedistribute`, `productionReady` or `iframeRuntimeChecked`.
- Outputs `productionDecision: "NO_GO"` independently of structural PASS. This static result must not be interpreted as current legal advice or as a live Solana audit.
- GitHub Actions stores an evidence JSON manifest as an artifact.
- Default Stocks trade policy remains **silent NO-OP for all users**. No real/demonstration order creation, balance/position mutation or external settlement.

## Current development scope

Only `work/stocks-onchain-local-embed-20261025` contains the local iframe research UI. The canonical main `98261cc80117e0961f8ebca84499ec2cb3f0e3b4` and consolidated Draft PR #613 are not modified by this work. Do not merge, deploy, enable trading, change SQL, or alter active TYVN/ECLAVO listings.

Outstanding release gates, all hard blockers unless proven otherwise:
- direct Solana owner/program, exact issuer mint and USDC vault pair, finalized transaction checks for chosen production pools, including non-Raydium programs and an affordable durable RPC/archive strategy;
- multi-day trade completeness, accurate quote direction and historical corporate action multipliers, backed by source-specific receipts;
- source liveness/error monitoring, latency and resilience, browser and mobile validations in an allowed production-like context;
- affirmative applicable rights and regulatory assessment of showing and potentially distributing tokenized securities;
- explicit owner authorization for a reviewed release; buy/sell remains disabled until separately authorized.

Delegated tasks: on-chain proof in https://github.com/nazardzuba79-tech/-/issues/615 ; terms/release architecture in https://github.com/nazardzuba79-tech/-/issues/618 . A GitHub Issue is not evidence an external coding agent executed it.

**Do not present this local technical milestone as production deployment or fully verified live trading.**

## Final focused release gate CI — 25 Oct 2026

- Exact reviewed code commit: `8395479095951f903d998bd76722be3fe98d0712`.
- GitHub Actions: https://github.com/nazardzuba79-tech/-/actions/runs/40180539429 — **SUCCESS**.
- Six pure negative/structure tests **PASS**, deterministic source release decision remains `NO_GO`.
- Full frontend TypeScript + Vite build **PASS** with local embed preview flag OFF.
- Browser QA sampled SPYx, NVDAx, CRCLx: **3/3 HTTP 200 and provider Canvas**, 3 iframe load events, no UI JavaScript errors; source switch NVDAx, URL/pool persistence, invalid pool rejection, same-source retry, mobile refresh **PASS**, zero local write requests.
- A preceding browser run failed only on an early iframe `load` event while HTTP 200 and Canvas were already present. The final test records iframe `load` separately and requires the observed HTTP 200 + provider Canvas. These are separate signals; neither establishes audited candles or licensing.
- Run artifact with `release-gate.json`, screenshots and test outputs: https://github.com/nazardzuba79-tech/-/actions/runs/40180539429/artifacts/12593482309 .
- Prior 58-market provider HTTP+Canvas run: https://github.com/nazardzuba79-tech/-/actions/runs/40178027705 .
- **No merge/deploy**, no SQL, no external trading, no market data price fabrications. Stocks trading remains silent NO-OP. Original #613 remains Draft.

Final release position: **engineering LOCAL PASS; full audited on-chain data NOT PROVEN; public permission NOT CONFIRMED; production NO-GO**.

## Final screened-catalogue usability correction — 25 October 2026

- Existing list still contains **58** official-issuer-mint-matched xStocks/USDC DEX-pool candidates. These are **not** 58 audited production markets.
- The local viewing sidebar now **defaults to 36 historically screened candidates** with at least 10 *reported* trades during the prior 24-hour window and at least USD 2,000 *reported* pool liquidity at the 25 October 2026 discovery snapshot. The remaining 22 are accessible **only after explicitly selecting All candidates**, and flagged below that snapshot threshold. Neither cutoff is a current live-quality or safe-trading certification.
- The selected pool now shows its **historical liquidity and 24-hour transactions, or "Нет данных"**, with a visible `25.10.2026, не live` warning. Numbers are pool-specific; independently on-chain-checked pools without corresponding snapshot figures are not assigned made-up statistics.
- The prior full 58-iframe QA remains https://github.com/nazardzuba79-tech/-/actions/runs/40178027705 .
- The targeted final Chromium + Vite CI of the screened UI passed: https://github.com/nazardzuba79-tech/-/actions/runs/40181665918 ; **six safety tests PASS**, TypeScript/Vite PASS, SPYx/NVDAx/CRCLx iframe HTTP 200/Canvas 3/3, mobile reload PASS, pool and link checks PASS, zero local write requests. The test also checks the default 36 and the 58-item research filter.
- Checked code commit `301c9f4586d4d7f6fe8438f1a312744a287900d0`. The preceding failed test runs were corrected, not hidden; the final check is the successful one.

**Final technical outcome:** localhost read-only preview accepted. **Final production outcome:** NOT READY / NO GO. Source rights, most exact Solana executed-swap validations, durable OHLCV completeness and official release authorization remain unresolved. No main/production/DB/trade changes.
