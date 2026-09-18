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

## Second pass — one book everywhere, measured tokens

Same harness, same seed, now also driving **/trade** (Spot). The Spot REST book is
served as "the snapshot with every delta up to now applied", so a polling page
sees the ladder move exactly as the socket page does. `before-all-books.json`
is `main` after PR #121; `after-all-books.json` is this change.

| 15 s window | before | after |
|---|---|---|
| **Spot** rows remounted | **136 (9.1/s)** | **0** |
| **Spot** row flash toggles (class on/off = the pulse) | **198** | **0** |
| Spot depth-bar writes | 104 | 235 |
| Spot rows shown | 30 | 34 (ladder now fills its panel) |
| Futures desktop / mobile rows remounted | 0 / 0 | 0 / 0 |
| Distinct row counts, all three | one value | one value |

Spot's remounts had the same cause as Futures' (rows keyed by price) plus a
second one of its own: a 32 %-alpha pulse on every changed row on every
publish. Both gone. Depth-bar writes went up because the bar is now a
transform on an element that stays, instead of a width on an element that
was being replaced.

**Tokens, measured from the video (`f_050`, text-free pixels, alpha solved
against the row background):** row bg `#16181e`, text `#eaecef`, headers
`#848e9c`, sell `#F6465D`, buy `#0ECB81`, depth tint alpha **0.09** on both
sides. Applied to Futures, Private and Spot from one CSS block.
