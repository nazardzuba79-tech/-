# NRX two-week scenario — draft review only

> **Status 2026-10-05: not attached to NEURIX.** Version 3 was never installed:
> the Hetzner API (7cb2ac05) and market-edge (8de23981) both predate it, and its
> 18:00 UTC activation on 3 October has passed. The live chart is the market-edge
> 8de23981 path, which keeps growing (about 6,406 USDT on 6 Oct and 19.3 million
> on 13 Oct at 13:00 UTC). `NRX_TWO_WEEK_SCENARIO` stays in `neurix.ts` as the
> reviewed plan; changing the live path needs a new owner-approved activation in
> the future, installed on BOTH tiers through the release gate below.

**Not approved for production. No merge or deployment was performed for this review.**
Owner updated the live review plan on 3 October. Version 3 activates at
**3 October 2026 at 21:00 Europe/Kyiv (18:00 UTC)**. It must be installed on BOTH
the Hetzner API and market-edge before that boundary; otherwise move the activation
forward rather than introducing it retroactively. All prices, candles and trades
already shown before the boundary remain canonical and unchanged.

## Planned review timeline

All dates below are **2026, Europe/Kyiv (UTC+3 on these dates)**. These are fixed
review instants, not a countdown recalculated on page load.

| Phase | Kyiv start → end | Reference / constraint |
| --- | --- | --- |
| Original listing | 3 Oct, 16:00 | 0.80 USDT; unchanged |
| First impulse | 3 Oct, 21:00 → 4 Oct, 00:00 | Join the already shown canonical price; end at **7.52 USDT**, **+840% from listing** |
| Night balance | 4 Oct, 00:00 → 08:00 | Adaptive range around 7.52; approximate 7–20% volatility, not a hard wall |
| Second impulse | 4 Oct, 08:00 → 12:00 | End at **14.76 USDT**, **+1745% from listing** |
| Third impulse | 4 Oct, 12:00 → 16:00 | End at **58.536 USDT**, **+7217% from listing** |
| Upper range | 4 Oct, 16:00 → 6 Oct, 16:00 | Two-day adaptive range around 58.536; nominal ±20% guide **46.8288–70.2432** |
| Staged selloff | 6 Oct, 16:00 → 22:00 | Six-hour descent with rebounds; **−60% from 58.536**, ending at **23.4144** |
| Final range | 6 Oct, 22:00 → 17 Oct, 21:00 | Adaptive range around 23.4144; nominal guide **18.73152–28.09728** |
| Continuing terminal range | After 17 Oct, 21:00 | Same adaptive behavior; no return to the old exponential path |

The planned program spans exactly **14 days from activation**. **20% is a
nominal guide, not a guaranteed minimum/maximum or hard clipping boundary.**
Range width varies through approximately 7%, 10%, 15% and 20%, with a slowly
drifting center. Occasional actual tick prices and candle shadows can move
beyond the nominal guide and recover. The prices in the table describe the
initial reference guide only; they do not cap later ticks or wicks. The terminal
range uses the same behavior. Here, bounded terminal behavior means the former
growth trajectory never resumes, not that every price stays within a fixed 20%.

Growth percentages are listing-relative:
`0.80 × 9.40 = 7.52` (+840%),
`0.80 × 18.45 = 14.76` (+1745%),
`0.80 × 73.17 = 58.536` (+7217%);
the selloff reference is `58.536 × 0.40 = 23.4144`.
The terminal's existing **24h change** remains a rolling 24-hour measure and is
not relabelled or replaced with listing-relative growth.

## Implementation boundaries

- `neurix.ts` holds the optional NRX schedule; `simulationSchedule.ts` generates
  deterministic future ticks. The listing instant, listing price, original seed
  and listing/seed history are unchanged. The prepared owner allocation is **6,250 NRX = 5,000 USDT at listing price** and still requires the existing explicit maintenance approval/owner verification.
- `testMarketSimulation.ts` joins at the last completed **raw canonical tick**.
  An independent scenario-disabled baseline retains every tick through the
  cutoff, including a cutoff inside an hour/candle. Later reads cannot rewrite
  completed history or reveal future ticks.
- All 1m/5m candles and larger intervals derive from the same 10-second stream.
  Ticker, tape, display book, backend Spot reference and wallet valuation use
  that shared simulation. No frontend-only chart path is introduced.
- VTA and other assets do not activate this NRX-only schedule. No balance,
  order, settlement, allocation or accounting contract is changed. The display
  book remains synthetic presentation, not executable liquidity.
- Future hours do not compute the obsolete baseline trajectory. Only the
  historical cutoff needs it; scheduled hour caching is bounded.

## Required release gate — only after separate approval

Run from the exact candidate SHA immediately before **each** approved backend
API and market-edge rollout:

```sh
node scripts/check-nrx-scenario-release.cjs
```

