# Isolated Render reference review

The owner confirmed workspace `Крипто Биржа` (`tea-da3vnnjm8hqs73ddbqm0`) on 2026-09-13. A fresh connected Render read found the two existing staging services still on `codex/bybit-live-market-data`, auto-deploy off, deployed at `3b5045c4fea665c98986fddb8388378f22ff3177`. The current API Dockerfile starts Prisma migrations before the exchange. Existing staging DB isolation is unconfirmed; do not redeploy it or copy its credentials to run this diagnostic.

## Dedicated free read-only service

Entry point: `node scripts/cfd-reference-review.cjs`.
Build: `npm ci --ignore-scripts --no-audit --no-fund && npx tsc --strict --skipLibCheck --target ES2020 --module commonjs --lib ES2022,DOM --outDir dist/services/marketData/cfd src/services/marketData/cfd/PublicReferenceFeed.ts src/services/marketData/cfd/PublicReferenceDisplay.ts src/services/marketData/cfd/catalog.ts`.
Only environment setting required: `VOLTEX_CFD_REFERENCE_REVIEW=true` (and platform-provided PORT). Use Node 22, free plan, a single instance, no auto-deploy. Do not claim the service exists or is live until the Render action and deployment are checked.

The entrypoint imports only pure catalog/reference parsers/serializer, never the exchange, Prisma, auth or DB bootstrap. Explicitly refuses exchange/database credential settings. Every write verb returns 405, no account or trading route exists. A separate minimal review page displays actual reference observations, dates, basis and unavailable states; it is NOT the full exchange frontend or a production deployment.

Read endpoints: `/health`, `/api/v1/cfd/tickers`, `/diagnostics`, `/`. Health means the review process is reachable, not that every source is current. `/diagnostics` contains bounded per-source attempt/failure totals, last outcome, retained last failure, stage, HTTP status, byte count and source/HTTP timestamps; it contains no raw body, URLs, headers, credentials or account data. These diagnostics are public only on this isolated service. It does not expose the existing exchange's protected diagnostics.

Instrumented transport uses the existing seven fixed URLs and actual parsers, limits bytes, forces no redirects, makes no extra requests, and preserves response bytes. It does not relax timestamps or change quote-admission rules. Collection is one process, every 15 seconds checking the original minimum 60-second/hourly/six-hour target schedules. Failure recovery retains the prior error evidence instead of treating a later good sample as proof the prior failure never happened.

This test does not establish commercial redistribution rights, exact-contract execution equivalence, persistence, distributed ownership, market-session transitions, or all-instrument double-live coverage. Source-rights and rollout gates in CFD_PUBLIC_REFERENCES_ROLLOUT.md remain. No merge or production activation is authorized by workspace confirmation.
