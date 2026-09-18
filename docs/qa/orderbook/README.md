# Order-book motion — before / after

Recorded by `scripts/qa-orderbook-motion.cjs` against the REAL built frontend.
Venue socket URLs are pointed at a local WebSocket that replays a fully
pre-generated, seeded frame list (seed `20260918`, 401 frames, one every
100 ms, a drifting mid so the ladder actually shifts). Same seed in, same
frames out — so the two runs below are the same market, not two markets.

`before.json` / `after.json` are the raw counts. `before-book.png` /
`after-book.png` are the panel at the same offset into the same sequence.

| 15 s window, desktop 1920 | before | after |
|---|---|---|
| price rows remounted | 215 (14.3/s) | **0** |
| text rewrites | 2 105 | 4 489 |
| depth-bar transform writes | 1 340 | 1 490 |
| distinct row counts seen | [38] | [38] |
| distinct panel heights seen | [831] | [831] |

| 15 s window, mobile 390 | before | after |
|---|---|---|
| price rows remounted | 225 (15.0/s) | **0** |
| text rewrites | 587 | 1 473 |
| depth-bar transform writes | 255 | 464 |

**Read the text-rewrite rise correctly.** It is not extra work appearing; it
is the same work changing shape. Before, a shifting ladder handed React a new
key for a row that had not moved, so the update arrived as "throw the element
away and build a new one" — counted under childList, never under
characterData. After, the element stays and its three numbers are rewritten in
place, which is what characterData counts. The visible difference is that a
row no longer restarts its depth-bar transition from zero on every shift.

**No data was smoothed to produce this.** The same frames are applied in the
same order at the same time; only the DOM they land in is reused.