For a new schedule the command rejects an elapsed activation or less than five
minutes of lead time. Both serving revisions must match and finish rollout
before activation; allow sufficient operational margin. An expired new schedule
must be moved forward and revalidated, never forced through this check.

The Worker deployment workflow invokes this gate. The Hetzner release procedure
is external/manual and **must invoke it separately**. It is deliberately not an
autostart guard: a normal restart after a valid activation must remain possible.

`NRX_ACTIVE_SCHEDULE_SHA256` is only for an unchanged schedule already verified
as installed on **both** serving API and market-edge. An operator must verify
the installed code and schedule before supplying that fingerprint. Copying the
candidate fingerprint into this variable does not establish that verification
and must never be used to bypass an expired new activation. Retain both exact
deployment SHAs and the verification evidence.

### Legacy identity after adding scenario-controls-v2

The gate fingerprints the executable legacy path, including its dispatch
conditions, rather than unrelated v2-only branches. `scripts/nrx-legacy-source.cjs`
partially evaluates the reviewed `mode === 'scenario-controls-v2'` boundaries for
legacy modes. It folds the formatter's legacy arm to the original `round`, checks
that excluded imports have inert module initialization, and rejects hoisted
declarations, unknown dispatch shapes, or remaining references to excluded bindings.
All other source bytes and every asset/schedule field remain fingerprinted.
No generator, activation time, listing configuration or public history is changed.

The projection reconstructs the exact LF-normalized legacy source from serving
API commit `6afe21b0a278d4b01605cf945eaed651f864cd69`; source digests and independent
NRX/AITH/VTA price, tick and candle goldens are pinned in regression tests. Thus
the already verified installed NRX fingerprint remains
`63610d3e181b31f67934f94436a2072a03ed13d4727060e83d80655a03a25961`.
There is no fingerprint alias, history sampling exception, forced activation or
replacement value for `NRX_ACTIVE_SCHEDULE_SHA256`. Do not change that variable
to the candidate's raw v2-inclusive hash. An actual legacy change still requires
the existing prospective activation process. An unfamiliar source boundary fails
closed and must be reviewed before release.

Run the three release identity suites in both NRX CI and Worker verification.
External Hetzner deployment must still invoke the gate from the exact approved
candidate before migration or application activation. After approval, retain the
previous API image/runtime configuration and Worker version for rollback; an
additive `Session.remembered` migration can remain when rolling back the API.
Refresh production migration status and the existing verified backup immediately
before deployment. No production migration/deployment is part of this gate fix.

## Local verification and preview

Local evidence in `output/nrx-two-week/`: **297 passing local tests** in total
(287 regression tests + 2 release identity tests + 8 PostgreSQL tests).

- **287 tests / 18 suites**: all simulator suites plus API, order service,
  matching, wallet valuation and frontend market consumers. Raw cutoff
  continuity and unnecessary future baseline calculation were reproduced by
  failing tests before fixes. Original NRX baseline digests and VTA are preserved.
- **2 release identity tests** cover every schedule field, full asset config,
  all trajectory source modules, key ordering and Windows line endings.
- **8 PostgreSQL tests** passed on a new disposable loopback cluster.
- Backend build, frontend TypeScript and configured Vite build passed.
  Vite retains its existing large-chunk warning.
- Adaptive-range regression coverage requires at least 95% of sampled ticks
  inside the nominal 20% guide, actual excursions beyond it, and recovery within
  20 minutes. It does not assert a hard price or wick cap.
- Offline preview checks and 1440/390 screenshots are regenerated for the
  adaptive-range revision. See `NRX_TWO_WEEK_PREVIEW.md` for the final measured
  check count and candle distribution evidence.
- Fixture-only Spot browser QA passed at 1440/390: market listing, countdown
  transition without reload, chart/book/tape and the standard order form; zero
  browser errors, horizontal overflow or production writes. Its initial run used
  the build before the adaptive-range correction; that run does not validate the
  revised candle shapes.
- The actual bundled Worker passes route isolation and all three price/tape
  targets; the release gate correctly rejects the elapsed activation.

These are local checks, not production verification. Exact-head CI status is
reported separately in the PR.

Offline preview, using the actual compiled engine and no production API/DB:

```sh
npm run build
node scripts/preview-nrx-two-week.cjs
# Optional local interactive page / screenshots:
node scripts/preview-nrx-two-week.cjs --serve --port=4409
node scripts/preview-nrx-two-week.cjs --screenshots
```

Default artifacts are written under `output/nrx-two-week/`; `QA_OUT` can select
another local directory. Rebuild after source changes before comparing output.

Local fresh-process Node timing after the narrow optimization: cold 24h state
about **49 ms**, warm **0.12 ms**; 500 five-minute candles about **50 ms** cold;
the complete 14-day hourly chart about **190 ms** cold / **1.2 ms** warm.
These are wall-clock measurements on the development machine, **not Worker CPU
measurements**. Production Worker CPU usage/limits and rollout parity remain
unverified in this review. No production changes were made.
