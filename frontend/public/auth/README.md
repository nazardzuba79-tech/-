# Authentication artwork

## Russian selected marketing banner — owner clarification, 2026-10-07

`selected-cabin-banner.webp` is the left 919 x 941 pixels (x0/y0) of the
owner-selected saved raster `voltex-premium-gold-button-v6.png`, before the
rejected HTML white cards and community/footer overlays. It includes the
approved woman, phone, two cards, water, existing logo and Russian slogan.
No image generation, retouching, inpainting, text masking or photo substitution
was performed for this implementation. The image is illustrative artwork, not
a customer testimonial. It does not claim a user count or product eligibility.

Source PNG SHA256: `ba851d099f69bd70f6d0a3deb07203800eefd6b8b9d133577c04cc896368f81d`.
Banner WebP SHA256: `a4b8e9d0e84fa4e95c4db1b561fefdcde9d0a8ed98f748a460ba989a22ecd1ae`.
Lossless WebP, 805754 bytes. Decoded RGB pixels were compared against the
source crop and are identical. The right raster form is outside this crop;
the application renders real existing form fields and handlers instead.

The Russian desktop panel follows the raster's aspect ratio at viewport height,
with a 60% column cap preserving form width. Cover/center-top needs at most a
small side-background crop before the compact breakpoint; protected logo,
slogan, face, phone, hand/card regions are checked in browser coordinates.
No stretched pixels, generated fill, overlay copy or clickable image regions.
At <=760px or portrait-like windows (aspect ratio <=3/2), the decorative banner
is hidden without reserved space; the existing Logo appears in the form header.
The embedded copy is NOT localizable, so only `lang === 'ru'` selects it.

## Other locales — previous real business-class photograph retained

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
