# Homepage orbit hero — QA evidence

Owner target: the approved hero image of 2026-10-08 — a large centre medallion
inside a ring of crypto, CFD and stocks-soon medallions above a glowing
graphite/gold platform, the laptop secondary on the right. Review branch
only: no merge, no production deployment, no production writes.

## What is on screen

- Eight pre-rendered medallions (`frontend/public/hero/medallions/*.webp`,
  built by `scripts/hero-medallions/render3d.py`): a thick bevelled disc
  with a polished gold bezel, a recessed graphite or white face, the mark and
  the ticker as relief, one studio light for every asset, a soft shadow baked
  under each coin. Centre order: BTC → AAPL → OIL → GOLD → ETH → NVDA →
  EUR/USD → SOL. US500 is not in the CFD catalogue and is not shown.
- One platform render of the same pipeline: three graphite tiers with gold
  bands, an emissive top with concentric grooves, glow and floor reflection;
  a CSS light beam and floor glow tie it to the medallions.
- The ring is a vertical circle turned about its axis and projected with
  perspective: the near side (left) is larger and rises, the far side (right)
  is smaller and dimmed to 70%. The ring opens at the bottom, above the
  light, where the centre swaps happen.
- The centre changes every 2.5 s. The outgoing medallion drops through the
  light to the ring's lower-left end; 0.63 s later the incoming one leaves
  the lower-right end, dips through the light and rises into the centre.
  Every asset has had the centre after 20 s; the loop closes on the same pose.
  No two medallions ever touch: the analytic model keeps moving pairs at
  least 90 px apart (static floor 7 px, far-side medallion at the centre's
  equator), and the sampled keyframes jump at most 27 px.
- CFD badges on OIL, GOLD and EUR/USD; STOCKS SOON on AAPL and NVDA; crypto
  shows the ticker only. No quotes.
- Phones: the centre plus two or three helpers from the lower part of the
  ring, the platform below, between the copy and the laptop artwork.

## Motion budget

One Web Animation per medallion (transform, opacity, translate) sampled from
the shared cycle, two CSS spark rotations and one beam opacity pulse —
compositor-only properties, no timers, no frame loop, no new requests.
Paused on hover, keyboard focus, manual pause, hidden tab, offscreen and
reduced motion; cancelled on unmount.

## Browser QA (`scripts/qa-home-market-platform.cjs`, isolated fixture)

`report.json` — result PASS, 10 checks, 0 page errors, 0 console errors,
0 unknown API paths, 0 writes, 0 denied requests. Clearances are the worst
case over 80 phases of the 20 s cycle at each width (copy text and
controls, projected laptop screen, laptop deck; the platform's solid tiers
are measured, not its glow):

| Width | Centre coin | Min gap to copy | Min gap to screen/deck |
|---|---|---|---|
| 1920 | 171 px | 28 px | 60 px |
| 1707 | 140 px | 44 px | 77 px |
| 1440 | 115 px | 61 px | 79 px |
| 1366 | 113 px | 39 px | 50 px |
| 430 | 104 px | below copy | 56 px above the screen |
| 390 | 97 px | below copy | 51 px above the screen |
| 360 | 90 px | below copy | 47 px above the screen |
| 320 | 81 px | below copy | 42 px above the screen |

Desktop bands (901–2560 px) were solved from measured copy, screen and deck
edges with the scene footprint over the whole cycle, then re-verified in
the browser. The platform sits at floor level in front of the laptop, as in
the owner's image; the laptop's front edge below its corner runs flat, so
only the deck's upper edge and the screen bound the scene.

Performance (1440×900, 2× CPU throttle, 8 s windows): running 458 frames,
p50 16.7 ms, p95 16.8 ms, 1 frame over 50 ms; paused 481 frames, p95
16.8 ms, 0 over 50 ms. Main-thread task time 2953 ms running vs 1962 ms
paused (Chromium recalculates style every frame while any animation runs;
the medallions themselves are composited layers). CLS 0.0001. Market request
paths are the existing eight, identical to the main build's baseline. A cold
visit requests the nine WebP renders once (402 KB); the warm visit re-reads
them from the fixture, which sends no cache headers.

Bundle vs main 824a9132 (gzip): JS +2696 B, CSS +1589 B.

## Files

- `home-<width>.png` — first screen at each width (resting composition).
- `home-<phone>-hero.png` — the whole phone hero at 2x.
- `orbit-cycle-1440.mp4`, `orbit-cycle-390.mp4` — real-time recordings of one
  full cycle (headless Chromium, 25 fps capture).

Not covered: real devices, Safari/WebKit, production Web Vitals.
