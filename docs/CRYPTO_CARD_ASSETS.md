# Final Crypto Card bundle assets

## Source and scope

The owner supplied `VOLTEX-CryptoCard-Codex-bundle.zip`, extracted locally as
`outputs/crypto-card-bundle-20260905`. Its `README_FOR_CODEX.txt` identifies
the two final physical-card masters and the two approved combined phone/card
compositions. The design archive also supplies six photographic JPG scenes.

The public implementation assets are confined to
`frontend/public/cards/crypto-card-final/`. They do not replace Homepage,
Auth, earlier physical-card review assets or any production configuration.
No generated image, card-face redraw, color correction, material replacement,
logo reconstruction or new detail has been used.

The final PNG masters are byte-for-byte copies of the supplied files. Their
lossless WebP alternatives decode to identical RGBA pixels. The PNGs contain
an alpha channel, but every original alpha value is 255: their surrounding
black/white background is part of the approved opaque source, not a transparent
cutout. Both are 1580 × 996. Do not erase their background or reconstruct their
printed elements in CSS/SVG.

Printed names, network marks and the phone's example balance/transactions are
part of the owner's supplied product artwork. They are illustrative pixels,
not account data or evidence of card issuance, a payment-network partnership,
an available card balance or live transaction capability. Real application
functionality is now a backend-authoritative, eligibility-gated persisted
card application (`SUBMITTED`), not issuance. The isolated review disables
account reads and submissions. See `CRYPTO_CARD_PRODUCT.md`.

## Combined compositions and approved copy

The original combined source PNGs contain superseded embedded limit claims.
They are **not published**. The public `.webp` cutouts retain the visible phone
and both cards while excluding the surrounding headline, benefit text/icons
and footer branding. Their remaining phone screen and card artwork are not
repainted. Parts of the phone already outside the original frame cannot be
recovered and were not invented.

The final marketing copy belongs in HTML, as required by the bundle README:

- `До 20% кешбека.`
- `Без комиссий.`
- `$1 млн в месяц.`

Never display the superseded daily-limit statement or change the monthly
amount into an “up to” claim.

## Reproducible cutout geometry

Preparation used Sharp 0.35.4 / libvips 8.18.6 / libwebp 1.6.0. Each original
image was decoded without resizing, given an alpha channel, composited with
the SVG polygon below using `blend: 'dest-in'`, extracted to the indicated
rectangle, then encoded with `webp({ lossless: true, effort: 6 })`. Coordinates
are original-image pixels. Polygon edges are antialiased; original RGB values
are unchanged everywhere the output is fully opaque. Only alpha removal and
canvas extraction were performed; no smoothing or regeneration of the product
artwork was used.

### Hero

- Source: `voltex-cards-phone-hero-source.png`, 1448 × 1086.
- Source SHA-256: `17d2642d1a6c684f522105844089accb81b5349884d4bd07f26ac8b455e5c4a9`.
- Polygon:

```text
1080,88 1448,88 1448,1086 786,1086 786,1030 690,908 495,823
66,680 82,600 276,315 321,287 828,397 974,480 1016,300
```

- Extract: `{ left: 60, top: 80, width: 1388, height: 1006 }`.
- Output: `voltex-cards-phone-hero.webp`, 1388 × 1006, RGBA.
- Pixel audit: 890,617 opaque, 502,953 transparent and 2,758 partially
  transparent pixels. **Zero RGB mismatches** between all opaque output
  pixels and their corresponding original pixels.

### Registration-style composition

- Source: `voltex-cards-phone-register-source.png`, 1122 × 1402.
- Source SHA-256: `f658d72aaa620443e4130460ef7d59f1a3882d61e25d9fc4115a682c3a2c312c`.
- Polygon:

```text
844,60 1122,60 1122,1100 990,1228 910,1228 400,1118 10,981
7,927 139,594 168,570 655,641 674,554 704,444 754,274 792,134
```

- Extract: `{ left: 0, top: 60, width: 1122, height: 1168 }`.
- Output: `voltex-cards-phone-register.webp`, 1122 × 1168, RGBA.
- Pixel audit: 774,829 opaque, 532,564 transparent and 3,103 partially
  transparent pixels. **Zero RGB mismatches** between all opaque output
  pixels and their corresponding original pixels.

The cutouts preserve some original purple background glow around the product.
The polygon bounds are presentation masks, not newly inferred physical edges
or print-ready artwork. Do not interpret them as exact object segmentation.

## Public file manifest

All SHA-256 values below were checked against files on disk on 2026-09-05.
The six JPGs keep their original names and are byte-identical to `design/public`.

