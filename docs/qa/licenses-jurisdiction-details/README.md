# Documents and licensing — jurisdiction descriptions

Base: fresh main `c2ee9e7143a45f80f300fb997da6a5f40a97fee6`.
Route: `/legal/licenses`. Review branch: `codex/licenses-jurisdiction-details-20261016`.
PR only; no merge or production deployment is authorized by this change.

The page now provides a localized introduction, seven jurisdiction names, an
explanation of the presented materials, the unchanged image with an open-image
link, and compact jurisdiction/organization/document descriptions. The owner
stated that the information was confirmed, so the badge explicitly identifies
its source: “Confirmed by the owner of VOLTEX”. It does not assert independent
verification by a regulator or worldwide operating permission.

`licenses.pageTitle` is separate from the existing `licenses.title` used in
navigation, preserving the menu/footer label. All new text uses the existing
seven dictionaries (ru/en/es/zh/hi/ja/ko). No new dependency or API is introduced.

## Verification

- TypeScript (`tsc -b`) and production Vite build: PASS; existing large-chunk
  advisory retained.
- Regulatory publication, localization chunks, About and Academy/Help:
  4 suites / 106 tests PASS. No publication gate tests or evidence requirements
  were changed.
- Real Chromium: 419 checks PASS, 8 widths × 7 languages, including public
  description layout and the existing isolated review viewer. Public screenshots
  cover 320/390/430/768/1440/1920. No horizontal overflow, clipped description
  containers, JavaScript exceptions, unexpected console errors, failed local
  responses or write requests.
- Opening the source image works in every language; keyboard review viewer,
  focus return, zoom, About/footer navigation and noindex remain functional.
- The browser waits for localized content and the original image before taking
  full-page evidence; recorded document heights contain the last description
  and footer, including at 320px.
- `regulatoryDocuments.ts` and `reviewDocuments.ts` are byte-for-byte unchanged.
  Seven informational entries do not become verified catalogue entries. The
  material counter still counts the single collage; no fictitious count of
  seven verified licences is created.
- Original image SHA-256 unchanged:
  `275f0610d81e672728b9bcb1189c4dc93855e4497738094ff23ee412f81804cb`.

Screenshots are actual local production-build browser captures, not mockups.
`public-1440.png` / `public-1920.png` show the whole desktop page;
`public-390.png` / `public-320.png` show the whole mobile page;
`descriptions-1440.png` / `descriptions-390.png` show readable detail.
`browser-report.json` retains assertions and network observations. Existing
external font requests are denied by the fixture; the page uses fallback fonts.
No live financial operation or production backend is used.

## Reproduce

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath frontend/src/lib/__tests__/regulatoryDocuments.test.ts frontend/src/lib/__tests__/i18nLanguageChunks.test.ts frontend/src/lib/__tests__/aboutPage.test.ts frontend/src/lib/__tests__/academyHelpPages.test.ts
npm run build --prefix frontend
QA_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/qa-regulatory-documents.cjs
```

The existing Regulatory documents workflow runs the same checks and retains
all seven desktop translations plus the full responsive matrix. Final GitHub
results must be read for the pushed commit; a previous PASS is not substituted.
Review commits use the repository's `[CF-Pages-Skip]` convention.
