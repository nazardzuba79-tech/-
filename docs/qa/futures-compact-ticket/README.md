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

## Follow-up, same day (owner's production screenshot)

* **TP/SL is a round «+»**, the same mark as the «+» beside «Доступно». Ticked,
  it fills gold and turns into «×»; under «Только уменьшение» it is dimmed.
  The checkbox stays underneath across the whole label, so click, Space and
  screen readers work as before. `followup-tpsl-plus-{off,on,reduce-only}.png`.
* **«Только уменьшение» first, TP/SL a moment later — root cause.** While the
  simulation account loads, `useNativeFuturesExecution` returned a not-ready
  execution spread from `REAL_FUTURES_EXECUTION`, which carries
  `entryProtection: false`; TP/SL appeared only when the whole account had
  loaded. The not-ready execution now says `entryProtection` as soon as the
  engine is known (server verdict), cached (this tab's transcript), or
  remembered for this user (`lib/nativeEngineHint`, a display-only hint keyed
  by user id). Orders still wait for `ready`. Local fixture: TP/SL moved from
  "after the account" to the access verdict (~0.9 s → with a remembered hint,
  the first frame; fixture tokens are not JWTs, so the hint itself is covered
  by unit tests rather than this browser run).
* **Field font.** The field font did not change: Inter Terminal 16 px/600 since
  `a9be41f9` (2026-09-25), identical in the owner's before/after screenshots.
  What differed from the rest of the terminal was «12,91»: a `type="number"`
  field is drawn in the page language (`<html lang="ru">`), so it printed a
  comma beside a book printing 12.91 — and a level typed as «270,5» reached
  `parseFloat` as 270. Price, size, TP and SL are now text fields.

## Owner review HOLD, same day: numbers are read, never rewritten

The first version of those text fields (`decimalText`) deleted every
character it did not expect: «1e-8» became 18, «1e3» 13, «-1» 1, «1.2.3»
1.23, «12abc34» 1234. Replaced by `lib/decimalInput`:

* The field keeps exactly what was typed or pasted.
* Digits with one dot or comma are a number; its value is the same digits
  with a dot, as a string (leading zeros dropped, trailing zeros kept), so
  `123456789.123456789` is sent digit for digit.
* A sign, an exponent, a letter, a space inside or a second separator is
  refused: the field is outlined red (`aria-invalid`), the reason is under it
  in the trader's language, and Long, Short and Enter send nothing. A refused
  level is never replaced by the one typed before it.
* Empty or half-typed («.») is not an error and not an order.
* Leaving a field rewrites only a number, as the same number («12,50» → 12.50,
  «007» → 7). Anything else stays as typed.
* Prices the terminal fills in (last price, a chart bar) are written in plain
  digits (`String(1e-7)` is «1e-7»), so they are never refused.

Browser run on the local fixture at 1440 and 390 (typed character by character,
plus one real Ctrl+V paste): `1e-8` in price, `1.2.3` in size, `12abc34` in TP,
`-1` in SL, pasted `1e3` in price. Each stayed as typed, was refused with its
reason, and no order request left the page. With `49360,7` and `0,012` the
same watcher saw the order go out as `49360.7` / `0.012`.
`review-refused-{price,stopLoss}-{1440,390}.png`, `review-valid-{1440,390}.png`.
