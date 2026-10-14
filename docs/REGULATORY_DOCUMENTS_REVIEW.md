# Regulatory document publication review

Prepared 2026-10-14 from freshly fetched main `72f0a5944b01b4d2596957ba6939b397beb8660c`.

## Current release state

The owner approved publication of the supplied image and its description on
`/legal/licenses`. The public page displays the original collage as provided,
labels the material as unverified, and makes no active-licence assertion. This
permission is separate from verification. The verified-document catalogue
remains empty and its publication gate remains in force.

The owner subsequently requested no register hyperlinks in the customer UI.
No such links are rendered. Internal verification references remain necessary
to establish the legal entity, operator relationship, document number, current
status, permitted activities/restrictions and right to reproduce the original.

## Evidence reviewed

- VARA: https://www.vara.ae/en/licenses-and-register/public-register/
  The retrieved official page listed 59 licensed VASPs; neither VOLTEX FZE nor
  VARA-2024-001234 appeared in that retrieved list. This does not establish the
  authenticity of the supplied document or its absence from every possible
  record; the claimed licence remains unverified.
- MAS: https://eservices.mas.gov.sg/fid was accessible. No matching company
  record was obtained. A directory home page is not verification.
- FCA: https://register.fca.org.uk/s/ returned its loading/CSS-error shell to
  the research tool. No entity record for 970321 was obtained.
- SFC: the official virtual-asset platform list was accessible, but no exact
  matching licence record was established. Type 1/7 and a virtual-asset
  platform authorisation must not be treated as interchangeable.
- CySEC, FINMA and Portugal: focused official-domain searches did not establish
  matching entity/number records. Attempted direct directory pages were
  inaccessible or obsolete. Search absence is not proof that a licence does
  not exist. These checks remain incomplete.
- Operator relationships, current restrictions, original document provenance
  and reproduction rights have not been independently established.

## Implementation and review entry

`frontend/src/lib/regulatoryDocuments.ts` defines the shared typed model and
publication filter. Permission alone cannot pass the filter. Dates, status,
six explicit evidence checks and a local original-document asset are required.
The reviewer supplies a next-review date rather than the application inventing
a legal expiry. Public records are re-evaluated on focus and every minute so
an open page does not indefinitely retain an expired entry.

The seven transcriptions are in `frontend/review/licences/reviewDocuments.ts`,
with `publicationApproved: true`, `regulatoryStatus: 'unverified'` and no
fabricated evidence. Original legal designations retain their original language.
The separate Vite dev entry is `/review/licences/index.html`. It displays the
review status explicitly, opens the entire supplied collage and supports zoom.
The original is locally present as ignored `frontend/review/licences/portfolio.png`.
The same unmodified image is committed at
`frontend/public/regulatory-documents/voltex-portfolio.png` for the public
presentation block. Both copies have SHA-256
`275f0610d81e672728b9bcb1189c4dc93855e4497738094ff23ee412f81804cb`.
The image does not pass through the verified-document catalogue.

Production uses the existing `/legal/:doc` route, language provider and seven
locale dictionaries. Shared Footer and HomeFooter expose `/legal/licenses`;
the About page already uses HomeFooter. Existing legal text is unchanged.
Search indexing and licensing structured data remain deferred.

CI runs publication-gate tests, existing locale/navigation regressions, a
production build and isolated Chromium checks at 320, 360, 390, 430, 768, 1366,
1440 and 1920 px in all seven languages. The public-page QA verifies that the
supplied image renders and retains its original bytes. The isolated review
image-viewer test uses a neutral one-pixel fixture; neither check verifies a
licence document.

## Publication still requires

Exact official entity/number/current-status evidence and operator linkage for
each candidate, permitted activities and restrictions, authorised originals,
and documented reproduction rights. After those checks, add approved original
assets and catalogue entries together, then complete the verified catalogue and
SEO review. Public availability of the supplied collage is not regulatory
verification.
