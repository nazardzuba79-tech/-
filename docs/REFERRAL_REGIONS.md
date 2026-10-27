# Global and RU referral links

The Profile referral section exposes `Для всего мира` and `Для России`.
Both URLs contain the exact personal code returned by the existing account API:
`https://voltextech.net/CODE` and `https://ru.voltextech.net/CODE`.
The builder accepts only these two destinations and bounded alphanumeric codes.
Invalid or missing API data disables copying rather than inventing a code.

`exchange_referral_region` stores a non-sensitive display preference. Profile and
Banking use the same builder/preference; storage refusal leaves in-memory switching
usable. Each web origin has its own browser storage, as normal. ReferralRedirectPage
navigates to `/` and RegisterPanel navigates relatively: no new redirect to the
global domain is introduced. Existing auth, referredById, statistics and both
products' separate reward calculations are preserved. No backend product source,
schema, migration or financial rules changed.

## Verification

- Local: 131 link/auth/clipboard/localization tests; backend and frontend build.
- The historical translation digest still pins all old bytes: only the four new
  exact keys are excluded by name and separately checked in all seven languages.
- `scripts/qa-referral-regions.cjs` is guarded to the disposable loopback database
  `voltex_referral_regions`. It exercises the unchanged actual auth/referral routes
  and PostgreSQL through the built frontend. Chromium intercepts both HTTPS public
  hostnames and forwards only to its local server. It checks anonymous link visits,
  the real home signup CTA, ref payloads, shared referredById and count=2, region
  persistence/copying, Banking consistency, 1440/390 screenshots and zero financial
  row changes. No actual public registration or message is sent. Banking rendering
  uses read fixtures; reward/calculation logic is not reimplemented or changed.
- Exact-head CI evidence is tracked on the PR, including browser report and images.

## RU infrastructure blocker

Read-only check from this workstation on 2026-10-27T11:20:40Z: DNS resolves
`ru.voltextech.net`, but HTTPS GET of a synthetic deep link fails with
`UND_ERR_CONNECT_TIMEOUT`. The web fetch tool also could not access the site.
This does not establish failure for every network, and is not a Russian-ISP test.
Actual live RU deep-link behavior/TLS/backend forwarding remains unverified.
Existing gateway work belongs to PR #622; this change neither duplicates it nor
modifies Beget, DNS, TLS or production. The UI contains no “without VPN” promise.
An isolated browser pass proves app behavior only, not live RU availability.

Production release remains pending the owner's permission and confirmation of the
actual RU endpoint, direct-link SPA fallback and shared backend forwarding. Russian
network evidence is additionally required before any “without VPN” claim.
