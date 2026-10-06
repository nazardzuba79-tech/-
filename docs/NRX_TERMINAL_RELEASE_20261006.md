# NRX prospective growth stop

Read-only serving inspection on 2026-10-06 found the live API revision
`ead49070a7bc3813c8831ae9f3cf119bceacca01` carrying `marketStructure` but no
`scheduledScenario`. The public edge price followed the same legacy growth.
The main branch's expired v4 schedule had never reached this serving pair.
This is release drift, not a database scheduler or a cache replay.

Version 5 starts at 2026-10-06 17:00 UTC, preserves the canonical price and all
ticks through activation, exhausts the pump for 30 minutes, corrects 60% over
six hours, then stays in a deterministic terminal range forever. The percentage
uses the owner's existing NRX correction setting. No allocation or financial
record is changed. In particular the deployed allocation constant is preserved.

Both API and market-edge must carry this schedule before activation. Run
`node scripts/check-nrx-scenario-release.cjs` before each deployment. If missed,
reschedule into the future and repeat QA; never activate an expired schedule.
Verify public candles against the API's deterministic simulator at the returned
server timestamp, not against a separate wall clock. Keep both prior images/
Worker versions available for rollback. No database restart or migration.

Regression covers the old continuing growth, exact historical preservation,
correction endpoint, terminal range through day 365, restart determinism, and
bundled Worker prices/trades. Tests do not use real accounts or place orders.
