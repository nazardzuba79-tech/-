# Homepage reference hero: terminal and preservation tests

Final test command, run from `work/homepage-hero-reference`:

```powershell
node node_modules/jest/bin/jest.js --runInBand frontend/src/lib/__tests__/heroReferenceTerminal.test.ts frontend/src/lib/__tests__/homeHeroStream.test.ts frontend/src/lib/__tests__/homeHeroVisibility.test.ts frontend/src/lib/__tests__/homeLiveMarket.test.ts frontend/src/lib/__tests__/homeLiveRendering.test.ts frontend/src/lib/__tests__/homeHeroCopy.test.ts frontend/src/lib/__tests__/cryptoCardProductionPromotion.test.ts --json --outputFile=../../outputs/homepage-hero-reference/hero-terminal-final-tests.json
```

Result: **53 passed, 1 failed, 54 total**. All **47 hero tests pass**: 11 reference terminal, 14 market data, 8 stream, 2 visibility, 3 live rendering, 9 copy/CTA tests. Six Card production tests pass. The unchanged failing production assertion expects an old eager `AdminAuditLogPage` import anchor in `App.tsx`; the current application lazy-loads that page. `App.tsx` was not changed by this task, and the unrelated assertion was not weakened.

Full console output: `hero-terminal-final-tests.log`. Structured results: `hero-terminal-final-tests.json`.

Earlier in this audit, these additional unchanged Card suites passed: visual consistency **35**, presentation **10**, application state **21**, translations **4**. Their results are in `../homepage-hero-reference-terminal-audit.json`. Across these distinct tests plus the final hero/production run: **123 passed, 1 unchanged baseline failure**.

The five explicitly authorized homepage fingerprints were refreshed only after the root agent froze their final source: `HomeHero.tsx`, `HomePage.tsx`, `HomeTicker.tsx`, `TerminalPreview.tsx`, `useHomeMarket.ts`. All other fingerprints and the baseline App assertion remain untouched. `git diff --check` passed for the terminal and changed test files.

The new live-rendering suite was copied selectively from the prior homepage branch; its two unrelated HomeMarkets cases and component imports were excluded because this task preserves current main's lower markets section. All copied hero cases remain. The existing seven-language copy harness now stubs the requested scene/stream/motion dependencies, checks the exact heading text including whitespace, and preserves subtitle, description, CTA routes, one terminal scene, one asset-pill group and one tape.

Repository workflow audit: `android-build.yml` triggers on frontend pushes to main/master or manual dispatch; `security-phase2a-bcrypt.yml` triggers on one named security branch. Neither matches a new homepage feature branch/PR. External hosting integrations are configured outside these workflow files; the root agent separately verified the official Cloudflare skip marker before any push.

No commit, push, merge or deployment was performed by the terminal subagent.
