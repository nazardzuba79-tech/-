# research/csi — CSI research workspace (isolated from VOLTEX production code)

- `snapshot/` — the owner's research pack `CSI_240_Research_Claude_Codex.zip` (sha256 `afbd0761ca1e8141aef22adae0689da6e0e7292d3889de4473c83941fa1a6ce6`), **unchanged**; 59 files verified against its `FILE_SHA256.csv` (0 mismatches).
- `v1/` — this run: real data collection, validation, pre-registered evaluation, three systems, platform files. Entry point: `v1/README_UA.md`.
- `RUN_STATE.json` — live state of the work (stage, gates, results, unresolved).
- `dist/` — final ZIP of `v1` + `snapshot`.

Nothing here touches `src/`, `frontend/`, `prisma/`, deployments, wallets or trading accounts. Research-only; no trading signals.

Note on packaging: `dist/` is git-ignored by the repository root `.gitignore`, so the ZIP is delivered in chat, not in git. The ZIP excludes `v1/raw/bitfinex/` (206 MB of 1-minute status pages, 1490 files); those raw files are tracked in this git branch, listed in `v1/raw/MANIFEST.csv` and hashed in `v1/raw/CHECKSUMS.csv`.
