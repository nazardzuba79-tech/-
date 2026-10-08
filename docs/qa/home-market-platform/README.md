# Homepage orbit hero — QA evidence

Owner target: the attached hero image of 2026-10-08 — a large centre medallion
inside an elliptical orbit of crypto, CFD and stocks-soon medallions above a
glowing gold platform, the laptop secondary on the right. Review branch only:
no merge, no production deployment, no production writes.

## What runs

- Nine medallions on one tilted elliptical orbit (rx 144, ry 222 design px,
  equal arc spacing). Order of the centre: BTC → AAPL → OIL → GOLD → ETH →
  NVDA → EUR/USD → US500 → SOL.
- The centre changes every 2.5 s with a 1.2 s swap: the outgoing medallion
  drops to the lower left onto the orbit, the incoming one rises from the
  lower right, out of the platform's light. Depth (`translate` z) keeps the
  incoming medallion in front. One lap of the orbit is ~19 s; every asset has
  had its turn at the centre after 22.5 s, then the loop closes on the same
  pose (no reset). Medallions turn slightly (rotateY ±14°) as they travel.
- Badges: CFD on OIL, GOLD, EUR/USD and US500; STOCKS SOON on AAPL and NVDA;
  crypto shows the ticker only. No quotes are shown.
- Desktop: every medallion opaque, depth through scale (0.55–0.64 of the
  centre) and overlap. Phones: the centre plus the front of the orbit, 2–4
  helpers at any moment, scene placed between the copy and the laptop art.
- The laptop artwork moves right and recedes (art box 20%–100% with a left
  fade) so the orbit owns the centre; its projected live terminal still
  aligns. Copy, CTAs, header and lower sections are unchanged except the
  owner's `Crypto • CFD • Stocks soon` line under the product shortcuts.

## Motion budget

One Web Animation per medallion (transform, opacity, translate), two CSS
spark rotations and one beam opacity pulse — compositor-only properties, no
timers, no frame loop, no new requests. Paused on hover, keyboard focus,
manual pause, hidden tab, offscreen and reduced motion; cancelled on unmount.

## Browser QA (`scripts/qa-home-market-platform.cjs`, isolated fixture)

`report.json` — result PASS, 10 checks, 0 page errors, 0 console errors,
0 unknown API paths, 0 writes.

| Width | Centre coin | Min gap to copy | Min gap to laptop screen | Platform above deck |
|---|---|---|---|---|
| 1920 | 178 px | 35 px | 148 px | 20 px |
| 1707 | 165 px | 31 px | 71 px | 22 px |
| 1440 | 133 px | 55 px | 33 px | 38 px |
| 1366 | 124 px | 46 px | 25 px | 50 px |
| 430 | 109 px | below copy | above screen | 158 px |
| 390 | 102 px | below copy | above screen | 143 px |
| 360 | 94 px | below copy | above screen | 132 px |
| 320 | 85 px | below copy | above screen | 117 px |

Gaps are the worst case over 90 phases of the 22.5 s cycle. Desktop bands
(901–2560 px) were solved from measured copy, screen and deck edges and then
re-verified in the browser.

Performance (1440×900, 2× CPU throttle, 8 s windows): running 481 frames,
p50 16.7 ms, p95 16.8 ms, 0 frames over 50 ms; no long task inside either
window. Main-thread task time 1987 ms running vs 1609 ms paused.
Unthrottled 6 s windows: main build 525 ms, previous PR orbit 629 ms, this
orbit 761 ms (603 ms paused). Market request paths are the existing eight.

Bundle vs main 964d62da (gzip): JS +1984 B, CSS +2356 B; local SVG marks
9186 B raw. The fixture server sends no cache headers, so the eight SVGs
reload on its warm visit.

## Files

- `home-<width>.png` — first screen at each width (resting composition).
- `home-<phone>-hero.png` — the whole phone hero.
- `orbit-cycle-1440.mp4`, `orbit-cycle-390.mp4` — real-time recordings of one
  full cycle (headless Chromium, 25 fps capture).

Not covered: real devices, Safari/WebKit, production Web Vitals.
