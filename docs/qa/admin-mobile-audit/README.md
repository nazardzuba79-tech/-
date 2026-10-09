# Admin on phones — fixes for the mobile audit of 2026-10-09

Audited main: `cb5559db24c7c8ba4cae75997a1c9145a193151f` (the admin files on this branch
start from that exact tree). Review branch only: no merge, no deployment, no
production, Hetzner, Cloudflare, PostgreSQL, API, schema, balance, order, KYC
decision, market scenario, migration, seed or secret change. Every check below
ran against the built `/admin` bundle on the local synthetic fixture
(`scripts/qa-admin-practicality.cjs`, `QA_PREVIEW=1`): every request outside the
local origin is aborted, WebSockets are closed, and the automatic
`POST /admin/deposit-watch/open` on opening «Пополнения» answers from the
fixture (`{ ran: false, skipped: 'NOT_DUE' }`), never from production.

## Confirmed defects → fix → result

| Screen | Confirmed problem (audit) | Fix | Result on the fixture |
|---|---|---|---|
| Карточка пользователя → «Балансы» (A01) | `.admin-data-table { min-width: 950px }` at ≤700px made both balance tables 950px wide: document 992px at 320–430px, page scrolls sideways | The 950px floor now applies to registry tables only (`.admin-data-table:not(.admin-balance-table)`); the balance table has its own phone layout — one block per asset with the exact «Доступно» and «В резерве» values (no rounding, nothing hidden), `min-width: 0`, `minmax(0, 1fr)` in the two-card grid; no global `overflow-x: hidden` | Document width 992–993px → 320/360/390/430px; both tables 950px → 266/306/336/376px; 700/701 edge without overflow (`results.json`, `profile-balances-*.png`) |
| Drawer «Зачисление пакета» (A02) | The floating support launcher (50×50, bottom/right 24, z-index 998) sat over «Подтвердить зачисление» on phones and over the open menu at 320 | `AdminLayout` marks `body[data-admin-shell]`; `SupportWidget.css` hides the launcher there. Support stays reachable: a «Поддержка» entry in the admin sidebar opens the same panel (`openSupportWidget`), which has its own close button. The public site is unchanged | Grid hit test (27 points) on «Подтвердить зачисление»: 4–6 of 27 points blocked before, 0 blocked after, at all seven sizes; no launcher on `/admin` |
| Drawer, dialogs (C01) | Drawer `height: 100vh`; publish dialog without a height bound | Drawer: `.admin-drawer-panel` height = visible viewport (`--admin-viewport-height` from `visualViewport`, fallback `100dvh`), scroll body `min-height: 0`, footer with `safe-area-inset-bottom`, focus moves in and returns, page behind does not scroll, Escape kept. Native `AdminModal`: header/footer fixed, only `.admin-modal-body` scrolls (balance adjustment and account actions now use that body too). Listing publish dialog: `max-height`, scroll, safe-area padding, Escape, focus in/out. Ignore-transfer modal uses the same viewport bound | 320×568 and 844×390: drawer footer and modal footers inside the viewport (`credit-drawer-*.png`, `withdrawal-reject-*.png`, `kyc-confirm-*.png`) |

## Section organisation on phones (≤767px, `useAdminCompact`)

Desktop markup is unchanged: the pages render the compact arrangement only when
`matchMedia('(max-width: 767px)')` matches; nothing is rendered twice and hidden.

