# VOLTEX CX23 — finite 24-hour passive resource pilot (review only)

**Status:** SOURCE PREPARED; NOT DEPLOYED; NOT STARTED. Do not interpret a green GitHub check as capacity PASS. No production changes have been made.

Related: [Issue #505](https://github.com/nazardzuba79-tech/-/issues/505). Parent PR #512 (Draft). Main, #497, live PostgreSQL, exchange production, orders, the Hetzner tariff and real money are outside this change.

## Scope

This branch contains:
- `scripts/cx23-24h-readonly.mjs` — finite, passive Linux sampler. Reads host CPU/iowait, memory, swap, root disk free, /proc/pressure; optionally Docker container stats or one PID RSS. Writes exclusive NDJSON with mode 0600. Does not request market data, HTTP APIs or perform trading mutations.
- `scripts/cx23-24h-report.mjs` — summarizes the file and explicitly returns `NOT_DECIDABLE_FROM_RESOURCE_TRACE_ALONE`.
- `scripts/cx23-24h-readonly.test.mjs` — five safety/format checks.

Locally verified on Linux Node 22: **5/5 PASS**. GitHub blob identities match the locally tested sources:
- sampler `ddd11ed90e404723107d350c40d3a19727c3070c`
- report `bfb37b5fd40e28fb5bbb5558994ede864cc87e0a`
- tests `e39685f221ca16c3bf45002e35b471c979ef1ea6`

## Operator start procedure (requires actual server access)

1. Verify the actual Hetzner CX23 host, memory and disk headroom, current services and backup/recovery options. Determine whether a strictly isolated **private** Stocks trial is feasible without affecting live Spot/Futures. Do not reuse or mutate any real ledger.
2. Transfer **only these three scripts** into an isolated directory on the CX23. Do **not** switch/checkout a production Git working tree, install paid services, expose a new public port, or replace live containers.
3. Linux Node 20+:

```bash
node --test cx23-24h-readonly.test.mjs
mkdir -p "$HOME/voltex-cx23-evidence"
node cx23-24h-readonly.mjs --hours=24 --interval-seconds=60 --tag=pilot \
  --out="$HOME/voltex-cx23-evidence/cx23-pilot-24h.ndjson"
# AFTER the sampler completes:
node cx23-24h-report.mjs "$HOME/voltex-cx23-evidence/cx23-pilot-24h.ndjson" \
  > "$HOME/voltex-cx23-evidence/summary.json"
```

Optional `--docker=true` reads Docker CLI metrics if accessible; optional `--containers=KNOWN-NAME1,KNOWN-NAME2` restricts it to identified names. Do not seek escalated privileges only for monitoring. Do not add `--pid` until the precise process has been confirmed.

The command must remain running for 24 hours; closing a foreground SSH session may terminate it. An operator may use an existing, approved transient process runner. The sampler terminates automatically, uses no cron and refuses to overwrite a prior trace. Its output is private; avoid posting full raw files publicly.

A low-load host trace alone is not a real Stocks performance benchmark. **Do not label the day as a Stocks production test unless a lawful, private, isolated Stocks workload was actually running and independently measured.**

## Evidence required before any tariff decision

Capture what ran and when, paired app-level traffic and error counts (Stocks `RATE_LIMIT`, HTTP deadlines, `ACCOUNT_BUSY`, provider start rates, Spot/Futures crypto p50/p95/p99), cache behaviour, active graphs, CPU/RAM/IO and a before/after control at comparable traffic. Record any gaps explicitly. High host CPU under unrelated workload is not proof that Stocks needs a bigger plan. Idle traffic is not a capacity test.

Approval gates stay unchanged: Issue #505 original 0.05-vCPU/256-MiB workload FAIL; B v2 24/30 PASS with 334 `RATE_LIMIT`; crypto same-core p95 must be <= +5%; commercial quote redistribution rights NOT CLEARED; MOEX/SBER blocked. Never fabricate candles, suppress tests, expand budget limits to force PASS or turn on a public Stocks API.

24-hour outcome must be one of **KEEP CX23** (sufficient matched real evidence), **INCONCLUSIVE** (missing/control evidence), or **UPGRADE JUSTIFIED** (measured CX23-bound resource exhaustion with other blockers resolved). Binance provider budget or missing licenses are not fixed by buying more memory.

**No merge, deploy, live trading, production database changes, public Stocks, paid service, provider/API-key calls, production stress testing, or tariff upgrade authorized by this document.**
