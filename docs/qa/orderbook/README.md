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

## Third pass — the remaining reference details

Row height was the one item I changed my mind about after measuring rather
than after arguing. The reference frame's ladder is **34 CSS px in a 462 px
panel** (ratio 0.0736); ours is **20 px in a 250 px panel** (0.080). The rows
are already the same size *in proportion to the panel they live in* — the
reference simply gives its book twice the width. Changing 20 px to 34 px
would not match the reference, it would make our narrower panel show half as
many levels. Left alone, on a measurement.

Everything else on that list is done: the Spot centre is now last traded +
fixed-width arrow + dollar equivalent on one line (the spread moved to the
band's tooltip, exact, not deleted), the Spot panel gained the reference's
three display modes, and grouping now steps one decade at a time —
0,1 / 1 / 10 / 100 / 1 000 on a BTC book, which is the ladder the reference
dropdown shows.

Deliberately NOT copied: the `…` overflow menu (it would open nothing), and
the global font stack, which is the whole product's, not the book's.

## Fourth pass — the header and the type, both measured

**Header.** The reference gives the book a title row with one action on the
right, then a control row beneath. Spot had the title, the three modes, the
grouping and the collapse all on one line — which is why the panel still read
as busier than the reference after the colours matched. Split into the two
rows, at the reference's proportions (a 462px panel gives ~44px and ~40px;
scaled to our 250px column, 32px and 28px). The collapse button now occupies
the slot the reference gives its `…`. The overflow glyph itself is still not
copied: it would open nothing, and a dead control is worse than no control.

**Type.** Measured on the reference frame and on our render, both normalised
by row pitch so panel width cancels out:

| | reference | ours |
|---|---|---|
| glyph height / row pitch | 0.412 | **0.409** |
| advance per digit / row pitch | 0.289 | **0.312** |

The **size was already right** — 0.7 % apart. The remaining gap is width: our
digits carry 8 % more advance, because Inter's tabular figures are wider than
the reference's typeface. We self-host Inter under `/fonts/inter` and ship no
other family, so matching the typeface exactly means adding a second webfont
for the whole terminal — a product decision, not an order-book one, and the
font files are not available in this environment. A -0.01em tightening closes
part of it. **Residual: roughly 5 % wider digits than the reference.** Stated,
not hidden.
