# Login / Register — selected banner and real form

Follow-up branch `codex/auth-fiat-flags-copy` from main
`8cbb74becc694ef29b90691d3f472390f2a1a413`, after #466 was merged externally.
The owner authorized a new narrow PR, not merge or production deployment.

Russian Login and Register now use only the left 919 x 941 crop of the approved
`voltex-premium-gold-button-v6.png`. This supersedes the earlier real-photo/RU
text composition. The lossless crop preserves every decoded pixel. Its embedded
logo and slogan appear once: no HTML headline or white card.
The owner-requested benefits and static card caption are ordinary localized
HTML: three local inline SVG fiat flags (RUB/RU, USD/US, CNY/CN), localized card title/subtitle,
then `01`, the existing card label and a thin line. No shared panel, border,
blur, raised shadow, numeric badge, carousel or testimonial claim is added.
No verified evidence for the previous 1.2 million investor figure was found;
old copy and comments are not evidence. The owner replaced the neutral community
copy with the two lines “Платите и снимайте наличные” and
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
Benefits checks require exactly one visible pair, three distinct local inline
currency flag SVGs (not portraits or external images), decorative accessibility semantics, localized card copy without the
unsupported investor counter, exact 22+/70+ product figures, transparent unframed wrappers, and no protected-region or
form/support/legal overlap. The prior behavior and geometry checks remain.
Local result: 38 main cases + 12 resize/zoom-reflow cases PASS, CLS 0 on initial
loads; no horizontal overflow, clipped content, failed images, unexpected
console/runtime errors, external traffic or forwarded writes. Password reveal,
tab navigation and the safe return query are checked on the real DOM.

Three additional behavior cases use four explicitly intercepted local POST
fixtures: login error, 2FA challenge/error/back, register validation/error. No
request reaches a backend; no account/session/financial operation is made. The
report separates fixture requests from any forbidden writes.

The auth-visual workflow repeats this on the exact PR head in Linux Chromium and
uploads a SHA-named report/screenshots artifact. The independent full frontend
regression workflow remains enabled and unmodified. Existing callback tests
still cover login, 2FA, session, safe redirect, registration, referral and error
handling; source fingerprints prove the functional form files are unchanged.
The lower block uses a 6px text-row gap, 12–14px icon/text gap with vertical
centering, and a 22px gap before the unchanged static card caption. Desktop
checks require each phrase on one line at normal requested widths. Fonts remain
16/14px on desktop and 15/13px on mobile; only the lower block is restyled.
High-DPI browser crops: [Login](login-block-2x.png) / [Register](register-block-2x.png).
At <=760px viewport height the lower block alone uses its existing post-form
slot to avoid covering the cards under zoom; the photo and form keep their
geometry. This also accommodates wider platform font metrics without shrinking
the text or overlapping the black card at a 700px window height.
Preservation locks also cover the shell markup outside the fiat-icon row, all CSS outside these captions,
and the unchanged soft bottom gradient. No global number replacement is used.
Local TypeScript/build and 176 targeted tests passed. Fresh remote exact-head
results are recorded on the follow-up PR; #466 CI is not evidence for this revision.
No checks are waived or disabled.

The fiat-logo reference is TradingView's [USD/RUB](https://www.tradingview.com/symbols/USDRUB/)
and [USD/CNY](https://www.tradingview.com/symbols/USDCNY/) country-flag treatment.
Implementation reuses the existing MIT-licensed `country-flag-icons/react/3x2`
package, not TradingView CDN assets. Each flag fills its original 36/28px circular
footprint with centered, proportionate clipping. No new dependency, remote logo
request, new generation or investor count. Only the lower Russian block gains
available width for the longer fiat caption; the photo and form geometry are unchanged.

## Publication boundary

This is review, not production. Russian artwork provenance and the retained
non-Russian photograph's licensing notes are recorded in
`frontend/public/auth/README.md`. Owner approval is required before publication.
