# Homepage last-good snapshot — browser evidence

Produced by `node scripts/qa-home-snapshot-reload.cjs` (Chromium against a
loopback fixture API; nothing external) on PR #107, commit `a3e78f8`.

- `report.json` — first visit (8 market-data requests, snapshot persisted),
  reload with every market request aborted (all surfaces painted 230 ms after
  DOMContentLoaded, 0 placeholders, badge "6h snapshot", 0 market-data
  requests, 1 icon-metadata request), cold visit with the snapshot removed
  (8 requests again, so the zero is real).
- `reload-1600.png` — the reload as painted from the cache, before any API
  answer. Sections below the tape reveal on scroll, so they are dark in an
  unscrolled full-page capture; the same is true of the first-load baseline
  in `../home-laptop-first-load/`.
