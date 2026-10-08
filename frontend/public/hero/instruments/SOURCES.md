# Homepage orbit marks

All marks are static local SVG files. No image, script, font or icon request
to an external host is made by the hero, and the marks identify the
corresponding currency, commodity, currency pair or company only; they do
not imply sponsorship or partnership.

## Simple Icons (MIT, `LICENSE.txt`)

Path values and brand colours are copied without alteration from the already
pinned local `@icons-pack/react-simple-icons` **12.9.0** dependency
(https://github.com/icons-pack/react-simple-icons):

- `eth.svg` — `src/icons/SiEthereum.tsx`
- `sol.svg` — `src/icons/SiSolana.tsx`
- `aapl.svg` — `src/icons/SiApple.tsx`, filled white for the graphite medallion
- `nvda.svg` — `src/icons/SiNvidia.tsx`
- `btc-mark.svg` — the “B” sub-path of `src/icons/SiBitcoin.tsx`, without
  the surrounding disc, with a local gold gradient for the gold medallion.

## VOLTEX artwork

- `gold.svg`, `oil.svg` — the existing `GoldIcon` and `OilIcon` from
  `frontend/src/pages/home/HomeHeroAssets.tsx` at main
  `8cbb74becc694ef29b90691d3f472390f2a1a413`, rendered with `size={24}`; only
  the SVG XML namespace was added.
- `eurusd.svg` — drawn for this hero from basic rectangles and circles: a round
  EU flag (12 stars) overlapping a round US flag. No external artwork.
- US500 has no image; the medallion sets “S&P 500 / US500” as text.

## Product status shown on the medallions

EUR/USD, Gold (XAUUSD) and WTI oil (WTIUSD) are in VOLTEX's CFD catalogue
(`frontend/src/lib/cfdPresentation.ts`). US500 is shown with a CFD badge at the
owner's request; it is not in that catalogue yet. AAPL and NVDA are labelled
“STOCKS SOON”: stock trading is not available yet.
