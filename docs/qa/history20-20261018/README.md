# History20 growth window: QA evidence (2026-10-18)

`scripts/qa-listing-history20.cjs` drives the production bundle, the real admin router and the SQLite Durable Object on workerd (Miniflare). It runs on loopback with fixture authentication, and makes no database, financial-endpoint or venue call.

- **Screenshots and `report-synthetic.json`** come from ONE synthetic window: a deterministic 120-day line carrying VHX-01-BTC's committed metadata. It is not market data.
- **`report-owner-pack.json`** keeps only the checks, timings and sizes of the same run with the owner's ZIP imported through the page.
  - Its screenshots show charts derived from the non-commercial sources, so they are not in this public repository.
  - Main figures:
    - import 41 files, 20 windows and 8637 days, in ≈0.3 s;
    - normalized_path deviation ≤ 1.3e-8;
    - BotLab 01 draft 11.3 KB;
    - first-day preview 289 × 5m candles in ≈0.1 s, opening at 2;
    - days 831–861 fragment 181 × 4h candles in ≈0.2 s, high exactly 239.449.

**Intraday model v2 (re-run 2026-10-18).** The checks also cover:

- the model selector (v2 by default, v1 as the baseline);
- the «Наблюдение» / «МОДЕЛЬ» labels;
- a 1d preview labelled as observation.

`history20-preview-first24h-1440.png` shows the synthetic first day at 5m under v2: 143 turns of the 5m closes. With the owner's pack the BTC first day had 142 turns; v1 had none. Each run uses a new listing seed, so these counts vary a little.

Not run: production, real phones, an offline bot harness (none exists in the repository).