| File | Pixels | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `voltex-black-signature-final.png` | 1580 × 996 | 1,253,941 | `494de1377e5fb5ae1108398a1788cd6b98981215b6315edc4aea0cc54f4a3ad1` |
| `voltex-black-signature-final.webp` | 1580 × 996 | 852,638 | `a898845c6893403c920348008e2e5513f8707e7fcefe92cfa03438099eabfa16` |
| `voltex-titanium-final.png` | 1580 × 996 | 1,970,981 | `b4d69e2b18dd4459127ecedcd21876a569275bc83e9878a54466dfc6737195f8` |
| `voltex-titanium-final.webp` | 1580 × 996 | 1,385,302 | `de32c9f131bbd9b0ff867882012b258699f21526f624af708658f6b87683a2d5` |
| `voltex-cards-phone-hero.webp` | 1388 × 1006 | 769,874 | `fbf933426bcdcab2862cd243d7aa934f37549ffa536112d1a99ab11e3d0ec6d1` |
| `voltex-cards-phone-register.webp` | 1122 × 1168 | 719,002 | `9cccc9c8a524e8dfa31982f43d6569b820dbd15ea945194c0eacfd84e29d2ab5` |
| `5165f22b-08e6-4b9b-83eb-d4b778cc9aad.jpg` | 1024 × 1024 | 175,266 | `d67bb871ba92b31d5da246599d8521933b29e1d7b5aa78a8e2e9fcd98c1e5d45` |
| `a71588d4-cbfc-4255-88c2-66a8977c28fe.jpg` | 1200 × 896 | 146,966 | `dcee9a1931938098794285596629337731ce7b1aee44bb0e09ac123c2a457c6c` |
| `beb1109b-fa4d-4739-804c-6e1cb6d5d170.jpg` | 1200 × 896 | 114,622 | `d284af848b57b39e253c8690221ea2bccd2098c270efcebb7fc65f61f881c5f1` |
| `cef11d73-5081-4f82-879c-1d5ef1391f70.jpg` | 1376 × 768 | 116,094 | `43a16892ef7ec21042602b1ba2be36aabd65ae6d60b6a4dd04327a7baa531905` |
| `e02dd952-015e-4a66-851e-4561ff0cc446.jpg` | 1200 × 896 | 83,607 | `0680c82ef237c561c28d1b8888a700641e5dc3a4767da8a578c9c76ad172a4d7` |
| `f944ce76-d7cd-444f-bc2a-3e651c76b609.jpg` | 1200 × 896 | 112,531 | `1e5342a4cf670b59c1c972044fc75d5cb2162c5c80f8a22f38b580d8ce6cbf5a` |

## Validation completed

- Inspected both final masters and both original/cropped combined compositions.
- Confirmed both PNG masters and six JPGs are exact source-file copies.
- Confirmed both physical-card WebPs decode to identical RGBA source pixels:
  zero differing bytes; all original master alpha values are 255.
- Confirmed cutout dimensions, alpha ranges and zero RGB changes in opaque
  product/background regions.
- Confirmed superseded surrounding marketing text is absent from both cutouts.

Page/build/browser validation and integration status belong in the task handoff;
this document records asset preparation only and does not claim deployment.

## Self-hosted archive dependencies

### Responsive scene placement

The final product cleanup also uses `CinematicCardScene.tsx` for the hero and
final CTA. Existing phone-composition WebPs are masked to retain only the
phone; their precomposed card faces are excluded. Both overlaid card faces
reference the exact same approved PNG masters as comparison and currency
sections. SVG viewports exclude external source-canvas margins; affine
placement/tilt and external shadows position the assets without writing or
changing a single source-image byte. Comparison cards remain unoverlapped,
Titanium first and Black Signature second. All public asset hashes above
remain unchanged in the product-cleanup pass.

`CardScene.tsx` renders the original POS/ATM JPG and an SVG viewport of the
approved Black Signature master in a shared 1200 x 896 coordinate system.
The source archive's separately positioned HTML card slots drifted away
from the hands when the photo was cropped responsively. SVG `slice` now
scales both layers together; small masks retain original finger pixels in
front of the card. This is runtime composition of the existing assets, not
image regeneration. The full master files remain unchanged.

- `fraunces-500.ttf`: Fraunces 500, fetched from Google Fonts' stylesheet for
  `Fraunces:opsz,wght@9..144,500`, the same family/weight declared by the archive.
  Distributed with `Fraunces-OFL.txt` (SIL Open Font License 1.1). Inter continues
  to use the exchange's existing UI font stack. The font is scoped to this page.
- `financial-times.svg`: unchanged asset from the archive's declared URL:
  `https://upload.wikimedia.org/wikipedia/commons/2/25/Financial_Times_corporate_logo_%28alternative%29.svg`.
  Self-hosting avoids runtime third-party image calls. The archive's visible
  no-partnership/no-sponsorship disclaimer is retained with the service examples.
- Other service/crypto icons and country flags use pinned versions of the
  archive's icon libraries. No partner or live integration relationship is added.
