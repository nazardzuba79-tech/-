# Homepage global hero motion

This preview keeps the published homepage work from draft PRs #25 and #26, including Crypto Card A/B/C and the institutional scene. The hero refinement is isolated to the first screen. Main was checked again before publication: `be8c0b6f89b41197eacff865d74e7e1941e67f98`; its Copy Trading first-load changes are retained.

## Presentation

The existing headline, description and CTA destinations sit beside a CSS laptop chassis containing the actual market preview. A lightweight SVG globe adds geographic dots, hub labels, restrained route pulses and breathing lights. BTC, Gold and Oil pills replace the old phone decoration. Three CSS foreground planes supply quiet depth; the existing market tape remains below the scene.

## Motion and data

- Existing shared Kraken socket, only when the homepage market source identifies Kraken: six bid/ask levels and six visible recent executions. Real messages are coalesced to at most one React publication per second; no generated ticks.
- Existing public market REST feeds remain the 15-second fallback for tickers, 15-minute OHLC, book and trades. A live trade may extend the provider's last candle only inside that same interval and only after its snapshot timestamp. No invented opening price, volume or new candle.
- BTC pill reuses actual ticker/stream data and bounded observed-price history.
- Gold uses the configured XAUUSD CFD reference quote. It refreshes at most once per 60 seconds using the existing shared scheduler, retains at most 24 real observations and is labelled as a reference quote.
- Oil is not in the verified CFD instrument catalog: `—` and an unavailable label. Unknown numeric values remain unavailable; real zero remains zero.
- Globe routes, lights and foreground fields are decorative geography, not measurements of exchange traffic or institutional connectivity.
- Route pulses take 21 seconds, hub breathing 7 seconds, asset drift 12 seconds (5 px maximum), foreground drift 24 seconds. Existing pointer handling limits tilt and light offsets.

## Safeguards

Hero stream subscriptions release when hidden/offscreen and on unmount; pending callbacks and 15-second silence timers are cleared. Disconnection or silence drops the stream overlay back to the independent REST state. Stale book data is not kept alive by continuing trades. Buffers are bounded; duplicates, malformed rows and old subscription history do not become new executions.

CSS motion pauses offscreen/in background. A keyboard- and pointer-accessible control pauses hero decoration while real data remains readable. Reduced motion removes decorative animation, perspective response and quote transitions. The market tape retains its own pause control, visibility gating and reduced-motion behavior. No new dependency, image, video, canvas, WebGL, backend endpoint or infrastructure configuration.

## Validation

- Frontend TypeScript and production Vite build passed after incorporating current main. Entry JavaScript: 446.70 kB / 156.24 kB gzip (absolute size; no baseline delta claimed).
- 43 focused tests passed across stream, visibility, rendering, shared market lifecycle, hero copy and heatmap suites.
- Seven Card/source-preservation checks passed. The pre-existing unrelated Copy/App reversal assertion is explicitly excluded, as in the published homepage base.
- The newly merged main's separate Copy-first-load test could not start in this checkout because its test-only `jsdom` module is absent from the installed runtime. Its source and dependencies were preserved from main; no full-suite pass is claimed.
- Actual browser checks cover 1440, 1280, 1024, 768 and 390 widths with no horizontal page overflow. Screenshots are saved outside the repository.
- Browser samples confirm changing route offsets, hub opacity, asset and foreground transforms; exact stable transforms while paused; resume; pointer tilt; and paused layers offscreen. Production reduced-motion styles disable the same animations.
- The desktop browser has an OS reduced-motion preference. A temporary local QA server overrides that preference only in served responses to exercise normal motion. Production source/build retain the preference checks; the QA server is not bundled.

## Review

Live-data preview on the review workstation: http://127.0.0.1:4182/

The automatic Cloudflare branch preview verifies the deployable UI. The existing production API does not allow pages.dev origins through CORS, so that public preview displays honest unavailable states until the origin is permitted. Local review uses a read-only same-origin proxy to the actual public API, with no fixture data. The separate normal-motion QA view is http://127.0.0.1:4183/ and is explicitly labelled as QA.

Draft only. No merge or manual deployment.
