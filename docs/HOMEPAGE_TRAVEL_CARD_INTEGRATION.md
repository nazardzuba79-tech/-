# Homepage travel Card integration — selected hand A

The owner selected the latest travel composition with hand retouch A for the combined homepage review on 2026-09-11. The ordinary homepage now renders that scene with real, localized HTML text and `/card` CTA links. The earlier homepage A/B/C comparison remains available with `?cardVariant=A`, `?cardVariant=B` and `?cardVariant=C`; those labels describe the earlier CSS compositions, not the later hand retouch options.

## Asset provenance

- `frontend/public/cards/travel/scene-A.png` derives from the owner's reviewed `outputs/crypto-card-travel-depth/hero-depth-A.png` and its clean background layer in the enclosing task workspace. The source banner is cropped from y=76 through y=739; baked text and controls are removed so the application supplies actual UI.
- The product and lower-right hand are copied from the selected A raster without synthesis. Preparation checks found zero changed pixels in the product/hand region x >= 1000, 150 <= original y < 740. The small top-right control removal uses the clean background and the existing original wrist asset, with the same transform as the preceding composition.
- `center-mask.png` crops the existing travel trajectory mask to the same 1672 by 664 frame. It keeps decorative SVG paths clear of the product.
- Original Card masters and all earlier A/B/C source files remain unchanged. No image-generation operation was performed during this integration.

## Presentation and review

Scoped CSS layers provide a dark text-side gradient, responsive image framing, gold/cyan trajectories, restrained city-chip motion, and five colored existing feature icons. At <= 900px, the text and image stack, with a right-aligned crop that keeps the watch and hand visible. Animation uses the existing visibility gate and respects reduced motion. There is no added polling, dependency or backend change.

The complete local build is served at http://127.0.0.1:4180/ by the task's external preview helper, forwarding normal requests to the existing API. It is a local review build, not a production deployment. Logged-out `/card` access correctly opens `/login?next=%2Fcard`; authenticated trading and financial operations were not exercised.

Validation: frontend TypeScript and production Vite build passed. Thirty existing live-market/hero/heatmap tests and seven selected Card preservation checks passed. The unrelated pre-existing Copy/App reversal check was not selected. Browser QA at 1440, 1280, 1024, 768 and 390 CSS px found no horizontal page overflow; the asset loaded and all existing comparison buttons worked. Browser reduced-motion mode was checked; normal-motion visual approval remains with the owner. Native browser screenshots are in the task workspace's `outputs/homepage-combined` folder. No merge or deployment was performed.
