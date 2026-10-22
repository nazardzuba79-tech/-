# OTC: existing specialist form (frontend-only)

Source: owner archive `VOLTEX_OTC_support_for_Codex.zip`. Its manifest base
`1aa8e21ad49bf1f108691a1dc9c78442068d85e8` and original OtcPage blob
`92154449ae68c675acc6f0b03576b86571ae15c1` matched freshly fetched main.
The prepared OtcPage was used unchanged. No competing open PR was returned.

## Public flow

All three category actions and **Оформить обмен через поддержку** call the
existing `openSupportWidget`. The specialist form opens; the user writes the
country, city, cryptocurrency and amount, then explicitly submits. The page
does not prefill exchange parameters, read OTC balances, create a request or
reserve funds. Existing specialist identity prefilling and manual editing are
unchanged. The operator replies to the email supplied in the form.

The Assistant's OTC answer now describes the same manual flow. Other answers,
Academy/Help/mobile reading behavior, auth route, category thresholds, artwork
and styles are unchanged. Existing financial services, components, admin UI,
tables, policy and financial regression assertions are retained. Minimum
deposit remains 500 USD; OTC policy remains disabled with empty allowlists.

## Verification and retained coverage

- 142 focused Jest tests / 5 suites, 13 runner tests: PASS locally.
- Backend isolated TypeScript build, normal frontend TypeScript/production
  build and separate legacy fixture build: PASS. Existing >500 kB chunk warning.
- Real production-bundle browser fixtures at 320/390/768/1440: all CTA/category
  actions, specialist mode, no parameter prefill, Escape/focus return, manual
  fields, one explicit POST, double-send prevention, error retention, no false
  success, idle day/no retry, no horizontal overflow: PASS. Zero financial or
  external requests, zero page errors. Provider acceptance is simulated here,
  **not evidence of an email reaching support**.
- Former public reserve/private-chat/admin/consent/account-switch tests now
  use `LegacyOtcPage`, a test-only composition of the preserved components.
  Its isolated `dist-otc-legacy` build is never published. All four browser
  widths passed without dropping financial assertions.
- The existing OTC workflow retains every wallet/OTC/PostgreSQL preservation
  gate and fresh per-head/per-attempt artifacts. Historical cutover tests use
  exact pre-372 main `a457809f2412da6b6074a6d398aa1ca9248c6ac1`: current main
  already contains #372 and cannot stand in for an old incompatible writer.
  These remain disposable regressions, not production migration instructions.

## Publication boundary

Require current-head green CI and diff/review checks before merging this
frontend-only PR. Use `[skip render]` in the merge commit and existing
Cloudflare Pages main auto-deploy only. Render documents this service-specific
skip phrase at https://render.com/docs/deploys#skipping-an-auto-deploy.
Do not disable CI, change platform settings, trigger Render deploys, run
HOLD/maintenance, run production migrations/audits, or change OTC policy/data.
Verify the exact production Pages merge SHA and separately record unchanged
Render live SHA and `/health`; a preview is not publication.

One clearly labelled synthetic support enquiry is owner-authorized, without
any financial request. Do not send a series or claim mailbox delivery from
HTTP 200 or the UI success banner. Until a mailbox/operator confirms receipt,
report delivery as **unconfirmed**. At this commit, publication and actual
delivery remain pending; fresh remote outcomes belong in the PR/release report.
