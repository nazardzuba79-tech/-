# Login / Register — selected banner and real form

PR #466, branch `codex/auth-business-class-visual`.
Refreshed onto main `3e64ae89e4b328dfc3577e0539301c20ee07b31e`, retaining #465
and #467. No merge into main or production deployment is authorized.

Russian Login and Register now use only the left 919 x 941 crop of the approved
`voltex-premium-gold-button-v6.png`. This supersedes the earlier real-photo/RU
text composition. The lossless crop preserves every decoded pixel. Its embedded
logo and slogan appear once: no HTML headline/white card, community, avatars,
caption or numbered controls. See `frontend/public/auth/README.md` for hashes.

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
Local TypeScript/build and 167 targeted tests passed. Fresh remote exact-head
results are recorded on PR #466; older CI is not evidence for this revision.
No checks are waived or disabled.

## Publication boundary

This is review, not production. Russian artwork provenance and the retained
non-Russian photograph's licensing notes are recorded in
`frontend/public/auth/README.md`. Owner approval is required before publication.
