# Deposit: explicit asset field, network choice, minimum 300 USD (2026-09-29)

Owner request: in «Пополнение» the only way to pick another asset was the small
«Bitcoin ›» under the heading, and the 300 USD minimum was not shown at all in
the catalogue (Cloudflare) mode. Follow-up the same day: USDT on TRC-20 first,
and a more obvious chevron on the asset field.

Original PR #339 base: `main` `9c746c61`. Completion base: `main`
`d2e98bb083d11ba128b72abab7b1618a4b4c1399`, preserving the released VTA cycles.
LOCAL QA ONLY: every screenshot is the real
dialog on `frontend/qa/deposit-preview.html` (Vite, `VITE_MANUAL_DEPOSIT_CATALOGUE=true`)
with synthetic addresses. No production catalogue, address, secret or balance
was read or changed.

## What changed

| Before | After |
|---|---|
| «Bitcoin ›» link under «Ваш адрес BTC» | **Актив** field: icon, ticker, name and a gold chevron key. It opens a popover under the field on desktop and a bottom sheet with 60 px rows on phones. Both have search, the active asset is highlighted with ✓, and they close on a second press, an outside press or Esc (focus returns to the field). |
| Network behind «Изменить сеть» (a second screen) | **Сеть**: every network of the asset is shown at once as radios. USDT shows TRON · TRC-20 and Ethereum · ERC-20 side by side. A single-network asset shows a fixed field with ✓. |
| No minimum in catalogue mode | **Минимальное пополнение: 300 USD**, placed before the address, with «Пополнения ниже минимальной суммы не зачисляются автоматически.» USDT/USDC show their `= 300` equivalent under the server's fixed 1:1 policy. Every other asset shows the USD rule alone. No volatile-coin estimate is displayed. |
| Opens on BTC | Opens on **USDT · TRC-20**. USDT heads the list and TRC-20 heads its networks. An asset asked for by a Wallet row still wins. |

The 300 USD is `DEPOSIT_MINIMUM_USD` in `frontend/src/lib/depositMinimum.ts`,
pinned by `depositMinimumRule.test.ts` to the backend's `MIN_DEPOSIT_USD`
and `DEPOSIT_USD_PEGGED_ASSETS` (`src/config/limits.ts`).
The catalogue itself carries addresses only, and it is unchanged.

Review correction: #339's optional conversion dropped `tickersMeta.stale`
and only checked its age during a render. A warm-cache quote could therefore
be called current, or an already displayed estimate could outlive its age
limit. The completed dialog does not read market quotes. Its stable policy
equivalent cannot expire while the address window stays open. The legacy
`depositMinimumEquivalent` helper and legacy treasury UI are unchanged.

## Requests

Asset, network, copy and QR make zero requests. The dialog does not read or
subscribe to the market store and adds no price request or timer.
Measured on the original #339 head in `scripts/qa-deposit-ui.cjs`: one catalogue GET on open, 0 during interactions,
one on retry, and 0 in 60 s idle, for Header and Wallet alike.
`scripts/qa-deposit-catalogue-edge.cjs` showed one anonymous GET to the Worker, 0 Render catalogue calls,
and no fallback.

## Screenshots

`before-*`: `main` as it was.

`after-*`:
- `*-default-usdt-trc20`: the window as it opens.
- `*-menu`: the asset popover or sheet.
- `*-eth`: ETH, a single-network asset.
- `*-btc-priced`: historical #339 review evidence showing the optional
  conversion that the completion removes; these two images are not final UI.

The updated browser runner saves `*-btc-usd-only` and checks BTC/ETH after a
committed parent render with fresh, explicitly stale and expired page quotes.
Completion-run results and screenshots are recorded separately; do not treat
the original #339 measurements as verification of a later head.

Widths: 1920, 1440, 430, 390, 360 and 320, for Header and Wallet.

## Follow-up: the minimum in two lines, and no «V» on Wallet (2026-09-29)

Owner: the note «Для зачисления сумма подтверждённых пополнений в одном активе
и одной сети должна быть не ниже минимума» was hard for newcomers; approved
wording per coin, a two-line block, and the large decorative «V» removed from
the Wallet overview.

| Coin | Line 1 (bold) |
|---|---|
| USDT / USDC (and the other pegged USD, DAI) | Минимальное пополнение — 300 USDT / 300 USDC |
| BTC, ETH, BNB, SOL, POL, TON | Минимальное пополнение — 300 USDT или эквивалент в BTC (≈ 0,003 BTC) |

Line 2: «Несколько переводов в одном активе и сети суммируются.» (the same
rule as before, said plainly).

The `(≈ …)` part closes both gaps the #339 review found:
- it needs a price that is live (`tickersMeta.stale === false`, so never the
  warm cache or a stale-served snapshot);
- the price must be younger than `DEPOSIT_PRICE_MAX_AGE_MS`, which is pinned
  to the server's own bound;
- a one-shot timeout takes an estimate down the moment it ages out, even
  with no other re-render;
- the window reads only the shared market snapshot: no request, no
  subscription, no polling.

Without such a price the line reads «… или эквивалент в BTC» alone. On
Wallet alone the snapshot is usually not live, so that is the common case
there.

Screenshots: `minimum-before-*` (main `9742375b`), `minimum-after-*`,
`wallet-no-v-{1440,390}` (local fixture, no data).
