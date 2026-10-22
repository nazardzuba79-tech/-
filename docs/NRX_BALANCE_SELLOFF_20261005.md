# NRX — stop growth, balance, selloff, balance

Owner instruction: 2026-10-05.

Forward-only scenario:
- activation: 2026-10-05 10:00 UTC / 13:00 Kyiv;
- preserve every canonical tick/candle/trade through activation;
- stop the legacy growth at the exact activation price;
- balance/sideways for 48 hours;
- sell off 60% over the next 6 hours;
- remain in a deterministic balanced range indefinitely after the selloff;
- range amplitude uses the existing 0.20 scenario setting and keeps natural excursions/wicks.

Release rule: both the Hetzner API and market-edge Worker must carry the exact same scenario before activation. If the release misses the gate, move the activation forward; never backdate it.

No allocation, balance reset, DB migration, listing-time change, or historical rewrite is part of this change.
