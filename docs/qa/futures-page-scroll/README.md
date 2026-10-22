# Futures desktop page scroll — evidence

Isolated native demo preview (`scripts/serve-native-demo-review.cjs`, `NATIVE_PREVIEW_FIXTURE=1`), synthetic account and fixture market, no external network.

| File | What it shows |
|---|---|
| `before-after-1280x720.mp4`, `before-main-wheel-1280x720.png`, `after-wheel-1280x720.png`, `after-back-up-1280x720.png` | PR #571: the wheel over the positions panel scrolls the page by the 140px continuation and back (main before / after). |
| `column-wheel-before-after-1728x944.mp4` | The owner's second recording's gesture at the owner's browser size: two notches down and up with the pointer on the order column, twice, then on the positions. Top: main `f080fe6e` — only the column's form slides. Bottom: page first — the whole page moves. |
| `column-wheel-before-1728x944.png`, `column-wheel-after-1728x944.png` | The frame after two notches down over the order column, before and after. |
