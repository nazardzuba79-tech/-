# Spot button labels + the Wallet gainers tape — evidence

Two small corrections. Local presentation QA only: fixture market data,
zeroed balances, reads only, every write 404s.

## Spot action buttons

Covered by a **real React render of the real `OrderForm`** across five pairs
in `frontend/src/lib/__tests__/spotButtonLabels.test.ts` — BTC/USDT,
ETH/USDT, **USELESS/USDT**, SOL/USDC, DOGE/EUR. It asserts the three action
labels are byte-identical on every pair, contain neither the base nor the
quote asset of that pair, and read «Купить»/«Продать» in RU and Buy/Sell in
EN. It also asserts no locale's `trade.buy`/`trade.sell` carries a
placeholder, so localization cannot reintroduce the ticker.

**This is not checked in the browser harness.** `scripts/qa-spot-labels-wallet-tape.cjs`
cannot serve the Spot terminal's full data surface — the page hits its error
boundary on an unrelated component — and a half-rendered page would be
weaker evidence than that render, not stronger. Said plainly rather than
worked around.

Futures is a separate component and keeps its position wording; the same
test pins `Открыть Лонг` / `Открыть Шорт` / `Закрыть Лонг` / `Закрыть Шорт`
and that Futures does not build labels from the Spot keys.

## The Wallet gainers tape

Measured in Chromium at 1440×900, the same page before and after the change:

| | tape present | tape height | content top | gap below header |
|---|---|---|---|---|
| before (`metrics-before.json`) | yes | 34px | 98px | **34px** |
| after (`metrics.json`) | no | — | 64px | **0px** |

The content rose by exactly the tape's own height. No leftover band, no
extra top padding, and horizontal overflow stays 0.

`futures-with-tape.png` shows the tape still rendering on a page that keeps
it — the flag is per page, not global. Its own header/content numbers in
`metrics.json` are not comparable with Wallet's (different page structure)
and are recorded, not asserted.

Re-run the before half with `QA_MEASURE_ONLY=1`, which records the same
geometry without asserting the tape is gone.

## Not verified

No production check. Non-RU locales were checked for key presence and EN was
rendered; the other five were not laid out in a browser.
