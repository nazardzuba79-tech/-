# Futures: chart menus, «Доступно», TP/SL beside «Только уменьшение» (2026-09-29)

Owner request: take exactly three marked pieces of the approved terminal
mockup into the real `/futures` terminal. Base: `main` `a7925e90`.
LOCAL QA ONLY — every screenshot is the real built UI served by
`scripts/serve-native-demo-review.cjs` with `NATIVE_PREVIEW_FIXTURE=1`
(synthetic capital, invented candles, no market data). No production data
was read or written.

| Marked in the mockup | In the terminal |
|---|---|
| Chart type + «Индикаторы» | The flat row «Свечи Линия Область MA200 Bollinger RSI MACD» is two menus on Futures: a type button showing the current type, and «Индикаторы» with a count of active indicators. Same 3 types, same 4 indicators (with their real parameters: SMA, 20 · 2, 14, 12 · 26 · 9), same setters. Keyboard: ↓/↑ open, arrows move, Enter/Space pick, Esc closes and returns focus. Spot and CFD keep the flat buttons. |
| «Доступно … USDT (+)» | Above the price, compact ticket only. It prints `availableMargin`, the figure the % slider and the margin check size with; on the fixture it equals the account panel's «Доступная маржа» to the cent. «+» goes where the account panel's «Перевести» goes (transfer dialog on the real engine, `/wallet?action=transfer` on the simulation one). |
| «TP / SL» beside «Только уменьшение» | The shield toggle became a checkbox in one row with Reduce Only. Ticked: TP and SL fields, each with its % from the order price and ≈ P&L. Unticked: fields hidden and disabled, values kept, nothing armed. Under Reduce Only the box is disabled and the fields are gone; unticking Reduce Only restores them. Shown only where the engine arms protection with the order (`entryProtection`); the real engine is unchanged. |

Checks run on the final build (see the handoff entry for the jest runs):

* Interaction script, 1440 and 390: menus pick/toggle/close (click, Esc,
  outside press), keyboard open lands on the checked type, focus returns to
  the trigger, legend follows the indicators, «Доступно» = panel figure,
  TP/SL hints (`+11.15% · ≈ +66.21 USDT`, `−9.06% · ≈ −53.79 USDT` for
  0.012 BTC), collapse/retain, Reduce Only exclusion, 24 px rows on desktop
  and 44 px on phone, no horizontal overflow, «+» → `/wallet?action=transfer`.
* `scripts/qa-order-panel-refinement.cjs` (updated for the checkbox) PASS at
  1920/1440/390/320; `qa-native-demo-browser.cjs` and `qa-limit-close.cjs`
  PASS unchanged.

Screenshots: `before-1440.png`, `before-1440-form.png`, `after-1440.png`,
`after-1440-toolbar.png`, `after-1440-menu-type.png`,
`after-1440-menu-indicators.png`, `after-1440-form-tpsl.png`,
`after-390-toolbar.png`, `after-390-tpsl.png`.
