# Authentication artwork

## Business-class photograph — owner-selected option 1, 2026-10-07

Photographer: **Christina Spoerer**. Source: [Unsplash IDihFjpf3-g](https://unsplash.com/photos/IDihFjpf3-g).
Original CDN asset: `https://images.unsplash.com/photo-1674708059513-5f77494844db`.
The owner selected this brighter genuine business-class photograph, replacing
the earlier illustrated/card composition. No person, card or endorsement was
generated or composited. The cabin, face, hands and phone are the original photo.

Copyright license: [Unsplash License](https://unsplash.com/license), allowing
download, modification and commercial use; checked 2026-10-07. Unsplash's
[terms, section 5](https://unsplash.com/terms) separately exclude permissions
for recognizable people and brands from that copyright grant. A model/property
release has **not** been independently verified. Owner clearance of the intended
promotional use remains a production-publication prerequisite; this PR is review
only. This image is illustrative, not a customer testimonial or partnership.

Local, metadata-stripped responsive WebP derivatives (Sharp, quality 84, effort 6):

| File | Dimensions | Bytes | Preparation |
| --- | --- | --- | --- |
| `business-class-960.webp` | 960 × 1440 | 94526 | Original portrait, cover resize |
| `business-class-1440.webp` | 1440 × 2160 | 164848 | Original portrait, cover resize |
| `business-class-mobile.webp` | 700 × 875 | 52452 | Crop x600/y700/w1400/h1750 from 2400 × 3599 source, then resize |

Desktop uses `srcset` and 50vw sizing. Mobile uses a dedicated `<picture>` source
to keep the face, hands and phone in the compact hero. Runtime requests are only
to local `/auth/` assets, never Unsplash or an external image provider.

## Previous artwork (retained, no longer rendered by AuthShell)

The owner approved these assets in local design revision 6 on 2026-10-05.

- `aircraft-v6.webp`: the original selected `terminal-woman-cards-v3.png`, re-encoded as lossless WebP. All decoded RGB pixels were compared and are identical (1122 x 1402). The rejected regenerated v5 portrait is not shipped.
- `community-v4.webp`: the approved illustrative avatar strip, resized to 432 x 144 (three 144 px tiles) for 38–42 px display and losslessly encoded. These are decorative illustrations, not named customer testimonials.
- The owner explicitly confirmed the displayed 1.2+ million investor figure.

No new image generation was used for this release. The white card remains in the woman's hand and the black card on the table, as in the approved asset.
