# Order panel, account block and top navigation — before / after

Captured with `scripts/qa-order-panel-nav.cjs`, which drives the REAL built
app against `scripts/qa-futures-account-harness.cjs`: a loopback-only
fixture server with no database, no provider egress and no real funds. The
two builds differ only in the frontend bundle — same harness, same fixture
account, same viewport, same token — so every difference below is the
change and nothing else.

* `before-*` — a build of `origin/main` at `d4fb9da`.
* `after-*`  — this branch.
* `*-large`    — fixture `qa-user-c`, an eight-digit balance, one open
  position. This is the shape that produced the label/number collision in
  the owner's screenshot.
* `*-ordinary` — fixture `qa-user-a`, a five-digit balance, one open
  position.

Every figure in those fixtures is local test data. Nothing here was read
from or written to a production ledger.

## What changed, measured

| Check | before | after |
|---|---|---|
| A duplicate margin-mode row in the bottom card | True | False |
| Wallet links in the desktop header right block | 0 | 1 |
| The slider's own percentage floating over the track | True | False |
| Header height, desktop | 48px | 48px |
| Header height, mobile | 56px | 56px |
| «Перевести» area covered by the support launcher, at rest, 1440 | 279 px² | 0 px² |
| «Перевести» area covered, 1366 | 279 px² | 0 px² |
| Deposit / Transfer button sizes | 119x34 and 119x34 | 119x34 and 119x34 |
| Margin-usage bars (width × height) | none rendered inline | 34×3 and 34×3, both ending at x=1361 |

## Eight-digit account (`qa-user-c`)

### desktop-1440x900

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 77 |
| Маржинальный баланс | `56405024.03 USDT` | 10 |
| Доступная маржа | `56381922.68 USDT` | 10 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `56 405 024.03 USDT` | wrapped |
| Доступная маржа | `56 381 922.68 USDT` | 24 |
| Нереализ. PnL | `+508.92 USDT` | 79 |
| Используемая НМ | `0.04%` | 87 |
| Используемая ПМ | `<0.01%` | 87 |

Horizontal page overflow: 0px before, 0px after.

### desktop-1366x768

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 77 |
| Маржинальный баланс | `56405024.03 USDT` | 10 |
| Доступная маржа | `56381922.68 USDT` | 10 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `56 405 024.03 USDT` | wrapped |
| Доступная маржа | `56 381 922.68 USDT` | 24 |
| Нереализ. PnL | `+508.92 USDT` | 79 |
| Используемая НМ | `0.04%` | 87 |
| Используемая ПМ | `<0.01%` | 87 |

Horizontal page overflow: 0px before, 0px after.

### mobile-390x844

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 187 |
| Маржинальный баланс | `56405024.03 USDT` | 72 |
| Доступная маржа | `56381922.68 USDT` | 105 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `56 405 024.03 USDT` | 104 |
| Доступная маржа | `56 381 922.68 USDT` | 134 |
| Нереализ. PnL | `+508.92 USDT` | 189 |
| Используемая НМ | `0.04%` | 197 |
| Используемая ПМ | `<0.01%` | 197 |

Horizontal page overflow: 0px before, 0px after.

## Five-digit account (`qa-user-a`)

### desktop-1440x900

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 77 |
| Маржинальный баланс | `10250.00 USDT` | 10 |
| Доступная маржа | `10000.00 USDT` | 22 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `10 250.00 USDT` | 21 |
| Доступная маржа | `10 000.00 USDT` | 51 |
| Нереализ. PnL | `+11.75 USDT` | 87 |
| Используемая НМ | `5.07%` | 87 |
| Используемая ПМ | `0.25%` | 87 |

Horizontal page overflow: 0px before, 0px after.

### desktop-1366x768

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 77 |
| Маржинальный баланс | `10250.00 USDT` | 10 |
| Доступная маржа | `10000.00 USDT` | 22 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `10 250.00 USDT` | 21 |
| Доступная маржа | `10 000.00 USDT` | 51 |
| Нереализ. PnL | `+11.75 USDT` | 87 |
| Используемая НМ | `5.07%` | 87 |
| Используемая ПМ | `0.25%` | 87 |

Horizontal page overflow: 0px before, 0px after.

### mobile-390x844

Before:

| label | value | label→value gap |
|---|---|---|
| Тип маржи | `Изолированная` | 187 |
| Маржинальный баланс | `10250.00 USDT` | 99 |
| Доступная маржа | `10000.00 USDT` | 132 |

After:

| label | value | label→value gap |
|---|---|---|
| Маржинальный баланс | `10 250.00 USDT` | 131 |
| Доступная маржа | `10 000.00 USDT` | 161 |
| Нереализ. PnL | `+11.75 USDT` | 197 |
| Используемая НМ | `5.07%` | 197 |
| Используемая ПМ | `0.25%` | 197 |

Horizontal page overflow: 0px before, 0px after.

`gap` is the measured pixel distance between the end of the label and the
start of the value. `wrapped` means the whole value sits on its own line,
right-aligned under the label — the controlled narrow-panel fallback, never
a number broken part-way.

## What the wrap costs, stated plainly

On the 278px order column, `Маржинальный баланс` plus a grouped eight-digit
amount needs about 260px against 246px of content width. It does not fit on
one line and it is not allowed to be abbreviated, so on an eight-figure
account that one row wraps its value underneath. Every other row, and every
row of an ordinary account, is a single line. See the `after-ordinary`
tables above.

## Files

Per capture: `<viewport>-page.png` (the whole terminal),
`<viewport>-header.png` (the full top navigation on its own),
`<viewport>-panel.png` (the right order/account column),
`<viewport>-account.png` (the account card alone) and `report.json`.

## Header across routes and auth states

`scripts/qa-header-states.cjs` visits `/futures`, `/trade`, `/markets`,
`/wallet` and `/copy-trading` at 1440 and 390, as an ordinary user, as an
admin and logged out. Result on this branch: exactly one desktop wallet
link everywhere, always immediately before the deposit button, none left in
the product sections, the wallet still present in the mobile menu, the
admin section still admin-only, active state on `/wallet`, 8px between
wallet and deposit and 16px after it, and zero horizontal overflow. Header
heights are identical to the `main` build on every route and width.
