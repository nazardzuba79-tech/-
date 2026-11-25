## Codex · 2026-11-25 · customer listing provenance labels

- Task: remove visible DEMO / SIMULATED / NO REAL TRADING provenance notices from customer-facing Spot listing surfaces.
- Files: `frontend/src/components/TestMarketTerminal.tsx`, `frontend/src/pages/markets-bolt/TestMarketsStrip.tsx`, `frontend/src/lib/__tests__/customerListingPresentation.test.ts`.
- Preserved: machine-readable provenance, execution restrictions, listing state, chart/countdown behavior, admin controls and financial rules.
- Release branch: `release/remove-demo-labels-production-20261125`.
- Verification: source-level regression added; production build/deployment status must be checked separately.
