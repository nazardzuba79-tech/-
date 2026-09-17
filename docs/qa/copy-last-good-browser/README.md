# Copy Trading last-good snapshot — browser evidence

Produced by `node scripts/qa-copy-last-good-browser.cjs` on PR #107: the
production frontend bundle in Chromium against the ACTUAL compiled marketplace
router, `CopyPerformanceService` and `requireAuth`, with an in-memory database
only. No production secret, database or financial write; every Nazar/Ksenia
figure comes from the canonical service.

- `report.json` — per phase: first authenticated visit (live cards), the
  persisted snapshot (one key per session digest, no token, no request
  state), the HARD RELOAD with the marketplace request held open (both cards
  painted from the snapshot at the first DOM commit, `timeline`), Ksenia's
  profile opened before the API answered, navigate away and back, a 503 and a
  malformed refresh (values kept, section flagged stale), another token and a
  post-logout session (nothing of the first session shown; the first
  session's key removed on logout).
- `reload-before-api-1440.png` — the marketplace on reload while the live
  request is still pending ("Загрузка данных…"): the featured cards already
  carry their last-good figures.
- `profile-before-api-1440.png` — Ksenia's profile opened before the API
  answered, on the same validated state.
