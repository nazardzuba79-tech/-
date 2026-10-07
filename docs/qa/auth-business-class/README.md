# Login / Register — selected banner and real form

Current narrow follow-up: `codex/auth-card-fee-copy`, from fresh main
`2f195cbe2f0f1c7ee31e2c9e887f7449a18cf34b` after #472 was published.
This revision changes only the lower information block's localized fee wording
and readability. The owner explicitly prohibits merge, deployment and production
changes for this follow-up. The earlier publication approval does not apply here.

Russian Login and Register now use only the left 919 x 941 crop of the approved
`voltex-premium-gold-button-v6.png`. This supersedes the earlier real-photo/RU
text composition. The lossless crop preserves every decoded pixel. Its embedded
logo and slogan appear once: no HTML headline or white card.
The owner-requested benefits and static card caption are ordinary localized
HTML: six overlapping local inline SVG fiat flags (EUR/EU, CHF/CH, JPY/JP,
USD/US, CNY/CN, RUB/RU), a localized “and more currencies” hint, the existing
card title/subtitle, then `01`, the existing card label and a thin line. Each
circle has a thin white rim and a soft individual shadow. The block remains
unframed, with no shared panel, border, blur, raised shadow, numeric badge,
carousel or testimonial claim.
No verified evidence for the previous 1.2 million investor figure was found;
old copy and comments are not evidence. The owner replaced the neutral community
copy with “Платите и снимайте наличные — 0% комиссии VOLTEX” and
“22+ фиатных валют · 70+ криптовалют”. All seven locales retain the exact 22+/70+ product
figures, supplied by the owner rather than independently verified coverage.
See `frontend/public/auth/README.md` for image hashes.

The geometry follow-up removes the former contain/55:45 letterboxing. Desktop
column width follows `viewport height * 919 / 941`, capped at 60% to keep the
form readable. The photo fills the full-height panel uniformly; only a small
side-background crop is allowed near the cap. Important source-image regions
are projected into the panel and checked for visibility, not just img bounds.
The form keeps its accepted styles; at short desktop heights its own panel
scrolls to all controls and legal links instead of leaving empty space below
the photo. No extra page height is introduced to fit the artwork.

At <=760px or aspect ratio <=3/2 the Russian banner is omitted without reserved
space, and the existing Logo is shown in the form header. This also handles
narrow/portrait windows and zoom reflow without a tiny unreadable poster.
Other languages retain their existing localized photo/copy and mobile layout.
On desktop both restored blocks occupy the lower-left photo background, clear
of protected subject/card/phone regions. A local bottom radial light gradient
fades to transparent at its top edge; no rectangular fill or full-photo filter.
On compact/mobile screens both blocks follow the existing form/support/security
and precede legal links, without inserting anything above the inputs.

The white form, centered logo/heading, segmented tabs and gold button are CSS
on existing controls, NOT a screenshot. `AuthPage`, `RegisterPage`,
`RegisterPanel`, `AuthFields` and `returnTo` are byte-identical to current main.
New presentation CSS is scoped to `.vx-auth` only.

## Evidence

| Route | Desktop | Mobile |
| --- | --- | --- |
| Login | [1440px](login-1440.png) | [390px](login-390.png) |
| Register | [1440px](register-1440.png) | [390px](register-390.png) |

`node scripts/qa-auth-business-class.cjs` exercises the actual production bundle
at 1920x1080 / 1440x900 / 1366x768 and mobile widths 430 / 390 / 360 / 320 for
both Russian routes, and both routes at 1440 / 320 for six other languages.
The same-page resize cases additionally check window-height changes and
150%/200% zoom-equivalent CSS layout viewports/DPR (not pinch zoom or a claim
of a browser-toolbar zoom interaction). Geometry uses intrinsic raster size,
computed object-fit/object-position, painted bounds, panel coverage and protected
source regions. Checks also cover scroll access and validation errors.
Benefits checks require exactly one visible pair, six distinct local inline
currency flag SVGs in the approved order, uniform circles in one overlapping
row, thin white rims, soft individual shadows and decorative accessibility
semantics. The localized hint explicitly identifies the flags as a partial
selection. Existing card copy, exact 22+/70+ product figures, transparent
unframed wrappers, and no protected-region or form/support/legal overlap are
also checked. The prior behavior and geometry checks remain.
Local result: 38 main cases + 12 resize/zoom-reflow cases + four high-DPI detail
captures PASS, CLS 0 on initial
loads; no horizontal overflow, clipped content, failed images, unexpected
console/runtime errors, external traffic or forwarded writes. Password reveal,
tab navigation and the safe return query are checked on the real DOM.

