# Admin console on phones, tablets and desktop — audit 2026-10-16

Base: `main` `a2eca7a2` (includes #527 «Пользователи» sorting and the new
«Пополнения»). Synthetic fixture of `scripts/qa-admin-practicality.cjs`
(localhost only, every other host refused, no production access). Probe:
`scripts/qa-admin-mobile-audit.cjs` — 10 admin sections and 10 opened states
(credit drawer, manual TXID check, withdrawal and KYC decision dialogs, user
actions, OTC request, new listing, «Поддержка» panel, phone menu, KYC tab) at
320, 360, 390, 430, 768, 1440, 1920 px and 844×390 (phone held sideways).
It measures sideways page scroll, controls off screen, controls covered at five
points after scrolling them into view, cut-off text and inner scrollers.

| Run | Screens | Problem screens | Page errors | External requests |
|---|---|---|---|---|
| before (`main`) | 167 | 35 | 0 | 0 |
| after (this branch) | 167 | 0 | 0 | 0 |

## Defects confirmed on `main` and fixed

| # | Where | Reproduced | Cause | Fix |
|---|---|---|---|---|
| 1 | Users → card → «Балансы», 320–430 px | page 992 px wide; «В резерве» off screen (`before/users-qa-user-1-tab-balances-390.png`) | the 3-column balance table inherited the 950 px floor of wide admin tables, and the phone grid track was `1fr` (min-content) | `admin-balance-table` opts out of the floor; track `minmax(0,1fr)`; 6 px cell padding at ≤ 360 px so all eight decimals fit at 320 |
| 2 | «Пополнения» → «Проверить и зачислить» drawer, every width | the floating support launcher sits on «Подтвердить зачисление» (`before/deposits-credit-drawer-390.png`) | launcher z-index 998, drawer 51, overlay 50 | drawer overlay 1000, panel 1001 (above the launcher and its panel) — admin only |
| 3 | last button of a page: «Проверить и зачислить …» (320/360), KYC «Отклонить» (320–844), «Изменить» on wallets (844×390) | the launcher covers 1–2 of 5 points and the page cannot scroll further | 12–24 px of bottom padding | 88 px at the bottom of the admin page (inline style, ≤ 900 px rule over `index.css`, phone rule) |
| 4 | phone menu; user card opened with `?tab=kyc` | Escape did not close the menu; «Проверка личности» selected but outside the visible tab strip | no key handling; no scroll of the strip | Escape closes and returns focus to the menu button; the strip (only the strip) scrolls the selected tab into view |

Regression: `frontend/src/lib/__tests__/adminMobileLayout.test.ts` (5 of its 6
checks fail on `main`, all pass here) and the browser probe, now a step of
`.github/workflows/admin-practicality.yml` (exit 1 on any problem screen).

## Old mobile-admin pull requests compared with `main`

| PR | State | Verdict |
|---|---|---|
| #483 compact Users cards/filters | open, based on `a5879e88` | **Superseded.** `main` already shows working user cards on phones (asserted by `qa-admin-practicality.cjs`) and #527 added header sorting with a phone select; #483's CSS targets the old markup. |
| #489 phone layout from the owner's audit | open, conflicts with `main` | A01 balances → fixed here (#1). A02 launcher → fixed here differently (#2, #3: the launcher stays, modals and page ends clear it, no new sidebar entry). C01 drawer/dialogs → not needed now: drawer footer and dialog buttons reachable at 320–1920 and 844×390 on `main`. «Пополнения» phone order → done by #527. Tab into view, menu Escape/focus → fixed here (#4). Filter disclosures, listing section jumps, single OTC heading, 44 px targets → density/cosmetic, no defect reproduced; not changed. «Копировали адрес» phone cards → not verifiable with the fixture (no items). Menu scroll lock / `inert` → not done (no functional defect reproduced). |
| #500 integration of #489 + #483 | open, conflicts with `main` | **Superseded** by #527 and this branch; resurrecting it would overwrite #527's Users and «Пополнения». |

## Observed, not changed

- The site-wide support widget held sideways (844×390): the conversation area
  of the open panel is about 30 px tall; quick-question buttons need scrolling.
  Same on public pages; the widget belongs to the support work and has its own
  QA (`scripts/qa-support-form.cjs`).
- Filters on «Выводы», «KYC», «Журнал действий» take ~250 px on phones; usable,
  so left as is.
