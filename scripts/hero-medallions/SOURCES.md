# Homepage hero medallions — sources and pipeline

The hero shows eight pre-rendered medallions and one platform as transparent
WebP files in `frontend/public/hero/medallions/`. Nothing in the hero asks an
external host for an image, font or script, and the marks identify the
corresponding currency, commodity, currency pair or company only; they do
not imply sponsorship or partnership.

## Renderer

`render3d.py` is a small numpy renderer (signed-distance ray marching):

- Coin: a thick disc with a rounded outer bevel, a flat polished gold bezel,
  a thin groove and a recessed face (graphite or white ceramic). Logo and
  ticker are relief decals on the face with their own material (gold,
  graphite, raster colour or a gradient) and a cast edge shadow.
- One studio environment for every asset: a key light upper-left, a cool
  fill from the right, a warm fill from below (the platform's light), a dark
  horizon band in the reflections, ACES tone mapping.
- Platform: three graphite tiers with gold bands, an emissive gold top with
  concentric grooves, a blurred glow and a floor reflection, framed tightly.
- Output is straight RGBA PNG with a soft baked shadow under each coin;
  `frontend/public/hero/medallions/*.webp` are those PNGs saved as lossy
  WebP (quality 90 coins, 86 platform).

Re-render everything (Python 3 with numpy and Pillow, Chromium via the
project's Playwright for the logo rasters):

```
cd scripts/hero-medallions
node raster-logos.cjs logos logos-png 512            # SVG -> 512px PNG masks
python3 render3d.py specs/btc.json out/btc.png       # one asset
python3 - <<'EOF'
from PIL import Image
Image.open('out/btc.png').save('../../frontend/public/hero/medallions/btc.webp', 'WEBP', quality=90, method=6)
EOF
```

`specs/*.json` hold each asset's face, logo box, label and tilt; the label
font is Inter Bold (SIL Open Font License, fetched from Google Fonts at
render time and not committed).

## Logo sources (`logos/`)

### Simple Icons (MIT, `LICENSE-simple-icons.txt`)

Path values are copied without alteration from the already pinned local
`@icons-pack/react-simple-icons` **12.9.0** dependency
(https://github.com/icons-pack/react-simple-icons):

- `eth.svg` — `src/icons/SiEthereum.tsx`
- `sol.svg` — `src/icons/SiSolana.tsx` (rendered with the Solana gradient)
- `aapl.svg` — `src/icons/SiApple.tsx`
- `nvda.svg` — `src/icons/SiNvidia.tsx`
- `btc-mark.svg` — the “B” sub-path of `src/icons/SiBitcoin.tsx`, without
  the surrounding disc (rendered as gold relief).

### VOLTEX artwork

- `gold.svg`, `oil.svg` — the existing `GoldIcon` and `OilIcon` from
  `frontend/src/pages/home/HomeHeroAssets.tsx` at main
  `8cbb74becc694ef29b90691d3f472390f2a1a413`, rendered with `size={24}`; only
  the SVG XML namespace was added.
- `eurusd.svg` — drawn for this hero from basic rectangles and circles: a round
  EU flag (12 stars) overlapping a round US flag. No external artwork.

## Product status shown on the medallions

EUR/USD, Gold (XAUUSD) and WTI oil (WTIUSD) are in VOLTEX's CFD catalogue
(`frontend/src/lib/cfdPresentation.ts`) and carry a CFD badge. AAPL and NVDA
are labelled “STOCKS SOON”: stock trading is not available yet. US500 is not
in the CFD catalogue, so it is not in the scene.
