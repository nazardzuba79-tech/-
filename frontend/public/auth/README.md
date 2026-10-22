# Authentication artwork

## Russian selected marketing banner — owner clarification, 2026-10-07

`selected-cabin-banner.webp` is the left 919 x 941 pixels (x0/y0) of the
owner-selected saved raster `voltex-premium-gold-button-v6.png`, before the
rejected HTML white cards and community/footer overlays. It includes the
approved woman, phone, two cards, water, existing logo and Russian slogan.
The initial implementation used no image generation or retouching. The latest
owner-approved revision retouches only the inset white-card surface (see below),
without changing the woman, hand or scene. The image is illustrative artwork, not
a customer testimonial. It does not claim a user count or product eligibility.

Source PNG SHA256: `ba851d099f69bd70f6d0a3deb07203800eefd6b8b9d133577c04cc896368f81d`.
Original banner WebP SHA256: `a4b8e9d0e84fa4e95c4db1b561fefdcde9d0a8ed98f748a460ba989a22ecd1ae`.
Current banner WebP SHA256: `692d9c278407952b1943cdb5b88fdd4c3856c82a3dc9ddb15104beafd30bf9a8`.
Lossless WebP, 825184 bytes. The original is retained in Git history; every
decoded RGB pixel outside the authorized card-surface polygon is unchanged.
The right raster form is outside this crop;
the application renders real existing form fields and handlers instead.

The Russian desktop panel follows the raster's aspect ratio at viewport height,
with a 60% column cap preserving form width. Cover/center-top needs at most a
small side-background crop before the compact breakpoint; protected logo,
slogan, face, phone, hand/card regions are checked in browser coordinates.
No stretched pixels, generated fill, duplicated logo/slogan or clickable image regions.
The separate localized HTML block below the subject describes the card using
the owner's supplied wording: 22+ fiat currencies and 70+ cryptocurrencies. These are
owner-provided product claims, not an independently audited coverage list.
At <=760px or portrait-like windows (aspect ratio <=3/2), the decorative banner
is hidden without reserved space; the existing Logo appears in the form header.
The embedded copy is NOT localizable, so only `lang === 'ru'` selects it.

### Card-only retouch — PR #475, 2026-10-07

Built-in imagegen edited an enlarged crop x475/y655/w175/h150. Its result was
resampled to the original scale and blended at 85% only inside the inset polygon
`[[512,681],[614,710],[607,750],[590,751],[578,756],[576,765],[501,744]]`,
with a 1.5px inward feather. The original physical edge and fingers remain.
6221 pixels changed; no size, pose, hand, face, cabin or composition change.
Browser QA decodes the served image and hashes ALL other RGB pixels:
`e102df04852a5032e17e6ae08a6190295a9a5de432b700af4c2fef8a9aecd322`.

Final prompt (built-in edit, not CLI):
> Retouch only the existing printed VOLTEX card surface: mildly brighten its
> ivory/silver face, improve local contrast, and make the existing small planet
> logo and exact word VOLTEX slightly clearer/darker. Preserve gold ring, chip,
> markings, layout, perspective, boundary, size and position. Keep warm natural
> photographic light and softness; no redesign, extra text, 3D rendering, HDR or
> glow. Keep framing, sweater, skin, fingernails, fingers and background unchanged.

Saved project asset: `frontend/public/auth/selected-cabin-banner.webp`.

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

## Retained artwork and decorative community portraits

The owner approved these assets in local design revision 6 on 2026-10-05.

- `aircraft-v6.webp`: the original selected `terminal-woman-cards-v3.png`, re-encoded as lossless WebP. All decoded RGB pixels were compared and are identical (1122 x 1402). The rejected regenerated v5 portrait is not shipped.
- `community-v4.webp`: the approved illustrative avatar strip, resized to 432 x 144 (three 144 px tiles) for 38–42 px display and losslessly encoded. These are decorative illustrations, not named customer testimonials.
- No independently verified source for the previous 1.2+ million investor figure was found. Old copy and comments are not metric evidence. That investor claim and its numeric badge are not rendered. The owner subsequently replaced the neutral community wording with card copy and then the portraits with inline SVG fiat symbols: RUB (ruble), USD (US dollar), CNY (Chinese yuan). Login/Register no longer loads the retained portrait strip; the historical asset itself is not deleted.

No new image generation was used for this release. The white card remains in the woman's hand and the black card on the table, as in the approved asset.

## Premium fiat flag follow-up

The current owner-requested block uses six local SVG flags in order:
EUR/EU, CHF/CH, JPY/JP, USD/US, CNY/CN and RUB/RU. They come from the
already-installed MIT-licensed `country-flag-icons` package. The earlier flag
correction followed the currency-country treatment on TradingView's USD/RUB
and USD/CNY pages without loading or copying their CDN assets.

The circles form one centered overlapping row, with thin white rims and soft
individual shadows. Wide desktops use 36px circles and 14px overlap; compact
desktops use 34px circles and 16px overlap. Mobile uses 34px circles with 12px
overlap, with the localized “and more currencies” hint beside them and the
existing card copy below. On desktop the hint sits below the flags beside the
existing card copy. The hint is available in all seven locales and makes clear
that these six examples are only part of the owner's stated 22+ fiat currencies.

Flags remain decorative; the information is accessible as real localized text.
The full block has no panel or shared raised shadow. No authentication artwork,
form geometry or bottom scrim was edited; the existing portraits remain unused
historical files. No new image generation, dependency or remote asset request
is introduced.
