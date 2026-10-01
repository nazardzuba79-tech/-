# Local verification — 2026-09-30

Fresh base `1b045ab34c09e2b95931dd46c5f3a1c5f54ad1c4`. All data and email delivery are local fixtures.

Focused command:

```
npm test -- --runInBand --runTestsByPath frontend/src/lib/__tests__/supportAssistant.test.ts frontend/src/lib/__tests__/supportForm.test.ts frontend/src/lib/__tests__/i18nLanguageChunks.test.ts frontend/src/lib/__tests__/routeCodeSplitting.test.ts src/services/__tests__/NodemailerCompatibility.test.ts
node workers/support-edge/test.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run build --prefix frontend
```

Browser results are in `report.json`: seven viewport widths, no page errors; all 14 FAQ topics used zero API and Worker requests. Three explicit form POSTs across guest success, provider refusal and member success produced two **recorded, not actually sent** emails. No support API requests. External market/font origins were blocked, not contacted.

Full frontend snapshot: 175 suites, 164 passed / 11 failed; 3012 tests passed / 14 failed. Clean-base targeted reproduction: 11 failing suites, the same 14 failed assertions, 291 passed and six artifact-dependent skipped assertions (no baseline production bundle built). No assertion below was altered to hide a failure.

| Existing failing suite on both branch and clean main | Failure category |
| --- | --- |
| chartDrawings | CRLF-sensitive source substring |
| priceChartMarketOrders | CRLF-sensitive source substring |
| cryptoCardVisualConsistency | SVG bytes differ after Windows checkout |
| cryptoCardProductionPromotion | Same SVG hash assertion |
| sharedHeaderStylesheetOwnership | Four path-separator-sensitive assertions |
| registerWalletTailwindOwnership | Windows path separators |
| marketUniverseScale | Windows allowlist paths |
| homepageTailwindUtilities | Windows stylesheet paths |
| noProviderBranding | Windows allowlist paths |
| plainLanguage | Windows allowlist paths |
| spotOrderEntry | Existing balance-reader source extraction mismatch |

The focused test harness now closes its own JSDOM window after unmount, preventing deferred selection events from outliving the test. This does not change browser behavior. Linux PR CI still needs to pass; these baseline results are evidence, not permission to merge.
