# Deposit: explicit asset field, network choice, minimum 300 USD (2026-09-29)

Owner request: in «Пополнение» the only way to pick another asset was the small
«Bitcoin ›» under the heading, and the 300 USD minimum was not shown at all in
the catalogue (Cloudflare) mode. Follow-up the same day: USDT on TRC-20 first,
and a more obvious chevron on the asset field.

Base: `main` `9c746c61`. LOCAL QA ONLY: every screenshot is the real
dialog on `frontend/qa/deposit-preview.html` (Vite, `VITE_MANUAL_DEPOSIT_CATALOGUE=true`)
with synthetic addresses. No production catalogue, address, secret or balance
was read or changed.

## What changed

| Before | After |
|---|---|
| «Bitcoin ›» link under «Ваш адрес BTC» | **Актив** field: icon, ticker, name and a gold chevron key. It opens a popover under the field on desktop and a bottom sheet with 60 px rows on phones. Both have search, the active asset is highlighted with ✓, and they close on a second press, an outside press or Esc (focus returns to the field). |
| Network behind «Изменить сеть» (a second screen) | **Сеть**: every network of the asset is shown at once as radios. USDT shows TRON · TRC-20 and Ethereum · ERC-20 side by side. A single-network asset shows a fixed field with ✓. |
| No minimum in catalogue mode | **Минимальное пополнение: 300 USD**, placed before the address, with «Пополнения ниже минимальной суммы не зачисляются автоматически.» USDT/USDC show `= 300 USDT` (the server counts them 1:1). Another asset shows `≈ X BTC по текущему курсу` only when the page already holds that asset's price and it is at most 2 minutes old. Otherwise only the USD figure is shown. |
| Opens on BTC | Opens on **USDT · TRC-20**. USDT heads the list and TRC-20 heads its networks. An asset asked for by a Wallet row still wins. |

The 300 USD is `DEPOSIT_MINIMUM_USD` in `frontend/src/lib/depositMinimum.ts`,
pinned by `depositMinimumRule.test.ts` to the backend's `MIN_DEPOSIT_USD`,
`DEPOSIT_USD_PEGGED_ASSETS` and `DEPOSIT_PRICE_MAX_AGE_MS` (`src/config/limits.ts`).
The catalogue itself carries addresses only, and it is unchanged.

## Requests

Asset, network, copy and QR make zero requests. The dialog only reads the shared market
snapshot (`marketDataStore.getState()`): it never subscribes and never fetches.
Measured in `scripts/qa-deposit-ui.cjs`: one catalogue GET on open, 0 during interactions,
one on retry, and 0 in 60 s idle, for Header and Wallet alike.
`scripts/qa-deposit-catalogue-edge.cjs` showed one anonymous GET to the Worker, 0 Render catalogue calls,
and no fallback.

## Screenshots

`before-*`: `main` as it was.

`after-*`:
- `*-default-usdt-trc20`: the window as it opens.
- `*-menu`: the asset popover or sheet.
- `*-eth`: ETH, a single-network asset.
- `*-btc-priced`: the minimum shown with a held price.

Widths: 1920, 1440, 430, 390, 360 and 320, for Header and Wallet.
