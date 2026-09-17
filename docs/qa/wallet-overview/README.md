# Wallet Overview / Funding — browser QA evidence

Captured locally on 2026-09-17 with `scripts/qa-wallet-overview.cjs` against
`scripts/serve-wallet-review.cjs` (the real production bundle, the real native
account model and the real performance engine on an in-memory fixture — no
production data, no external service).

- `overview-owner-1440.png` — the owner's Cross account: Super VIP mark, the
  two accounts (Funding marked as already counted), the distribution ring, the
  equity curve with profit by period, an empty deposits/withdrawals list.
- `overview-ordinary-1440.png` — an ordinary account, the same design with its
  own small real figures and no tier badge.
- `overview-owner-390.png` — the same Overview on a phone.
- `funding-owner-1440.png` — the Funding section: the real spot ledger.
- `overview-no-history-1440.png` — an account with no stored history: every
  period row and the 7D pill are dashes, the chart card stays.
- `unified-owner-1440.png` / `unified-ordinary-1440.png` — the Unified
  Trading section on the approved layout: title row with the margin chip and
  IM/MM, five actions (Convert and Borrow disabled), the three-figure summary
  card, the search + "hide small" toolbar, the six-column table and the
  valuation footnote.

Figures in these captures are the review stand's deterministic fixture
(USDT 5 000 000, BTC 271 + 2.5, ETH 561, XRP 1 200 000 at fixed marks), not
any real account. Result of the run (re-taken for the approved-layout pass): 103/103 checks;
`scripts/qa-wallet-unified-account.cjs` 198/198 on the same build.
