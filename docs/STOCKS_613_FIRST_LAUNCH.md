# Stocks #613: first-launch decision — 2026-10-24

Base: ecbc23edcaa2a3eec5203906c57a7de09f1dca0c. Fresh main98261cc8; #614 already integrated. **NO-GO for public activation: zero verified data grants for VOLTEX.** This is a short release decision, not a new adapter/market audit. No fresh provider capture was necessary.

## Source rights: current operational GO/NO-GO

NO-GO below means there is no documented grant for the proposed VOLTEX end-user display. It does not mean the API is necessarily paid or that every internal use is prohibited. An authenticated two-person commercial pilot is not automatically personal/non-commercial use.

| Source | Decision and official terms | Private testing vs user display; missing permission |
|---|---|---|
| Binance | NO-GO / realtime grant NOT_VERIFIED. [Vision terms §§2–4](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md) | Free historical archives have a non-commercial license; charts/derived data/caching remain covered. This is not proof of a WS/REST bStocks display grant. Need an explicit grant for live BBO/tickers, REST/native candles, volumes and server caching. Do not substitute Binance DEX terms. |
| Bybit | NO-GO. [API terms §§6.5–6.9, 7.1](https://www.bybit.com/common-static/compliance/legal/BYBIT/df1923006718fbba8ba70d7d762b9866.pdf) | API development is not permission to replicate an exchange, repackage Service Data or exploit it commercially. Need a written exception covering VOLTEX/xStocks display, historical charts and cache/retention. |
| Gate global | NO-GO. [Global agreement §§10.1(d),16.1–16.2](https://www.gate.com/legal/user-agreement) | Personal/non-commercial license; commercial use needs writing. Gate US Annex H display permission covers another entity/API; it is not approval for our global Gate AAPLX feed. Need global-market grant. |
| MEXC | NO-GO. [Agreement §17(d)–(e)](https://www.mexc.com/terms) | Quotes/orderbooks in exchange services, streams and storage/retransmission require written consent. Internal observation does not license users' WS/OHLCV display or a shared cache. Need that consent and cache scope. |
| OKX | NO-GO. [API agreement §§9.2–9.4](https://www.okx.com/en-gb/help/okx-api-agreement) | Personal/internal purposes; third-party display, including free display and unauthenticated endpoint data, needs prior written consent. Need permission for the exact tokenized spot markets and derivatives such as charts. |
| KuCoin | NO-GO. [Terms Articles88–90](https://www.kucoin.com/announcement/en-terms-of-use) | Written permission required for copying/public dissemination, commercial price collection and systematic databases. Personal/internal use is not a VOLTEX display/cache license. Need that grant. |
| Kraken | NO-GO. [Global terms §§8–9](https://www.kraken.com/legal/global-terms) | Content is for the user's own benefit; third-party availability/commercial exploitation is restricted unless permitted. Need xStocks market-data display/retention/territory permission; integration/partner features alone do not grant it. |
| BingX | NO-GO. [Customer agreement, Guidelines for Usage](https://bingx.com/en/support/articles/360033286474/) | Exchange quotes/orderbooks, data streams and commercial market-data use require written consent. Private commercial testing is not a public-display exception. Need consent for WS, OHLCV and shared cache. |
| Bitget | NO-GO. [API terms §§3.1–3.4](https://www.bitget.com/support/articles/12560603797947) | Limited own-platform development/testing license; derivative use, competing clients and repackaging are restricted. Need an explicit rToken data display/candle/cache grant. Native push acceptance also remains unconfirmed. |

**Cost:** a working public endpoint or a zero API access price proves neither redistribution rights nor a zero licensing fee. A free grant for our exact model is NOT_CONFIRMED for any of the nine. No purchase/contact/contract was made. Numeric cache retention and onward chart redistribution rights are not agreed; existing technical cache TTLs do not create them.

**First source:** none can be activated now. Conditional technical first choice is Bybit TSLAX/USDT only, because its complete public stream, same-page reconnect and real REST/native history were verified and it needs one shared spot socket. This choice becomes eligible only after Bybit confirms an appropriate zero-fee written exception; otherwise choose the first provider that grants the actual model. No new adapters are useful until then.

Request to the chosen provider must identify VOLTEX/operator/territories, private pilot and later authenticated/public audiences, token issuer+symbol, live last/bid/ask/volume, REST and native OHLCV, derived charts, server-side sharing, retention/eviction, attribution, no raw-feed resale and no executed trades; confirm any third-party rights and total fee0 in writing. This is a prepared request scope, not permission or an email sent.

## Technical readiness and narrow follow-ups

- Reused base proof:29 successful workflows plus real legacy SQLite FAIL;72 targeted and4893 frontend tests; PG Node22/24 contract, Pages/Nginx TLS and standard login/logout/revocation. These results belong to baseecbc, not the new review HEAD.
- Existing demand/shared-stream bounds:12s viewer leases,16s history leases,512 owners,256 history interests,64 quote waiters; MEXC30-topic shards, bounded reconnect and unchanged five-second quote admission. No per-user sockets or hidden polling. Source-only budget0.25CPU/256MiB/64PIDs/1024FDs is not validated production capacity.
- Root defect corrected for ordinary API builds: root Dockerfile is now pinned Node22, schema-only (no bundled migration directory), with the retained guard before dependency lifecycle and again in runtime. Startup is exactly node dist/index.js with an empty inherited entrypoint; no Prisma migration shell. The checkout may contain protected SQL without breaking this safe API image. Current production is not changed.
- Future API path: root Dockerfile, ordinary checkout, default runtime target; render.yaml selects this API command and autoDeployTrigger off. Gateway remains unchanged services/stocks-global/Dockerfile.release target gateway with exact44+2-byte preparation. Both use pinned Node22.23.3 and require source/image attestation. Existing API/collector source and launcher are retained; no extra collector is spawned.
- Recovered only the saved HTTP/1.1 test Nginx keep-alive correction from b05cb4a4/bdd9f44b; peer-derived headers and uncached authorization remain. No production Nginx change.
- Local follow-up checks: Node22 targeted20/20 PASS, including API/Render/dual-image contract7, root guard6, source-integrity3 and recovered proxy4; API defect RED receipts retained. Future YAML passed the current official Render JSON Schema. The existing exact-head infra CI now builds/inspects both API and Gateway on isolated ubuntu24.04; actual results are reported in #613. No local Docker/Nginx/browser or benchmark rerun; no app TypeScript changed.

## Performance: still NO-GO

Preserved original evidence: me +17.64%, orders/me +9.19%, futures/positions +27.04% p95; balances INCONCLUSIVE. The +5% threshold is unchanged. Saved analysis identifies absent socket-reuse/GC/cgroup/SQL/event-loop attribution and inadequate single-order phase confidence. The old test proxy's HTTP/1.0/no-pool configuration is a confirmed confounder; its correction is not proof that latency now passes. No 50+2 or new timing workload ran.

A separately approved SMALL isolated canary is possible: same free disposable environment, fixture-only PostgreSQL/auth, two read-only sessions, one selected stream, at most5minutes, unchanged order-OFF gates and cadence, bounded resource/HTTP/socket telemetry and stop-on-error. External live data only after its testing/display grant; otherwise approved offline fixtures remain isolated and never appear as real production prices. It proves startup/cleanup/resource behavior, not50+2 or crypto p95 acceptance. Any actual production canary needs a separate explicit installation permission; none was exercised.

## Minimum owner decisions and operations

1. Obtain written zero-fee rights for the chosen source/symbol/audience and caching; otherwise leave all providers OFF.
2. Review the corrected API/Gateway package and exact-source isolated Docker CI; a small canary still requires separate approval. Do not waive performance gates.
3. Reuse/confirm backup/restore evidence. If schema needs changes, separately approve only original hash-pinned additive SQL, manual execution and verification; never root-CMD migrations/reset/seed.
4. Approve immutable gateway digest, existing PostgreSQL authority configuration, independent Pages HMAC credential and private4437/4438 routing/resource budget. Preserve crypto API/collector; any missing compatible authority needs separate API rollout approval.
5. Approve one licensed read-only source and catalogue visibility. Preserve full VITE_API_URL; keep both execution flags and cash operations OFF for everyone. No new accounts/balances/entitlements.
6. On canary failure restore only prior Stocks Pages/gateway image/config and turn data/visibility OFF. No reverse SQL or crypto restart.

Verdict: code review candidate with two narrow safeguards; **not an approved production installation or public-data launch**. External data permission is the next decisive gate; no further exchange implementation is scheduled.

Minimal provider permission request: [DRAFT, NOT SENT](STOCKS_DATA_PERMISSION_REQUEST.md).
