# Regulatory document publication review

Prepared 2026-10-14 from freshly fetched main `72f0a5944b01b4d2596957ba6939b397beb8660c`.

## Current release state

The owner approved publication of the supplied image. This permission is
recorded separately from verification. No record is marked verified on that
basis. The production catalogue is empty; the page says no documents have
been published. Do not promote this draft as a completed licensing gallery.

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
It is not copied to `public/`, committed, or included in production build inputs.

Production uses the existing `/legal/:doc` route, language provider and seven
locale dictionaries. Shared Footer and HomeFooter expose `/legal/licenses`;
the About page already uses HomeFooter. Existing legal text is unchanged.
Search indexing and licensing structured data remain deferred.

CI runs publication-gate tests, existing locale/navigation regressions, a
production build and isolated Chromium checks at 320, 360, 390, 430, 768, 1366,
1440 and 1920 px in all seven languages. The image-viewer CI test uses a
neutral one-pixel fixture; it does not claim to verify any licence document.

## Publication still requires

Exact official entity/number/current-status evidence and operator linkage for
each candidate, permitted activities and restrictions, authorised originals,
and documented reproduction rights. After those checks, add approved original
assets and catalogue entries together, then complete publication and SEO review.
No production deployment or main merge has been performed by this task.
