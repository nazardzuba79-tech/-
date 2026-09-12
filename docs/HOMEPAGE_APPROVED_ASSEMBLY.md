# Approved homepage assembly

The 2026-09-11 owner request combines the current reference-matched homepage hero with the previously selected Crypto Card travel hand A, market heatmap and institutional prestige section. The former city-clock section is not restored; the new Global Trading Sessions component replaces its purpose beneath Crypto Card.

## Selected Crypto Card hand A

The source is the preserved local checkout `work/homepage-live-motion` in the enclosing Codex task workspace. Its base is `78326383b8116b81e70e43da67b3f377a883bea6`; the selected travel integration was uncommitted. The owner explicitly selected A and requested the combined page before the subsequent hero task. The earlier selection, source provenance and browser review are recorded in `HOMEPAGE_TRAVEL_CARD_INTEGRATION.md` and `outputs/homepage-combined/review.md` in the enclosing task workspace.

This A means **the selected hand retouch in the travel scene**, not the older `?cardVariant=A` CSS layout. No rejected intermediate banner is substituted. The files copied without content edits are:

- `frontend/src/pages/home/HomeCardTravel.tsx`
- `frontend/src/pages/home/home-card-travel.css`
- `frontend/public/cards/travel/scene-A.png`
- `frontend/public/cards/travel/center-mask.png`

The photo was prepared previously from `outputs/crypto-card-travel-depth/hero-depth-A.png`. Its ancestry is `outputs/crypto-card-hand-v2/variant-A.png`; that earlier retouch used the original website hand as an image-generation reference. This assembly does not regenerate or edit it. A fresh pixel comparison found zero changed channel values between the prepared scene and selected A throughout the protected product/hand region x >= 1000 and original y=150..739 (scene crop starts at y=76).

| Preserved file | SHA256 |
| --- | --- |
| `scene-A.png` | `0d9acee58b04df5f5af2d65cc339d680a727287c39d795e926cad7216da706d4` |
| `center-mask.png` | `985850585f266db712ae6dc1fd0a3b9cb432ae4cf78a7f00714b153511b92294` |
| `HomeCardTravel.tsx` (LF) | `acc9dc7c890ed3a5d644e77b847196c62aa76e3fe099262f209747d582936a0f` |
| `home-card-travel.css` (LF) | `4e7508fe132919937505a3b4f8443a17b40da6c6a87058d255d1d218c993c56a` |

The existing `CardBenefitIcon`, `useCardCopy`, Card masters, `/card` route, localized text and CTA behavior remain unchanged. Existing `MotionStage` supplies the visibility gate for the retained Card motion. The scene is lazy-loaded; its unchanged PNG is 1,643,155 bytes and its mask is 30,631 bytes.

## Institutional prestige and heatmap

Institution source implementation: `6fe9d925be2a4b7316bf26e1b89ebc87a43de806`; factual handoff/source follow-up: `78326383b8116b81e70e43da67b3f377a883bea6`. `HomeEcosystem`, `HomeInstitutionNetwork`, `home-ecosystem.css` and all six original institution SVGs are copied unchanged. They are byte-identical in the preserved `homepage-live-motion` and `homepage-global-hero` checkouts. Original asset provenance remains in `HOMEPAGE_INSTITUTION_SOURCES.md`; no new affiliation or data claim is introduced.

Only the final scene's 15 `home.ecosystem.*` keys are appended to each of the seven current locale dictionaries. Removing those exact named additions recovers every pre-existing dictionary byte. The original dictionary-body fingerprints remain in place and are checked after stripping only this named set; a separate assertion rejects missing, duplicate or extra ecosystem keys.

Heatmap source: `7fbf994168efc0cb1eb3990d54574a053d3cb36d`. `HomeHeatmap`, `homeHeatmapLayout`, `worldMarketCopy` and the existing five layout tests are restored. `home-heatmap.css` extracts only the original heatmap rules and scopes its shared eyebrow/description helpers to the heatmap. No clock component or clock CSS is restored. The heatmap consumes the existing shared homepage market object and introduces no network polling.

## Preservation checks

`homeApprovedAssembly.test.ts` pins the selected hand/mask bytes, accepted Card component/styles, institutional component/styles and original institution logo geometry. It deliberately does not establish a new visual design. Existing heatmap tests verify real-turnover weighting, complete tiling, equal-area fallback, invalid-data filtering and large finite inputs. Full combined-page build and browser results are recorded separately in the final task handoff.

Original checkouts, archived A/B/C previews and source artwork remain untouched. No deployment or merge is part of this assembly.
