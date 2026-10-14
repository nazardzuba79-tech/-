# Stocks main72 integration — 2026-10-14

This owner-authorized integration combines Stocks PR512 source `75e2453ed85c03d12114f2e29ba9acf0f6e6f31f` and main `72f0a5944b01b4d2596957ba6939b397beb8660c`, common base `d694b2a0c493c0fad7d496ae47a15ad8eb0429a6`. The integration commit is the commit containing this record; its exact SHA and final CI are recorded on PR512. No main/other-branch mutation, deployment, production data change or real financial operation is authorized by this record.

## Lossless conflict resolution

Nine content conflicts were resolved: seven locale files, i18nLanguageChunks.test.ts and AI_HANDOFF.md. Independent verification before the explicit CI/handoff additions established:

- Each locale preserves all 1891 baseline values, 86 original Stocks additions and 184 main Chart Workspace additions: 2161 unique keys, no collisions, missing/extra values or baseline changes.
- The translation regression retains both branches' 15 added lines: Stocks exclusions/count/nonempty checks plus Chart Workspace exclusions. Existing assertions remain.
- All 94 main-only paths retain main72 mode/blob bytes; all 587 Stocks-only paths retain source75 mode/blob bytes.
- All 39 services/stocks-global files are unchanged from source75.
- The handoff retains every source75 byte plus main's exact 9152-byte appended block, SHA256 `3b4eda39c0b284c86ffd4f28ec1e38ed6457f6a2c355a260e9de65dd666cb6ec`. This integration's handoff entry is appended after that.
- Shared PriceChart/TerminalChart/ChartToolbarMenus, Futures/Spot pages, new chart tests and backend chart updates retain main72 changes. The Stocks Professional B source and financial rules are unchanged.

## No repeated experiment or validation waiver

The consumed stocks-auth-one-burst job is now restricted by an additional required exact-head predicate to source75. The two older finite auth jobs retain their original dc5327b7 pins. The review plan and historical policy/manifest bytes are unchanged. An expanded existing guard checks all three historical head restrictions and rejects an alternative OR/head condition.

Real UI/src integration is not a QA-only follow-up. Backend admission must report `full` and browser admission `run`; failed or unproven admission must not skip either. No original workload thresholds, provider limits, financial rules, backend expected values or browser security prerequisites are relaxed.

## Retained measured FAIL

Actual source75 C50 run [38554393018](https://github.com/nazardzuba79-tech/-/actions/runs/38554393018), job 115823392640: 23 HTTP 200 and 27 DEADLINE_3000MS. Client-terminal p50/p95/p99 3000.988/3001.705/3001.937 ms include deadlines. Capture COMPLETE; safety PASS; cleanup COMPLETE. Artifact 11890151195 is 5,309,101 bytes, SHA256 `bd7909499e70535c8ec871caa846bc8c861185ea25e56996b67909c3cfc792e7`.

Measured service CPU: 268.613 ms across a broader ~5395.772 ms cgroup bracket, using 99.56% of the 0.05-vCPU quota; 54/54 throttled periods and 5107.933 ms throttled. Peak RAM: 59.078 MiB, no OOM. SQLite: 40 reads, zero writes/transactions/block I/O; read p95: 0.099 ms. This supports CPU quota saturation/delayed ingress for this read-only burst. Most main CPU remains unassigned; fsync and total instrumentation cost are unmeasured. It is not a matched before/after benchmark or 20/50-user acceptance.

Actual worker FULL=2 / DELETE; all 50 ledgers and the closed seed unchanged; Alice/Bob and forged-owner checks retained. Three containers exited naturally with code 0 and were removed; the owned image was removed. Independent safety audit: 33/33 PASS. The earlier 8d initialization failure had 0 HTTP requests and is separate from this sole actual measurement.

## Validation and unresolved release gates

Local admission/no-replay guards: 31 PASS, 0 FAIL, 0 SKIP. Full rawlog SHA256 `01be236c00c57c2b1f2a651cb534df222f049ca5a535c112a3c26098fabadcd3`.
Local full frontend Jest completed: 269 suites (264 PASS, 5 FAIL), 4292 tests (4286 PASS, 6 FAIL), zero skipped. The complete JSON is retained with SHA256 76d385f5b332d72fb336a48838054c79e5ead0514887b346a35cb2b3712cceb9. The failures are two Card asset hashes, one chart multiline guard, one Spot multiline guard and two Academy CSS guards. Independent diagnosis binds all affected source bytes to the canonical index/main72 and identifies local system core.autocrlf conversion; no source/assertion change was made. The original FAIL is retained. An isolated canonical-byte rerun of only those five suites is pending.

Frontend TypeScript: PASS, exit 0 (26.322 s). Enabled US/RU production build: PASS, exit 0 (25.655 s, 6162 modules), with a greater-than-500-kB chunk warning. These local results precede the integration commit; exact-head FULL backend/browser and all CI remain pending. No pending check is a PASS.

The retained strict 20/50-user and crypto-coexistence gates remain FAIL (crypto p95 +13.6486%/+13.8114% vs<=5%). Earlier backend has 9 failed assertions plus one suite collection failure; browser never launched because Chrome/parents ownership and 0777 permissions failed the safe preflight. Static source equivalence to main72 does not replace rerunning FULL/backend/browser for this integration.

MOEX/SBER remain blocked; Bybit/Binance commercial redistribution rights and production capacity are not cleared. The coordinator's one passive 24-hour observation remains pending until 2026-10-14T19:57:16.101Z; this task neither reads nor restarts it early. Existing hardware inventory is not spare-capacity evidence. No new-server requirement or production readiness is inferred.

Release verdict: **BLOCKED**. No merge into main or deploy.

## External push safety correction

Read-only platform checks on 2026-10-14 found that Cloudflare Pages project voltex-exchange automatically publishes all non-production branches as previews; production remains linked to main. Source75 already has an automatic preview at https://b43afb76.voltex-exchange.pages.dev. Earlier no-deploy statements described the absence of manual/production deployment but missed that automatic preview; they are corrected here. No deployment settings were changed.

The new integration commit must start with [CF-Pages-Skip], the official Cloudflare-specific deployment skip prefix, while retaining GitHub CI. All 13 services across both owner-selected Render workspaces were read: none targets this Stocks branch, and all PR previews are off. The repository Webhooks page has no custom hooks. Installed Northflank integration still needs its read-only configuration check before push.

Reference: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
