# Stocks #613 — Stage A GO / NO-GO

2026-10-24. **NO-GO for production installation.** Functional isolated acceptance is PASS; the sole authorized coexistence measurement is not accepted. No main merge, production deployment/configuration/SQL, restore, account/balance change, paid resource, provider/trading activation or50+2 occurred.

## Exact integrated candidate and immutable images

- Existing Draft [#613](https://github.com/nazardzuba79-tech/-/pull/613), canonical branch `claude/voltex-mobile-audit-7rpjni-stocks-consolidated`. Reviewed Stage A9db0b4f2/readiness3894caea was fast-forward integrated. Claude's concurrent stricter catalogue0/financial3-probe test and handoff484128dc/bfd68bf3 were retained exactly; stale expected-SHA push was rejected before safe rebase.
- Last tested functional code: `d7c827c6ba4e3351dfa6090512e88336bc4608dc`. A subsequent evidence/documentation-only HEAD is identified in the PR delivery comment; it does not replace the application/image pins below. Main freshly confirmed `98261cc80117e0961f8ebca84499ec2cb3f0e3b4`.
- Actual production API base `89c3ac003b44a6a0e7630d2ecbe5d7164e85b683`, retained live image `sha256:10e66b427b7941fc49335a7fc251c55e6c93a0415e45897f2518798c6e5acc7a`. This API is not an ancestor of all #613: **never replace it with the full #613 API image**.
- Curated overlay `d71821c7fdb6df7f097b247269166aca1c4554f7`, tree `df214f1eaa0220910c07d28b3f5130c966772520`, parent production89c3, Stocks source `3894caea32048a6f5cdbfd046900d0b41743d699`.
- Separate strict `review/stocks-stage-a/provenance.cjs` verifies this ancestry/tree, exact approved Stocks files and only four changed src paths (Stocks router/ingress, index hooks and opt-in prepared auth key). Every other API source, collector, financial/Futures/Native/listing module, buildCommit, original launcher, Prisma schema and locks/config are byte-identical to live base. Existing f97 source/migration guards remain unchanged.

| Frozen candidate | Exact local Docker config ID |
|---|---|
| Curated API | `sha256:8feb54c5466d073e368d53f0ea3d536240dadaa90f4e4a40a6b59698edf57357` |
| Gateway | `sha256:0bd2bb8ce10a38a6dc26ba5041351317552cd06c3d1625054a157980b4c59da0` |

Both were built on free Ubuntu24/Node22.23.3 and saved before any runtime fixture secrets were mounted. The independently inspected archive is158595600bytes, SHA256 `1dd9c1fa44d6b7e63e8065e68a1f67219895db3d76c60423a53f405aafc64d6b`. These are config IDs plus an archive hash, **not registry digests**; nothing was pushed to a registry. Later harness corrections load and verify these exact images without rebuilding them. Original44+2 SQL is byte-verified/packaged, not executed. Only preserved base Prisma DDL is applied to a confirmed empty CI-owned PG.

## Actual acceptance and retained failures

| Gate | Actual result / proof |
|---|---|
| Node22.23.3 compiled catalogue missing-table regression | **1/1 PASS, zero skips**; [mandatory PG CI](https://github.com/nazardzuba79-tech/-/actions/runs/40093631530). Dedicated acknowledged stocks_disposable_catalogue, two synthetic User/Session fixtures, strict ownership guard, DROP only three Stocks tables, compiled router plus actual release-entrypoint child; readiness200/tradingfalse, both users' reads, finance403, revocation401, unchanged positive fixture DemoBalance. |
| PostgreSQL Node22/24 and required release contract | **PASS** at d7c827c6; same mandatory run. All original financial, concurrency, revocation-before-COMMIT, DemoBalance, idempotency/restart/lost-ACK assertions retained. No SQLite fallback. |
| New targeted local harness guards | **9/9 PASS** on Node22.23.3: provenance, final-PG TCP readiness, required PID census/duplicates, resource-sampler responsiveness, transport deadline, financial/history baseline integrity and no-repeat-load guard. |
| Actual production bootstrap and launcher | **PASS** in [functional run40093631446](https://github.com/nazardzuba79-tech/-/actions/runs/40093631446): byte-attested bootstrap1a76646d and original launcher3fd808e8, Node22.23.3, PG18.6, /health exact overlay SHA, exactly one API and one collector. Actual program in production mode runs only inside the isolated CI fixture, with generated secrets and no production connection. |
| Integrated route/browser/security | **PASS**: actual Wrangler4.148 router/workerd → real CA-pinned Nginx TLS → private Docker Gateway → compiled overlay → disposable PG; normal Login/logout/relogin/revocation, both readers, catalogue/terminal1440+390, silent Buy/Sell Market/Limit click/Enter, no financial POST, all trading denied, forged/replayed transport rejected, authority path hidden, outsider private-port denial. No fake quote/candle or provider activation. |
| All-row financial/history invariants | **PASS after normal API initialization**, including CopyPerformanceScenario. Existing base API cold-start warmup creates four original modelled-performance/derived-section rows after20s in an empty database. Pre-bootstrap→settled snapshot records exactly those four source-derived IDs and rejects every other changed table. Stocks interactions then require the ENTIRE non-identity fingerprint unchanged, including these rows; auth Session/SESSION_REVOKED lifecycle is tracked separately. No engine/history code changed or test deleted. |
| Stop/restart | **PASS** on the same immutable candidate: stop, health restart with same SHA, one API/collector again. Previous live-image rollback was **NOT_EXECUTED**; original image/config are retained and production was never replaced. |
| Sole two-reader coexistence | **FAIL** on observed p95 limits; confidence remains insufficient to attribute the effect or guarantee <=5%. See numbers below. No repeat workload after this result. |
| Legacy SQLite revocation | **Real separate FAIL** (expected401, actual200), [control](https://github.com/nazardzuba79-tech/-/actions/runs/40093631462); no assertion removed/changed/hidden. Does not mean the PG release path uses SQLite. |

The functional workflow deliberately still exits FAIL because it carries the unchanged measured performance FAIL. Its result.json separately records functionalResult=PASS and reusedMeasuredEvidence.repeated=false. Supported PG CI passing is **not** production readiness or a repair of legacy SQLite.

Artifacts: [functional/bootstrap/image/screenshots12559684077](https://github.com/nazardzuba79-tech/-/actions/runs/40093631446/artifacts/12559684077), verified ZIP SHA256 `b449ae52049e0bfae720ae28fede1922f706fde92d8c03416111ad2d1ce22974`; [sole measured dataset12559557903](https://github.com/nazardzuba79-tech/-/actions/runs/40092455308/artifacts/12559557903), verified ZIP SHA256 `5b1e13a4276ebe426b686e0990c5499c8c362e5ad5cb1b0ba8f1c4b204591c7d`. Archives retained until29October; verified local copies are held by the operator. Earlier real failures remain in Actions: PG init-only socket race, unsupported raw regclass metadata, internal-only host transport, Docker top missing PID, and the overbroad zero-message assertion that wrongly rejected honest SOURCE_UNAVAILABLE. Only harness issues were corrected; no quota, JWT, financial, history, TTL, polling or market-price rule was weakened.

## Single coexistence measurement — acceptance not met

Exactly one crypto-only180s plus identical crypto+two real UI readers180s on standard free Ubuntu24 (4CPU/~16GiB). Limits: API+unchanged collector0.50CPU/1536MiB (original bootstrap heap1024MiB preserved), Gateway0.25CPU/256MiB, PG0.25CPU/512MiB. No production backup/accounts/secrets or external feeds; Docker28.0.4/Node22.23.3/PG18.6. Crypto requests use the same endpoints/2000ms schedule in both phases; real UI state3000ms/history15000ms. Nginx derives client addresses from actual two loopback TCP peers, not forged forwarding headers. Public120 quota and all safety rules stay unchanged.

Each endpoint has90 observations per phase; units milliseconds. No data or outlier was removed.

| Endpoint | p50 before/after | p95 before/after | p99 before/after | p95 change | Verdict |
|---|---|---|---|---|---|
| /me |5.04 /5.52 |9.93 /11.68 |523.74 /27.06 |+17.64% |observed FAIL |
| /balances |5.19 /5.44 |12.14 /10.93 |521.30 /26.39 |-9.94% |INCONCLUSIVE |
| /orders/me |5.24 /5.43 |9.92 /10.83 |523.27 /26.39 |+9.19% |observed FAIL |
| /futures/positions |5.04 /5.24 |10.07 /12.80 |1505.67 /18.57 |+27.04% |observed FAIL |

Errors0/timeouts0 in both phases. Actual authority148 requests over the combined phase; rolling-minute peak**50<=60**, errors0. Resource sampling17 observations per phase, errors0:

| Component | Mean CPU vCPU before/after | Mean RAM MiB before/after | Peak RAM MiB before/after |
|---|---|---|---|
| API + collector |0.04075 /0.01000 |150.96 /147.65 |209.70 /149.60 |
| Gateway |0.00149 /0.00276 |29.19 /34.25 |32.05 /36.00 |
| PostgreSQL |0.02706 /0.02108 |56.12 /56.15 |57.74 /57.85 |

PG connections13–14 before,14 after. Docker cgroup CPU/memory are measured; host workerd/Nginx/browser/generator resources are not attributed to these containers. The baseline includes the unchanged API's cold Copy Performance warmup; lower combined CPU and much better p99 are **not a Stocks optimization claim**.95% moving-block p95 ratio intervals: /me[0.922,1.616], balances[0.732,1.494], orders[0.695,1.389], futures[0.841,1.552]. All straddle1.05. Strict observed acceptance fails three endpoints; causality/hardware insufficiency is **INCONCLUSIVE**. Do not claim a confirmed Stocks CPU regression, a safe100-user capacity, a tested minimum, or that a new server is required. No capacity PASS, averaging waiver, altered quota/cache/TTL or new load run was substituted.

The subsequent functional continuation does not call benchmark.run; it verifies and reuses exactly the measured artifact/source verdict. Any new measurement, including a longer statistically adequate warm-controlled comparison, needs separate owner approval with original thresholds/rates/budgets retained. Original50/100 and50+2/crypto p95<=+5% tests are untouched and not replaced by this small scenario.

## Current production facts and compatibility boundary

- API remains release89c3/image10e66b42; main98261cc8 unchanged. Prior10:26 read-only snapshot: healthy, one API/collector, restarts0, Node22.23.3, Linux/amd64, PG18.6 Debian12; host2CPU/3819MiB RAM/2609MiB available/13GiB free. Headroom is not tested production capacity. Existing networks voltex-cutover_database/voltex-cutover_egress and host127.0.0.1:13020→3000; no Stocks gateway/listeners installed.
- Narrow refreshed read-only metadata: runtime mode production, release89c3, configured UID:GID1000:1000. Both existing secret mounts are readable at the candidate's UID1000 and authorization marker exists. Only access metadata was read, not secret bytes; no permission, mount, account or configuration changed. Positive CI used generated fixture credentials, not the actual production configuration.
- Generic actual runtime-bootstrap program SHA256 `1a76646d2a0987b9560cb70d2cabe870656b9eab1d7e698d764b2a9aee631866`; original launcher `3fd808e84f20f64d2c007a2c5d52380f676b41fc8b8bed7c741ed2d2a908bffe`. Generic program bytes are attested; private production configuration/credential bytes never enter Git/CI. New recipe includes the unchanged launcher and bypasses the standard Dockerfile's migrate command entirely. API→PG follows the actual bootstrap connection contract; this is not new proof of production PG TLS.
- Nginx config3b8ddd4d/syntax valid/no Stocks route. No production Nginx/Compose/network/CF setting changed.
- Existing read-only schema proof:44 finished migrations/0 unresolved; three Stocks tables and NativeFundingModel absent, User/Session/DemoBalance exist, app role not superuser/CREATEDB/CREATEROLE. No migration or checksum/ledger modification. Stocks issuer/principals/gateway/internal secrets and flags are still not provisioned.
- Existing private selector check found3 distinct selectors but only2 existing/unblocked users (one stale selector). Privately confirm the owner/Ksenia correspondence; never copy stale selector/create an account or change crypto allowlist to satisfy startup. Do not publish IDs/emails/balances. Catalogue readiness still requires two genuine unblocked binding metadata, but does not read/require funded DemoBalance.

## Stage A and Stage B remain separate

| Requirement | A: authenticated no-prices read-only catalogue/terminal | B: future Demo Trading/live data |
|---|---|---|
| Three Stocks tables |**Not required**; actual missing-table regression PASS |required, separately approved SQL/rehearsal |
| NativeFundingModel |not required; do not apply unrelated DDL |separate finance/preflight policy dependency, never fake ledger rows |
| DemoBalance |existing cash untouched; no positive balance requirement |same existing USDT authority, no auto-funding or new accounts |
| Trading |all users silent; frontend/server/cash executionOFF |new explicit owner approval, two-trader/freshness/FX/financial gates |
| Quotes |providersOFF, unavailable prices/candles |commercial rights and verified real provider provenance required |
| Capacity |functional2-reader stack works; strict p95 acceptance **not met** |original50+2 still NOT_ACCEPTED/NOT_RUN here |
| Recovery |no financial DDL; current snapshot restore proof gap remains explicit |approved restore/migration/rollback before SQL/finance activation |

## Verified backups and one restore procedure — not executed

| Artifact | Actual bytes / UTC / ciphertext SHA256 |
|---|---|
| `/opt/voltex-precutover/backups/local-20261024T032311Z/database.dump.enc` |244934106 /03:24:34 /`844a5b0fb76d365f9c8cd79e68f270a5a898757e544e7006fbfdbf879460c211` |
| `/opt/voltex-precutover/offsite/r2-20261024T062902Z/database.tar.enc` |245555200 /06:30:29 /`02ae3b92db25ef4a1906ea4454429e25670f6acf6a64d334a2b97203828b7401` |

Local ciphertext matches its retention receipt; offsite ciphertext matches complete/retention receipts. Uploaded receipt exists; established boto3/IPv4 HEAD returned200 for ciphertext, encryption metadata and complete receipt, with matching byte lengths and SHA256 metadata. This verifies presence/metadata, **not downloaded bytes, decryption or restore**. A preliminary standalone signer403 was not treated as a permission finding; the established workflow succeeded. No backup/upload was created. Local manifest records64 tables; the59-table synthetic migration rehearsal does not certify that production backup.

Newest discovered restore comparison is2026-10-02 18:09UTC (`comparison-voltex_cutover_r2_restore_20261002.json`, allMatch=true). It does not cover either2026-10-24 snapshot. Private RSA decryption-key availability for these artifacts is **NOT_VERIFIED**; the host has the public encryption key and private operator credentials, not proof of a usable restore key.

After **separate restore/environment approval**, use the existing private operator workflow, not public Actions or a second backup system:

1. Pin one exact encrypted snapshot+metadata+manifest, privately obtain the already-authorized decrypt key; reject a stale/pruned/different artifact. Verify ciphertext using `sha256sum` before and after existing remote retrieval. Never upload a production dump/key to GitHub.
2. Use an existing secure isolated Linux operator environment with PG18.6 and no production connection/credentials, collector or quote feeds. Proposed caps: PG0.25CPU/768MiB, decrypt/restore client0.25CPU/256MiB, I/O4MiB/s/32IOPS where supported,20min watchdog, one restore job. Proposed scratch cap8GiB is acceptable only if measured restored data/indexes plus encrypted/plaintext artifacts fit with2GiB reserve; otherwise STOP/review, never silently grow it. Require enforceable quota/isolation;245MB ciphertext does not bound restored size. If these controls/private key/storage are unavailable, STOP before creating a resource. No environment/volume/key was created here, and no Windows Docker installation or new server is proposed.
3. For the local custom-dump artifact, the existing crypto interface is `node <verified-backup-crypto.cjs> decrypt <database.dump.enc> <private-scratch/database.dump> <existing-private-key-file>`. Verify authenticated decryption/plaintext receipt and `pg_restore --list` format first; neither listing nor `--file=/dev/null` proves restoration.
4. Restore once with PG18.6 `pg_restore --exit-on-error --dbname=<owned-isolated-destination> <verified-dump>`. Reject production host/DB/DSNs in the wrapper. Role/ACL/extension prerequisites must be prepared only in that destination; `--no-owner --no-privileges` is merely portability testing and cannot certify original security metadata.
5. Compare all64 tables, schemas, constraints/indexes, sequence state and required ownership/grants to **the same snapshot**, using the existing manifest mechanism; export counts/hashes only. Record actual RPO/RTO and any failure. Do not run services or financial commands against restored private identities.

For later B only, rehearse the unchanged Stocks migration on that restored clone, then obtain separate production SQL approval. Original44-byte/42LF+2raw ledger relation and any resolve procedure must be approved without rewriting old checksums. Do not run generic46-file `migrate deploy`; apply/record only explicitly approved pending migrations, with2s lock/10s statement timeout and verified partial-failure handling. NativeFundingModel is separate. Keep the existing financial pilot preflight unchanged; its failures are not a reason to mutate A's DB.

## One Stage-A network choice; no hidden private-port exposure

For the **initial bounded read-only canary**, reuse the existing host-loopback deployment example: one restricted Gateway container in host network namespace, bind only127.0.0.1:4437/4438; authority URL `http://127.0.0.1:13020/api/v1/stocks-test-cash`, i.e. existing host-loopback API port. Keep private3001 opt-in **unset** in this variant: a host-network Gateway cannot reach the API container's127.0.0.1:3001. Do not publish3001 or weaken provenance headers. API→PG uses the existing client/role/pool.

Exact path: `voltextech.net Pages Function → HTTPS api.voltextech.net Nginx → host127.0.0.1:4438 → Gateway127.0.0.1:4437 → host127.0.0.1:13020 → API3000 → existing PG`. With private port unset, also leave `STOCKS_AUTHORITY_REQUESTS_PER_MINUTE` unset. Gateway uses explicit data/execution=false and WS=false; venue/host overrides stay unset, not the string "false". No DB credential goes into Gateway or browser.

This uses the unchanged public120/60s quota for that internal source IP, **not** the protected240 private quota. It is a bounded-canary choice, not an all-users capacity guarantee. All signed/user/session checks remain; no cached user decision. Future B/private240 uses the previously reviewed API-shared namespace and a separately reviewed production ingress bridge. The old `review/stocks-private-pg-tls/unix-proxy.cjs` is fixture-only (fixture Host, no new HMAC forwarding): **do not install it as a production proxy** or silently replace the host-network example with it.

Host Nginx adds only the Stocks path, forwards the existing allowlisted HMAC/JWT/Origin/Host/CSRF/view headers to4438, and hides `/api/v1/stocks-test-cash` from the public vhost. Use a case-insensitive authority-path deny and verify case/encoded variants against real Nginx before rollout; leave all other API routes unchanged. Stage A still denies wallet/command at the server even if a transport deny is bypassed. No Nginx/Compose/network setting was changed here.


## Cloudflare: actual state and minimal future changes

At10:23UTC projectvoltex-exchange/custom domainvoltextech.net, rootfrontend/build`npm run build`/outputdist, compatibility2026-09-09, production auto-deployOFF/previewsnone, fail_open=true. Full `VITE_API_URL=https://api.voltextech.net/api/v1` preserved. Canonical visibility/execution/proxy/API-ingress flags unset; transport secret absent. DNS A responses use Cloudflare addresses, Worker routes GET200/empty. DNS-record GET403 and rulesets GET403 were attempted once; **NOT_VERIFIED**, no permission expansion. Required access/operator evidence: zone-scoped [DNS Read](https://developers.cloudflare.com/api/typescript/resources/dns/subresources/records/methods/list/) and the relevant read-only ruleset category such as Transform Rules Read/Select Configuration Read, per [Rulesets API](https://developers.cloudflare.com/api/resources/rulesets/methods/list/). No Write/Global API key is needed for inspection.

Current frontend `/__stocks_global/catalogue` returnsHTML200 fallback; API counterpart404. Therefore the new Function/ingress is **not active**. The actual workerd/Nginx TLS/overlay chain and browser passed isolated run40093631446; this is not a Pages-account deployment/build. A DNS change is not presumed necessary: reuse the already active domains/TLS after denied metadata is independently verified.

Minimal approved future Pages configuration: maintain root/full API URL/all unrelated Workers/routes; set fail_open=false, server-only public/API origins+matching transport secret, proxy explicittrue, frontend canonical visibility true only at final canary step; frontend and server execution false, providers false. No new VITE identity/API-origin workaround. Keep auto-deployOFF/previewsnone; make one exact-source controlled account build/deployment after separate approval. Validate only `/__stocks_global/*` is intercepted. Current/previous successful deployment IDs above provide rollback pointers, not a permission to roll back now.

## Ordered next approval package — none applied

1. Review this integrated candidate and the actual functional PASS/benchmark FAIL. Obtain a separately authorized statistically adequate isolated coexistence measurement plan with the same <=5% threshold, rates and safety budgets; do not infer production capacity or buy a server from these data. No new measurement is authorized by this document.
2. Resolve the existing private current-backup/key/restore readiness gap using the one established workflow below, not public Actions or a second backup system. Privately confirm the two existing bindings and approve the issuer/gateway/transport secret provisioning. No new User/DemoBalance/funding.
3. Independently confirm denied DNS/routing/ruleset metadata (Work/operator read-only access); keep auto-deployOFF/previewsnone, full VITE_API_URL and all unrelated services/routes.
4. Only after gates and separate merge/install approval: retain live image10e66b42/config/bootstrap/Pages9dbc9e80/Nginx hash, install only API8feb54c5 with actual bootstrap/launcher, one API/collector and **no migration**. Verify health exact overlaySHA and ordinary Login/Spot/Futures/Wallet. No wholesale #613 API replacement.
5. Approve only Gateway0bd2bb8c with host-loopback4437/4438, public120-budget variant/private3001 unset, data/cash/executionOFF. Check actual listeners and source/keys, no internet private port, no additional collector.
6. Approve the path-scoped Nginx include, syntax check/reload, allowed signed headers and case/encoded authority-path denies; preserve all ordinary API behavior. Approve minimal fail-closed Pages Function origins/HMAC/proxy settings and one exact-source account build/deployment; visibility remainsOFF until JSON transport/forgery/replay tests pass. No secret in VITE/browser.
7. Only after capacity and operational approval, canonical VITE_STOCKS_CATALOGUE_VISIBLE visibility last for the accepted audience. Explicit frontend/server executionfalse and providersfalse; both bound users and all other users cannot trade. Without licensed data the UI honestly remains unavailable, not a live quoted product.

Immediate STOP: source/image drift, missing bounds/keys, wildcard or external private port, second collector, unexpected DB/financial operation, auth/revocation failure, HTML fallback, forged/replay acceptance, licence bypass, OOM, quota breach, changed funds/history, or crypto p95>1.05. Do not random-hotfix production or raise limits.

**Rollback package (prepared, not executed in production):** visibility/proxyOFF, saved Pages9dbc9e80/config, stop only new Gateway, restore prior Nginx include with syntax check. Restore only prior API image10e66b42/config/unchanged bootstrap if API changed; require one collector and old healthSHA. Stage A rollback needs no DB DROP/restore/seed/balance reset/history rewrite. The isolated same-candidate stop/restart PASS is not a previous-live-image rollback claim.

## Decision

**Functional code/image/bootstrap/browser Stage A: PASS for review. Production: NO-GO.** Blocking acceptance is the retained strict coexistence FAIL/insufficient statistical confidence; unapplied production routes/origins/keys/visibility, private bindings, denied routing metadata and current-backup restore readiness remain approval gates. Data rights block real quotations; financial migrations/funded cash/trading permission/50+2 belong to Stage B. No production activation is authorized or inferred from supported PG CI.
