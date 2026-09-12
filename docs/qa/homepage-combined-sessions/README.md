# Combined homepage review

This review assembles the existing globe/laptop hero, the owner's selected travel Card hand A, heatmap and institutional prestige section. Global Trading Sessions replaces the earlier decorative city-clock concept and follows Card immediately in the rendered DOM. This is a local review build and draft PR; no merge or deployment.

## Provenance and boundaries

- GitHub main fetched before work: `0097d8b72ffb3c5e9f8537e4a9da267ac0586e0f`.
- Existing hero implementation retained from `723cba93ed245851a65d0fe4cd058c8c33944c3d` (draft PR #32).
- Exact approved lower-section sources and asset hashes: [assembly provenance](../../HOMEPAGE_APPROVED_ASSEMBLY.md).
- The current hero, its live-data hooks, original Card masters, application routes/authentication, trading features, backend and database files are unchanged by this assembly.
- Old A/B/C worktrees and previews remain intact. The selected travel hand A is distinct from the older `cardVariant=A` CSS layout.

## Session model

One configuration in `tradingSessions.ts` defines representative Monday–Friday activity windows: Tokyo09:00–18:00, London08:00–17:00, New York08:00–17:00, each in its own IANA timezone. These are indicative regional windows, not exchange calendars, holiday availability or measured liquidity. The visible section explains that distinction and keeps crypto24/7 explicit.

The regional session concept follows [OANDA's session explanation](https://www.oanda.com/us-en/skills-and-insights/education/trading-asset-classes/forex/when-is-the-best-time-for-forex-trading/); this implementation deliberately resolves each date in its own timezone rather than copying fixed EST/EDT tables. Browser [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat) supplies IANA/DST conversion. EU/US changeover weeks are tested separately.

Windows include their opening instant and exclude their closing instant. Overlap is the actual intersection of two windows. The progress indicator measures elapsed window time, not activity. Future openings and overlaps are found across weekends. No prices, volatility, activity percentages or liquidity claims are invented. Sessions do not add any API request; the restored heatmap reuses the existing shared homepage data.

## Motion and performance

One minute-aligned local timeout refreshes clocks. It stops offscreen/hidden and refreshes immediately on return. The existing MotionStage gates map animation; the map includes a pause control and reduced-motion CSS. Static SVG geography and CSS provide the presentation, with no new dependencies or video. The accepted Card PNG remains byte-exact and lazy-loaded.

## Verification

Frontend TypeScript and complete production Vite build PASS. Eleven targeted suites: **106/106 PASS**, including 18 clock/DST cases, actual rendered DOM order, clock-driven status changes, seven languages, exact approved asset/component/style preservation, locale byte preservation, real-data heatmap layout and unchanged hero behavior. Four additional Card suites: **55 PASS / 1 existing failure**. The failing App import assertion in `cryptoCardProductionPromotion` expects an obsolete eager import; App is unchanged, and that failure was already present in the preceding hero review. It is neither removed nor masked. Full repository suite not rerun.

Actual browser QA: **1920×1080, 1440×900/1080, 1024×900, 768×1024, 390×844**. No horizontal page overflow or regional-card overflow at any width. Dashboard precedes map on mobile; actual Card → Sessions DOM and physical order verified. Map motion runs when visible, pauses through its button and pauses offscreen. Production reduced-motion disables map animation. Hidden-tab timer/animation cleanup was inspected, not simulated in the browser. No browser error logs recorded. Anchor scroll margin keeps the session heading below the fixed header when navigating to the section. Current overlap shown in captures is derived from the clock at capture time.

Local production preview: `http://127.0.0.1:4186/`. The optional `4187` proxy changes only the served reduced-motion media query for observing normal motion in the desktop app's otherwise fixed reduced-motion browser; it does not change application source, data or the production build. No public branch deployment is created. Every published commit begins `[CF-Pages-Skip]`, using Cloudflare's [documented Git build skip](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message); no deployment command or setting was changed.

Browser screenshots use the requested CSS viewport widths. Native Codex captures exclude the scrollbar and can return slightly scaled rasters; exported images are resized back to the requested viewport dimensions without altering page content. Section overview contact sheets combine actual captures and are labeled as such.

The Windows environment uses the existing local in-process esbuild-WASM Vite runner because Node child-process pipes are restricted. It builds the complete production app with its existing Vite/React tooling; no repository build configuration or dependency was changed.

## Actual browser captures

- [Combined section overview](combined-overview.jpg) — labeled contact sheet, not a continuous-page screenshot.
- [Card followed by Sessions at1440](card-then-sessions-1440.jpg) — two stacked browser captures.
- [Card1440](card-1440.jpg), [Sessions1440](sessions-1440.jpg), [Hero1440](hero-1440.jpg), [Institution1440](ecosystem-1440.jpg).
- [Card390](card-390.jpg), [Card→Sessions physical transition390](card-transition-390.jpg), [Session dashboard390](sessions-390.jpg), [Map/regions390](sessions-map-390.jpg).
- [Sessions1920](sessions-1920.jpg), [1024](sessions-1024.jpg), [768](sessions-768.jpg).
- [Responsive measurements](responsive.json), [motion observations](motion.json), [targeted tests](test-results.txt), [additional Card tests](card-test-results.txt), [build](build-output.txt).
- [All PR files against main](changed-files.txt), [assembly additions/changes after the existing hero](assembly-changed-files.txt).
