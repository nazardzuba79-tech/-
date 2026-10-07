# Login / Register — business-class visual review

Base: fresh main `deb4b10746caf63107da05dfdb0806de8f713096`.
Branch: `codex/auth-business-class-visual`. No merge or production deployment.

The owner selected genuine business-class photograph option 1. The left visual
is rebuilt around that image: 50/50 desktop composition, restrained Russian
headline, local light gradient behind the text, no card/avatars/investor-count
overlay. Mobile gets a separately cropped photograph and 250–272px hero, not the
former large dark panel. The actual right forms and their theme are preserved.

## Evidence

| Route | Desktop | Mobile |
| --- | --- | --- |
| Login | [1440px](login-1440.png) | [390px](login-390.png) |
| Register | [1440px](register-1440.png) | [390px](register-390.png) |

`node scripts/qa-auth-business-class.cjs` exercises the actual production bundle
at 1920 / 1440 / 1366 / 430 / 390 / 360 / 320 for both routes. All 14 local cases
passed: no horizontal overflow, clipped text, broken image, console/page error,
failed request, external request or write. Measured CLS was 0. The email input is
on the first mobile screen. Password visibility toggles and both tabs retain
their behavior and return destination. No account is created or logged in.

The auth-visual workflow repeats this on the exact PR head in Linux Chromium and
uploads a SHA-named report/screenshots artifact. The independent full frontend
regression workflow remains enabled and unmodified. Existing callback tests
still cover login, 2FA, session, safe redirect, registration, referral and error
handling; the added source fingerprints prove those files and the right-form
theme are unchanged from the reviewed main. No checks are waived.

## Publication boundary

This is a review preview, not production. Asset provenance and the distinction
between Unsplash's copyright license and recognizable-person/brand permissions
are recorded in `frontend/public/auth/README.md`; release clearance has not been
independently established. Owner review/approval is required before publication.
