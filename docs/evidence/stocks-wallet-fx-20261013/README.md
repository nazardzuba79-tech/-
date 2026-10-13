# Stocks response-only Wallet FX review — 2026-10-13

Status: **BLOCKED for release**. This review narrows unnecessary Wallet conversion work; it does not claim capacity acceptance.

## Source and scope

- Integration commit: a69077aa52c08ac0dedce6f8319f58a7d453409f.
- Wallet fix: b4e54e46b20c566aa6788fbc1f6906dd087daf56.
- Integrated main: 055f88a945c8253b2736877b52f32d028c895086.
- PR512 remains stacked on unchanged PR497. The merge conflict was append-only docs/AI_HANDOFF.md; both sides preserved. Main Spot/CFD source files match byte-for-byte.
- Only response-only USDT Wallet snapshots skip unused USDC FX. Trading state and observations remain dual-currency. Quote cache expiry, two instrument slots, 80 cached instruments, provider budget, order arithmetic, event capacity and FULL SQLite durability remain unchanged.
- Shutdown now drains both native and full FX continuations, including aborted response readers.

## Executed validation

| Check | Result |
|---|---|
| Explicit isolated Stocks workflow suite, integrated source | 173/173 PASS; 0 fail/skip/cancel; 7454.1333ms; local Node24.21.0 |
| Focused Wallet FX regressions | 8/8 PASS; included in173 |
| Independent late FX / released lease check | 1/1 PASS |
| Exact49cdf blanket FX-skip negative control | FAIL as expected: legacy USDC order remains OPEN rather than FILLED |
| Old shutdown-consumer negative control | FAIL as expected: closes before pending FX settles |
| Final GitHub CI / Node22 | Pending for the exact pushed review SHA; consult PR checks |

The eight cases cover native1/FX0 Wallet demand followed by same native/full state FX1; legacy0.6USDC plus0.4USDT shared native capacity; restart/idempotency and Alice/Bob; mixed native/full flights; failed FX and unextended TTL; pending FX shutdown. Offline fixture prices are test inputs only and are not served publicly.

## Remaining acceptance gates

- Original strict0.05vCPU/256MiB/disk/3s and crypto p95≤5% failures remain open, not replaced by lighter tests.
- Prior Bv2 has24PASS/6FAIL (all20/50 distinct cases); retained run38424465702 and artifact11830376374. No fresh capacity result is claimed for this Wallet-only change.
- The outside-repository ticker experiment still exhausts the unchanged100/min budget. See [measured demand](provider-demand.md). No ticker prototype is included in runtime.
- A native stream design is research only; [transport research](stream-transport-research.md) defines required correctness checks, not readiness.
- Production host read-only snapshot confirms2vCPU and3911564KiB RAM, but no24h headroom or coexistence proof yet. Sampler launch remains pending independent safety review.
- MOEX/SBER remains blocked; Bybit/Binance commercial redistribution rights remain NOT CLEARED.
- No merge, deploy, production database or financial changes were performed.