| Screen | Change | Result |
|---|---|---|
| «Пополнения» (B01) | Queue tabs follow a one-line watcher status (last success, provider, lag, unverified count; errors and the truncated-queue alert stay visible); schedule, cursor and the mode switch under «Подробности и расписание»; «Проверить TXID» opens on demand. Same handlers and requests | «Готовы к проверке» tab top: 966 px → 584 px at 390 (`deposits-full-*.png`) |
| KYC, «Выводы», «Журнал действий» (B02) | Search and «Найти» stay in view; dates, status, action and user id sit in a «Фильтры» disclosure with the count of active conditions, a one-line summary while closed, «Сбросить» and (KYC) «Применить даты». URL parameters, page resets and server filtering unchanged | KYC list top: 668 → 481 px; first withdrawal: 548 → 495 px; first audit entry: 592 → 367 px at 390 |
| KYC list → review | A tap on a client scrolls the review card into view; the chosen client carries a brand bar | `kyc-emailed-*.png` (document mailed by the edge), `kyc-pdf-*.png` (PDF link), `kyc-rejected-*.png` (long reason), `kyc-missing-*.png` (404 → «Запросить документ заново»), `kyc-confirm-*.png` (confirmation) |
| Карточка пользователя (B03) | The tab strip scrolls the selected tab into view (also `?tab=kyc`, `?tab=audit`) and fades the edge that has more tabs; `role=tab` semantics, URL and «Все пользователи» return unchanged; hidden histories stay unmounted | Selected tab inside the strip at 320–430: false before, true after (`profile-kyc-*.png`) |
| «Листинги» (B04) | Section jumps (Параметры / Движение / Этапы / Точная настройка / Предпросмотр) that open a folded section; «Сохранить черновик» / «Предпросмотр» / «Опубликовать» / «Закрыть» pinned to the bottom with their own space reserved and `safe-area-inset-bottom`; inputs keep `scroll-margin-bottom` above the bar; compact inner padding. Save and publish remain separate actions with the same confirmation | «Сохранить черновик» inside the viewport at every phone size (`listing-form-*.png`, `listing-form-stages-*.png`) |
| OTC (B05) | One page heading (the shared list no longer repeats «OTC-заявки» on the admin desk); the request card gets Заявка / Условия и история / Переписка jumps (admin only, scoped CSS). Reserve, version and cash-desk confirmation rules untouched | Composer reachable from the top of the request (`otc-detail-chat-*.png`) |
| «Копировали адрес» (B06) | Phone cards: user, coin, network and time on top; UID, full address (show / copy), memo, device time, reconciliation window and source under «Подробности». The delayed-delivery sign and the «copy ≠ payment» warning stay; «Обработано» uses the same request | `deposit-copies-*.png`, `deposit-copies-details-*.png` |
| Menu | Escape closes it, focus moves to its close button and returns to the menu button, the page behind does not scroll, rotation to ≥901px dismisses it, closed menu is `inert`; «Поддержка» entry | `sidebar-*.png`, `results.json` (`closedByEscape`, `focusBack`) |
| Touch targets | On coarse pointers ≤767px: confirmations, pagination, action rows and tabs ≥44px; pills ≥38px (design goal, not a universal standard) | `credit-drawer-320x568.png` |

Not rebuilt (per the audit): «Пользователи» cards and menus, «Адреса пополнения»,
native confirmations. They were re-checked on the fixture at every size: no
sideways overflow, long emails wrap, menus open inside the viewport.

## Matrix

Sizes 320×568, 360×800, 390×844, 430×932, 844×390, 1440×900, 1920×1080 (phones
with touch emulation); breakpoint edges 700/701, 720/721, 767/768, 900/901.
Per size: users, profile (overview, balances, kyc, audit), deposits (queue,
details, TXID, credit drawer and cancel, copies and card details), KYC (filters,
emailed / PDF / rejected / 404 / confirmation), withdrawals (filters, reject
dialog), listings (form, section jump, focused field), OTC (list, request,
jumps), audit log (filters, filtered state), wallets, the menu.

`results.json` — 248 screenshots after, 216 before, 0 page errors, 0 external
requests in either run. Sideways overflow after: none at any size or edge
(before: the balances card at 320–430 and at 700; under touch emulation the
baseline reports it as document width 992px at a 320–430px viewport).
Before/after pairs: `before/` and `after/` carry the same file names; the
repository keeps a curated subset, the full runs are reproducible with
`evidence.cjs` against `QA_PREVIEW=1 node scripts/qa-admin-practicality.cjs`.

Other numbers from the two runs (390×844 unless stated): «Готовы к проверке»
tab top 966 → 584px; KYC list top 668 → 481px; first withdrawal 548 → 495px;
first audit entry 592 → 367px; selected profile tab inside the strip at
320–430: false → true; menu closes on Escape: false → true; «Поддержка» entry
in the menu: 0 → 1; publish/reject dialog footer at 844×390: 436px (below the
390px viewport) → 373px; «Сохранить черновик» inside the viewport after a
section jump at 320–430: true; the focused price field stays above the pinned
bar at every size; the OTC request shows one «OTC-заявки» heading instead of
two; the composer is on screen after the «Переписка» jump at every size.
The OTC request card is ~120px taller on phones because of the jump row.

Desktop (1440×900, 1920×1080) before/after pixel diff: 0.13–0.26% on users,
profile, deposits, KYC, withdrawals, listings, audit, wallets and the copies
view — the fixture clock text and the synthetic KYC state of user 5; OTC list
and request 3.2–3.3% because the duplicate heading went and the three jumps
were added, which is the B05 change itself.

## Verification on this head

- `tsc -b` PASS; Vite build PASS.
- Jest: frontend 234 suites / 4043 tests PASS (`npx jest frontend/src`); the deposits lifecycle suite only gained the compact hook in its module allow-list.
- Fixture QA scripts from `.github/workflows/admin-practicality.yml` on this
  build: four-width screenshots (32, no overflow, no page errors), workflow
  interactions (15 PASS), API compatibility (modern + legacy, 0 unexpected
  errors), adjustment placement (26 checks PASS) — all `exit 0`.
- `walkthrough-390.mp4` — Users → profile/balances → deposits/copies → drawer
  and cancel → KYC → listings/stages → OTC → audit log, on the fixture.

Not checked: real devices, Safari/WebKit, production.