Three additional behavior cases PASS using four explicitly intercepted local
POST fixtures: login error, 2FA challenge/error/back, register validation/error. No
request reaches a backend; no account/session/financial operation is made. The
report separates fixture requests from any forbidden writes.

The auth-visual workflow repeats this on the exact PR head in Linux Chromium and
uploads a SHA-named report/screenshots artifact. The independent full frontend
regression workflow remains enabled and unmodified. Existing callback tests
still cover login, 2FA, session, safe redirect, registration, referral and error
handling; source fingerprints prove the functional form files are unchanged.
The lower block uses a 5px text-row gap and a 20px gap before the unchanged
static card caption. Wide desktops use 36px circles with 14px overlap, a 14px
flag/copy gap and 17/14px title/subtitle type. The hint sits below the flags;
the title/subtitle is vertically centered beside this group. Compact desktops
(width <=1399px or height <=820px, while the banner slot is available) use
34px circles, 16px overlap, a 12px gap and 16/13px title/subtitle type. At
width <=760px, 34px flags with 12px overlap and the hint share a horizontal
row, with the 16/13px title/subtitle below. The longer non-Russian copy has
up to 540px of available lower-caption width without changing photo or form
geometry. Only the lower block is restyled.
High-DPI browser crops: [Login](login-block-2x.png) / [Register](register-block-2x.png).
Mobile high-DPI crops: [Login](login-mobile-block-2x.png) / [Register](register-mobile-block-2x.png).
The title is one CSS pixel larger than the published version, weight 600;
the subtitle uses a slightly deeper dark green. All text ancestors have computed
opacity 1. Commission wording remains an atomic phrase (not a badge), attributed
explicitly to VOLTEX in all seven locales; it makes no claim about third-party
bank/ATM charges. Existing tariffs and card conditions are unchanged.
Only necessary internal text spacing changes: 40px right inset on the Russian
photo text, compact title line-height 1.15 and natural, non-balanced wrapping.
These keep the longer heading between both protected cards at 1366x768.
Photo overlap checks now measure every actual text-node rectangle and flag,
rather than empty flex-box area. All protected source regions remain enforced.
At <=760px viewport height the lower block alone uses its existing post-form
slot to avoid covering the cards under zoom; the photo and form keep their
geometry. This also accommodates wider platform font metrics without
overlapping the black card at a 700px window height.
Preservation locks also cover the shell markup outside the currency presentation, all CSS outside these captions,
and the unchanged soft bottom gradient. No global number replacement is used.
Local TypeScript/build and focused preservation/localization/auth tests passed. Fresh remote exact-head
CI is still required for this follow-up; earlier PR/head results are not
evidence for this revision.
No checks are waived or disabled.

The fiat-logo reference is TradingView's [USD/RUB](https://www.tradingview.com/symbols/USDRUB/)
and [USD/CNY](https://www.tradingview.com/symbols/USDCNY/) country-flag treatment.
Implementation reuses the existing MIT-licensed `country-flag-icons/react/3x2`
package, not TradingView CDN assets. The current six-flag follow-up adds the
EUR, CHF and JPY examples and keeps centered, proportionate circular clipping.
No new dependency, remote logo request, new generation or investor count.
Photo assets, form geometry and the existing bottom scrim are unchanged.

## Publication boundary

PR #472 was published under its earlier authorization. This follow-up is
review-only: **NO MERGE, NO DEPLOY**, no production writes. Russian
artwork provenance and the retained non-Russian photograph's licensing notes
are recorded in `frontend/public/auth/README.md`. No backend, Worker, database
or infrastructure deployment is part of this change.

Registration now keeps the existing enabled button's gold gradient, border,
text and shadow even when validation disables submission. The disabled
attribute and all auth behavior remain unchanged. Browser checks compare the
empty, invalid and valid registration palettes, and still require disabled
empty/invalid submission and enabled valid submission. Updated Register
screenshots show the actual built page, not a mockup.
