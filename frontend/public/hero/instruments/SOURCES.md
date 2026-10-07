# Homepage market marks

Four SVG path values and brand colors are copied without alteration from
the already pinned local `@icons-pack/react-simple-icons` **12.9.0** dependency:
`src/icons/SiBitcoin.tsx`, `SiEthereum.tsx`, `SiSolana.tsx`,
and `SiCardano.tsx`.

The wrapper is a static 24 by 24 SVG. No image, script, font or icon request to
an external host is required. The dependency's MIT license is retained alongside
the files in `LICENSE.txt`. The marks identify the corresponding currencies;
they do not imply sponsorship or partnership.

Repository: https://github.com/icons-pack/react-simple-icons

XRP uses the currency mark from the repository already used by the application's
`CryptoIcon` fallback, rather than Simple Icons' historical green XRP Ledger
website mark. The SVG bytes are unchanged and bundled locally; the homepage does
not call the provider. Its CC0 license is retained in
`LICENSE-cryptocurrency-icons.txt`.

- Source: https://raw.githubusercontent.com/spothq/cryptocurrency-icons/1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/xrp.svg
- Source commit: `1a63530be6e374711a8554f31b17e4cb92c25fa5`
- File SHA-256: `31fe41b6b3a4d98c9b46d7c37d60dea97fa5d9ebbd235ac5bfe23e4fd1eb8361`
- Size: 399 bytes; native 32 by 32 viewBox.

Gold and oil retain the existing `GoldIcon` and `OilIcon` from
`frontend/src/pages/home/HomeHeroAssets.tsx` at main
`8cbb74becc694ef29b90691d3f472390f2a1a413`. Their original components were rendered
to static SVG with `size={24}`; only the required SVG XML namespace was added.
Paths, viewBoxes, gradients, colors and strokes are unchanged. The local SVG
files have no external dependencies; their `url(#...)` fills refer only to
their own local gradients. No new graphic was generated or downloaded.

On 2026-10-07, read-only responses from VOLTEX's existing
`/api/v1/market/external/tickers` and `/api/v1/market/assets/icons` confirmed the
five USDT pairs and canonical crypto identities in `heroInstruments.ts`.
The existing `/api/v1/cfd/tickers` also confirmed `configured: true`, Gold Spot
`XAUUSD` and Crude Oil WTI Spot `WTIUSD` (`status: live`, `stale: false`). Both
CFD quotes remain **display-only** (`executionAllowed: false`). Their manifest
IDs and routes follow the existing `HomeMarkets.tsx` CFD convention; `enabled`
means visible in the column and does not authorize trading. The manifest
contains no prices, performance numbers or additional provider configuration.
