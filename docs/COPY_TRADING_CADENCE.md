# Copy Trading cadence — what it is, and a safe way to change it

**Nothing in this document is implemented.** It records the current cadence
and a design for the owner to decide on.

## CURRENT CADENCE: 1 trade/day

Exactly **one closed trade per strategy per UTC calendar day**, from
`DAILY_PROGRESSION_EFFECTIVE_FROM = '2026-09-22'`
(`src/services/copyTrading/canonical/dailyProgression.ts`). Every daily row
since carries `numberOfTrades: 1`, a repeat request on the same day adds
none, and N missed days add exactly N (`dailyProgression.test.ts`,
`copyPeriodProgression.test.ts`). Days before the boundary keep the counts
they were published with (0–3 per day).

## What more trades per day would cost (measured, 2026-09-28 → 09-29)

The ledger is stored as ONE JSON row per strategy, and every copied trade
and fee event of every follower is in it:

| | Nazar | Ksenia |
|---|---|---|
| Master trades | 501 → 502 | 473 → 474 |
| Copied trades | 13 566 → 13 630 (+64/day) | 13 975 → 14 023 (+48/day) |
| Fee events | 9 421 → 9 485 (+64/day) | 10 705 → 10 753 (+48/day) |
| State JSON | 8.29 MB (+42.6 KB/day) | 8.41 MB (+30.7 KB/day) |

Each new master trade adds one copied trade and one fee event per active
follower. At 6 trades a day that becomes ~+256 KB/day for Nazar — about
+93 MB of JSON a year on top of today's 8.3 MB — and the daily refresh
decodes, appends and re-encodes the whole row. That refresh already takes
~4 s of CPU on one full core and **42.29 s on production** (0.1 CPU, shared
with the collector). Multiplying the trade rate multiplies that cost and the
memory it needs inside a 512 MB container that already had to be fixed once
for running out (2026-09-23).

## A safe design, for when the owner wants it

1. **Storage first.** Keep follower copies as per-day aggregates (or derive
   them on read) instead of one row per follower per trade, so the stored
   ledger grows with trades, not with trades × followers. Without this, the
   cadence change is not safe on the current host.
2. **A date, not a flag.** `MULTI_TRADE_PROGRESSION_EFFECTIVE_FROM =
   'YYYY-MM-DD'`, strictly after the deploy date. Every day before it —
   including every day of the one-a-day cadence — stays byte-identical, as
   `DAILY_PROGRESSION_EFFECTIVE_FROM` did for the days before it.
3. **2–6 closed trades per day**, the count drawn deterministically from the
   strategy seed and the date, so a replay produces the same day.
4. **The day's return is still the regime's.** The N trades split the day's
   net result: at least one loss on some days (a realistic win/loss mix),
   each trade priced at its own deterministic entry/exit time inside the UTC
   day, each with its own fee and funding. Their net P&L sums to the day's
   realised P&L, so every period figure is still the same ledger derivation.
5. **Tests that must exist before it ships:** the byte-identity of every day
   before the date; N ∈ [2, 6] on every day after it; Σ trade net P&L =
   daily realised P&L; the refresh's CPU time and peak memory at one year of
   growth, measured, against the production budget.

Until the owner chooses this, the cadence stays exactly 1 trade/day.
