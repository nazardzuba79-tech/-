# VOLTEX isolated visual review

One review branch and one service are authoritative:

- branch: `claude/review-ready`
- service: `voltex-review`
- URL: `https://voltex-review.onrender.com`

## Promotion workflow

1. Complete a focused feature branch based on current `origin/main`.
2. Run its type checks, focused tests, production build and browser QA.
3. Push that feature branch, then semantically integrate only its reviewed commits into `claude/review-ready`. Never merge unrelated historical branches wholesale.
4. Push `claude/review-ready`. Render auto-deploys this service for owner review.
5. Record the source commits and checks in `docs/AI_HANDOFF.md`.
6. Nothing moves to `main` until the owner explicitly approves selected commits. Production deployment is a separate action.

## Safety boundary

The Render review build is selected only when `RENDER_GIT_BRANCH=claude/review-ready`, or locally with `npm run build:review`. Normal `npm run build` remains the production build.

Review has its own HTML/React entry and never imports the production route guards as an authentication substitute. It deliberately has no production token or account session. The yellow notice is always visible. The central API client rejects account reads, authentication and all state-changing methods before a network request. The preview server also rejects every `/api/*` request and every non-GET/HEAD method, publishes a restrictive CSP (`form-action 'none'`), disables caching and indexing, and does not proxy another service.

Copy Trading is the sole data exception: the review build emits `/review-synthetic.json`, generated at build time by the repository's unchanged deterministic synthetic engine. It is explicitly labelled synthetic and contains no account, credential, database or production API data. Wallet/account values remain unavailable. Public Kraken market feeds may render when reachable; this does not grant account or trading access.

Never set `VITE_API_URL` to a production API on this service. Do not paste production credentials into review. A future write-capable staging environment requires its own backend, database, credentials and origin policy; that is intentionally outside this visual-review service.

## Local verification

From `frontend/`:

```text
npm run build:review
npm run preview -- --host 127.0.0.1 --port 4175
```

Direct routes include `/login`, `/register`, `/copy-trading`, `/wallet`, `/markets`, `/futures` and `/trade`. A direct browser navigation must return the review shell, and submitting login/register must show the review-only error without a request to a production origin.
