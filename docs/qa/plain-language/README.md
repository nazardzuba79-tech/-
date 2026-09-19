# Plain language — evidence

The exchange is shown to people who are not building it, so no screen names
the plumbing behind it. This folder holds what was measured after the sweep
that removed that wording.

- `futures-account-summary.png` — the Futures account panel at 1440. The
  bottom row read «Демо баланс» and now reads «Доступно для торговли»,
  carrying the same figure (10 000 000.00 USDT) from the same field.

Checked in a real browser rather than by reading the source:

- `scripts/qa-futures-demo-activation.cjs` — 79 of 84 checks pass, including
  both reads of that row before and after activation. The five that fail are
  not about wording: one further label this harness was written against
  («Тип маржи») is not in the summary it scans, and the other four need an
  outbound market feed, which the sandbox this ran in does not allow.
- `scripts/qa-home-snapshot-reload.cjs` — PASS, zero findings, zero page
  errors. Its `report.json` records the homepage badge as
  `Updated every 6h`, which replaced `6h snapshot` / `Stale`.
- `scripts/qa-native-demo-browser.cjs` — 29 of 29 checks pass, zero errors.

The guard that keeps this from drifting back is
`frontend/src/lib/__tests__/plainLanguage.test.ts`. It was proved to fail on
a planted violation in both halves — a dictionary value and a component
string — before being left green.
