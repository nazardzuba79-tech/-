# Neuryvia AI — private candidate, not an issued asset or public market

Base: main `c1f13828c5d398c6792c2a20be551a7132ecf77a`.
No production write, publication, timer activation, order, allocation, migration, merge or deployment is part of this change.

## Pinned model

`config/test-markets/nryia-20261115.draft.json`: NRYIA/USDT, proposed 2026-11-15 13:00 UTC / 15:00 Europe/Kyiv; P0 1.00000, cap 148.81, model gain 14781%, 240 hours, peak 2026-11-25 13:00 UTC. These are synthetic model parameters, not independent market quotes or promised returns. `tradable:false`, owner allocation 0, fixed manual seed. The eight owner-requested stages and targets are retained exactly (decimal strings normalized).

Existing scenario-controls-v2 WAVES and canonical ticks are reused. The opt-in `terminalPeak:bounded-v1` handles the previously impossible exact final cap. Only the final growth/recovery may touch the cap; earlier targets still require 3% headroom. It cannot be combined with historical replay, positive allocation or tradable:true. After the terminal point the same generator smoothly approaches a bounded range around 96% of the cap; no cycle restarts. Old configurations never enter the new branch. No order/valuation/balance code changes.

The owner explicitly approved the attached **blue N** in reply to the inconsistent green-logo description. Five resized PNGs (20/24/48/128/256), source hash and processing record are in the candidate directory. The 128px PNG is embedded verbatim in the config, within the existing 64KiB limit. No image generation or logo redesign.

## Isolation and evidence

- `scripts/qa-ai-candidate.cjs`: existing real admin router/auth, CloudflareListingStore, two disposable workerd SQLite stores, real built frontend and Chromium 1440/390. Accounts, balances and other market responses are synthetic; external Worker requests and browser sockets are blocked. Only localhost is published/started, then discarded.
- Coverage: unauthorized/user rejection, idempotent import, ticker/name/seed conflicts, stale/missing If-Match, staged/running and repeated start, private preview, ticker/full-name search, Markets, logos, reload, seven translated countdowns, day rollover and mounted opening, terminal chart, unchanged QVTR/ECLV/TYVN fixture records and zero financial requests.
- `scripts/qa/aiCandidateContract.ts`: exact endpoint dates/prices, 240 hours, cap, continuous canonical OHLCV, 1m/5m/15m/1h consistency, closed-candle stability, independent seeds, 72 hours of bounded continuation and all PNG sizes.
- Reproduce: install repository/frontend/market-edge dependencies, generate Prisma client (no migration), build frontend with `VITE_MARKET_EDGE_URL=http://127.0.0.1:8787`; run `QA_AI_CANDIDATE=nryia-20261115 node scripts/qa-ai-candidate.cjs`. Use `QA_PLAYWRIGHT_MODULE` for the installed Playwright module and `QA_OUT` for private artifacts.
- Committed browser evidence: `docs/qa/nryia-private/`. Full screenshots/report are also uploaded by exact-head GitHub Actions. The QA reports describe local simulated time, never future production execution.
- Backend TypeScript and frontend production build pass locally. Vite retains its existing >500KiB chunk warning. Model and frontend unit results plus exact-head CI are recorded in the PR. PostgreSQL-dependent suites are not substituted by synthetic fixtures.

## Name, issuer and infrastructure checks (2026-10-31)

- CoinGecko search API returned empty coin lists for NRYIA, Neuryvia, AELRI and Aelyrix: https://api.coingecko.com/api/v3/search?query=NRYIA . General exact-name searches returned no indexed results. This is not an exhaustive token registry.
- Public VOLTEX catalogue at https://market.voltextech.net/market/listings returned AITH/USDT, QVTR/USDT, ECLV/USDT and no matching new names/tickers at 15:50 UTC. Private production drafts were **not** read; authenticated collision preflight remains mandatory before any later import.
- WIPO https://branddb.wipo.int/ is challenge-gated; TMview https://www.tmdn.org/tmview/ did not expose searchable results to the available reader. Trademark clearance **NOT_VERIFIED**. No issuer/company affiliation, rights, token issuance, independent liquidity or financial suitability is asserted.
- Cloudflare Pages read-only check: production auto-deploy false, preview setting none; current canonical commit `9ed179c697ea86dc6fb97dbbfa5b8674705f2e57`. Existing Worker deployment requires manual dispatch or explicit deploy marker; this PR does neither.

## Later operator gates and rollback (NOT EXECUTED)

1. Obtain explicit owner approval of issuer/rights, pricing disclosure, financial safety, exact launch time, and the model change. Recheck name/ticker/seed conflicts including private drafts, and deployed API/Worker schema compatibility. These candidates are incompatible with the old validator until a separately approved code release.
2. Validate final committed SHA and green CI. Import once through the existing admin API/form, keep unpublished. `scripts/ai-draft-import.cjs` permits remote read-only preflight but **refuses non-localhost creation**; it has no publish/timer command. Do not weaken this guard for this task.
3. Review private preview. Only after a separately approved rollout and owner publication instruction, use existing revision-checked publish to staged, verify isolation, and separately start the timer. Keep tradable:false and allocation 0; no deposits or credits. Do not schedule either automatically from CI.
4. Before any production activation, export prior config/revision and record affected listing ID. A never-published local draft is disposable; restore/recreate the local fixture only. If a future real published listing must be hidden, use its existing pause/stop controls after operator approval; do not delete history or change its listingAt/seed.
5. Code rollback is the prior exact API/Worker/frontend artifact after checking that no persisted terminalPeak config will be read by an older validator. Never roll back PostgreSQL or financial transactions. No production rollback is needed now because nothing was deployed.

The AELRI candidate is a second, stacked Draft PR so this shared opt-in model/QA is not implemented twice. Neither PR is authorization to merge or publish.
