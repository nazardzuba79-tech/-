# Physical card raster assets

These assets recover the owner's supplied composite images. They are **not
original print artwork or verified 1:1 reproductions**. No generative model was
used in this corrective pass. The two rejected ImageGen interpretations were
untracked local drafts and were replaced; they are not included in this commit.

## Files and reuse

Masters: `frontend/public/cards/voltex-black-signature.png` and
`frontend/public/cards/voltex-titanium.png`. Both are 1000 × 630 RGBA PNGs with
antialiased transparent corners. Matching `.webp` files use lossless compression;
visible decoded pixels are tested equal to the PNG. Do not regenerate from the
WebP or use the promotional composite as a web card face.

```tsx
import { VoltexPhysicalCard } from './components/cards/VoltexPhysicalCard';

<VoltexPhysicalCard variant="black-signature" />
<VoltexPhysicalCard variant="titanium" className="your-sizing-wrapper" />
```

The component preserves the intrinsic aspect ratio and uses WebP with PNG
fallback. A parent can size/position/tilt the complete image. Do not rebuild the
ring, logo, chip, material or grooves in CSS/SVG/React. The component and review
have no animation, so reduced-motion users receive the same static presentation.
Existing HomeCryptoCard, CardFace, CardPage and Auth uses remain unchanged.

The isolated review route is `/physical-cards`, available through the existing
review navigation. It offers both variants, individual selection, full-size PNG
links and an optional repair overlay. No production route or guard was added.
The review uses a neutral background, no tilt, glow, blur or shadow to obscure
the source/reconstruction differences.

## Source recovery and limitations

`physical-card-provenance.json` records original filenames and SHA-256 hashes,
selected corner coordinates (top-left, top-right, bottom-right, bottom-left),
homography matrices, output hashes and preservation measurements.

- **Black Signature:** source `21_19_15.png`, 1312 × 1199. Four observed card edges
  define a projective transform; bicubic interpolation rectifies the source.
  The rainbow ring, branding, chip, grooves, texture and relative placement are
  retained. Only the lower-right payment mark is masked and filled by harmonic
  interpolation of surrounding material. This repair covers 2.91% of the opaque
  output; the other 97.09% has zero RGB difference from the rectified source.
- **Titanium:** source `21_16_30.png`, 1536 × 1024. Visible top/right/bottom edges
  and the lower-left corner constrain the bounds; the hidden upper-left corner
  is inferred. The foreground card and its bright rim are excluded with an
  explicit polygon. Its 39.17% occluded area is filled with harmonic material
  continuation and a small residual texture sample from visible titanium. Two
  offline cubic curves continue the visible lower-left groove tangents only
  inside that mask. Their unseen shapes are approximations, not recovered fact.
  The separate lower-right payment mark is removed as for Black Signature.
  58.11% of the full opaque card is preserved exactly after rectification; 2.72%
  is mark repair. Visible ring, brand and chip are not moved or repainted.
- Repair maps use blue for occlusion reconstruction and orange for payment-mark
  removal. Uncoloured opaque regions are tested against the original warp.
- These percentages measure RGB preservation **after geometric resampling**.
  They do not prove exact source geometry, unseen artwork, material recovery or
  print quality. Corner estimation, interpolation and source resolution remain
  limits. The 1000px exports do not add detail beyond the roughly 450–700px source
  card extents; no AI upscale, sharpening or colour reinterpretation is applied.
- Titanium retains the source's asymmetric visible layout and lighting. The
  obscured left material/grooves are visibly approximate and may need refinement
  if a full unobscured source is supplied. Do not re-centre the ring/logo to hide
  this: doing so would discard the visible source geometry.
- No payment-network marks, substitute contactless symbol, invented number,
  holder or extra issuer artwork is added. Raw promotional composites and raw
  warps containing those marks are not shipped.

## Reproduce and validate

The offline scripts require Python, Pillow, numpy and opencv-python-headless.
These are **not** runtime/frontend dependencies and Render does not run them.
Versions used: Pillow 12.3.0, numpy 2.5.2, OpenCV 5.0.0.

```sh
python scripts/card-assets/extract.py --black-reference "PATH/ChatGPT Image 4 сент. 2026 г., 21_19_15.png" --titanium-reference "PATH/ChatGPT Image 4 сент. 2026 г., 21_16_30.png"
python scripts/card-assets/validate.py --references "PATH/TO/ORIGINALS"
node frontend/node_modules/typescript/bin/tsc -b frontend
node node_modules/jest/bin/jest.js --runInBand frontend/src/lib/__tests__/reviewPolicy.test.ts frontend/src/lib/__tests__/homeContent.test.ts
```

From `frontend/`: `node scripts/workflow.mjs build`, then
`node scripts/workflow.mjs build-review` and
`node scripts/workflow.mjs preview --host 127.0.0.1 --port 4175`.

Validated locally on 2026-09-05: source hashes, RGBA, alpha, ratio, PNG/WebP
equality, unmasked source equality and mark removal for both cards; TypeScript;
2 Jest suites / 4 tests; production and isolated review builds (existing large
chunk warning only). Browser matrix: 1920, 1440, 1366, 1024, 768, 430, 390, 375;
both images loaded, all bounds inside viewport, intrinsic ratio preserved,
no animation/transform, no page overflow. Variant selection and repair overlay
checked with keyboard and pointer; no warning/error console entries observed.
