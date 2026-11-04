# #659 financial integration — 4 November 2026

Base main: `9d864a0dfa60391ee3a64d7b174cc90a038116fa`. This candidate changes QA only. No production actions, financial policy changes, new modules or Claude-owned UI/runtime edits. Beget deferred.

## Conversion #591

Existing authenticated contracts: `/wallet/conversion/availability`, `/assets`, POST `/quote`, POST `/confirm`, `/wallet/activity`. Quote contains bid/ask, `fee: '0'`, expiry, ledger and quote ID; confirm returns a durable receipt. The enabled QA bundle uses real routes and a new PostgreSQL cluster; unrelated reads and market prices are fixtures, not live venue executions.

Added BTC→USDT and USDT→EUR browser settlement at 1440/390: exact debit/credit, one journal receipt, unchanged DemoBalance, zero fee and quote expiry. Existing fiat→crypto, lost-response/reload, history and refusal checks remain. Client pacing preserves the actual 20/min server limiter. Local: 29 PostgreSQL checks + eight enabled browser groups PASS; default-OFF build PASS. Unchanged demo-ledger suite previously 27/27 PASS. No user-facing labels added.

**Activation NO-GO:** disposable account with 100 USDT and `TEAM_SPOT_SIMULATION_SOLD` receipt for 100 USDT could confirm 10 USDT→BTC (`APPLIED`, 0.00016616 BTC). No withdrawal attempted; this proves missing conversion/provenance integration, not production cash-out. OFF remains until Claude's canonical #630 policy is checked under the same account lock at quote/confirm/replay, preserving ordinary verified-deposit rights. Reproduction: #630 comment 6636891345. No duplicate provenance guard added. Backed reserves/limits also need owner approval.

## Banking

`GET /banking/state` is authenticated/user-scoped but writes `REWARD_ACCRUED`. It is not production read-only. Inserts are atomic per placement/month, not an all-or-nothing GET; interruption can leave earlier rows and retry resumes missing periods. Accrual itself pays nobody.

New real-PG checks: six concurrent state calls plus fresh service produce one row/month; Balance/DemoBalance and foreign placements unchanged; interruption resumes; audit failure rolls back paid marker and both recipient/referrer credits; real HTTP rejects anonymous/revoked/foreign settlement requests and ignores spoofed user IDs. Expanded suite: 17/17 PASS. No runtime change.

## History20 #553

Existing private API + local SQLite Durable Object used unchanged. Added full Worker-restart equality of private registry entry, revision, seed/time anchor and candles with a freshly loaded model. No new external market request during replay. Worker suite 4/4 PASS.

Recovered original extracted owner pack: all 97 manifest SHA256s match. Browser input is a local repack, not claimed byte-identical to original ZIP receipt `82255d3a1502c901734304d3e2e1eb3cef0f9d7e53e5932d7c74e73d7b3482bb`. Current original-pack tests 6/6 PASS; browser 51/51 including all 20 ×1440/390 save/reload/preview cases. Preserve 13 OHLC and seven reference-only scenarios, MATIC derived cap15000%, raw source metadata. Restricted data/screenshots stay local. Existing private-PG suites: 42/42 PASS.

**Activation NO-GO:** production API `41a755a9e163d278e786202be61627697149eb2a` lacks full merged private-mode dependencies, including `shared/history20PrivateSymbol.js`. Compose exact API/private-route + Worker closure with Claude; frontend-only release is insufficient. Private mode remains OFF. ECLV/NRYIA/AELRI unchanged.

## Independent financial and performance evidence

#630 head `b021b8ed4b5cce42123b77cc5d87f3338b47107f`: 21/21 provenance PG tests passed in a new loopback cluster, including evidenced real-deposit withdrawal/admin processing alongside synthetic proceeds. This does not resolve the separate Conversion gap or authorize deployment.

Stocks #661 harness `6a3077b39d48545248caf1e9986f870f50a51d50`, runtime `ad833ee6d16c4c573809fdc14e6fa16a4e371271`: calibrated A/A +1.108528%; 50+2 +18.227612% FAIL against +5%. Keep artifacts13343336229/13344561506 and every measured run; runtime belongs to Claude. No retry-until-green, weaker tests or paid upgrade.

## Release / rollback

This QA-only candidate needs no migration or production installation. Reverting its test commit cannot change financial state. Exact-head CI results belong to the PR's final SHA.

Future functional release order: reconcile installed identities → resolve provenance/reserves and History20 dependency closure → test/seal a narrow artifact → verify OFF flags, compatibility and rollback → obtain owner authorization → apply only that component and verify. Do not publish all main or bypass the unapplied NativeFundingModel migration.

Known baseline: Pages deployment `391140b2-56f1-4931-a18b-8164db5feff7`, source `a623744ad3f1ddb2f8b5a5020798fa3255bf55f5`; API security-preserving fallback `voltex-ai-listings:compat-41a755a9e163`, digest `sha256:6b70a60528b31bbbce744ed75f5eebf096ccfb1a7de414d23eded2798c3293db`. Recheck immediately before any future cutover. Rollback only the approved component, never erase newer financial journal entries.

Local PG18.4/Node24.22 results are not a new production PG18.6/Node22 replay. CI uses its declared versions. No merge/deploy/production migration or flag change performed.
