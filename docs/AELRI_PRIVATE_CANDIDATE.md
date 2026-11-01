# Aelyrix AI — private candidate, no production activation

Depends on the NRYIA Draft PR's single shared opt-in model and QA, not a second engine. Keep this PR stacked until the shared work is approved; no automatic merge/rebase/deploy.

`config/test-markets/aelri-20261125.draft.json`: AELRI/USDT, proposed 2026-11-25 13:00 UTC / 15:00 Europe/Kyiv; P0 1.20000; exact cap 154.668; synthetic gain 12789%; 192h; peak 2026-12-03 13:00 UTC. This is a private model, not an issued company's token, independent quotation or promised return. Zero allocation and tradable:false.

DEEP_RECOVERY gives a distinct trajectory from Neuryvia's WAVES. The owner's initial 18h consolidation is retained. To satisfy the existing mandatory 24h endpoint contract, the following 24h breakthrough is split into 6h to 2.10 and 18h to 12.00. Thus the day-one target is +75%; the original 42h checkpoint and every later requested checkpoint/date remain unchanged. Nine stages, total 192h. Exact final cap and bounded continuation use the same `terminalPeak:bounded-v1` opt-in, not a new price engine.

The attached purple/gold crystalline A is resized only; five PNGs and source/output SHA-256 records are in `config/test-markets/aelri-20261125/`. The 128px PNG is embedded verbatim and all variants satisfy the existing size limit.

Run `QA_AI_CANDIDATE=aelri-20261125 node scripts/qa-ai-candidate.cjs` after the local setup described in `NRYIA_PRIVATE_CANDIDATE.md`. The same actual admin/auth/Worker/Chromium path tests private draft, conflicts, revisions, preview, staged/running/repeated start, 1440/390 Markets/Spot/Admin, seven languages, reload, day rollover and opening. Unit checks cover every target, canonical OHLCV, cap, stable closed candles and 72h continuation. Browser screenshots: `docs/qa/aelri-private/`; full artifacts in exact-head CI.

Name checks: CoinGecko search for AELRI/Aelyrix returned no coins; exact-name web searches returned no indexed matches. Public VOLTEX catalogue had no collision. Private production drafts and trademark clearance remain unverified; WIPO challenge/TMview availability prevent a definitive registry result. See linked primary sources and timestamp in `NRYIA_PRIVATE_CANDIDATE.md`.

All issuer/rights, pricing, financial-safety, exact time, integration and deployment gates and the operator/rollback procedure in that document apply independently to AELRI. The localhost importer cannot create production drafts. No production database, balance, order, existing listing, timer, frontend or infrastructure is changed. Future displayed chart values in evidence are isolated simulated time only.
