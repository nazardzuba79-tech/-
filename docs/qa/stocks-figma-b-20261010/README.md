# Stocks — Figma Professional B desktop review

Review date: 2026-10-10. Implementation commit: `1a7967172908109eebb19b2e6db128f221e07ed5`.

This is a desktop presentation change stacked on Draft PR #492 (`9dae03c37a51edf5734aac570ba1173b9d3ce8eb`). Fresh-fetched main: `e7c6fea3532ea78ff1e3d8287dc592ba2b82641a`. The simulator engine, provider adapters, persistence, API and database are unchanged. No merge or deployment was performed.

## Source and comparison

- [Figma B, Desktop 1920](https://www.figma.com/design/9gbmBfp0OSHTzLsnbBUnrZ/Untitled?node-id=31-3317)
- [Figma B, Desktop 1440](https://www.figma.com/design/9gbmBfp0OSHTzLsnbBUnrZ/Untitled?node-id=31-3318)
- [Visual comparison](comparison.html), including original Figma PNG exports and actual browser screenshots before/after.

Both editable frames were inspected in the existing Figma browser. No subscription was purchased. The frame labelled 1440 actually has width **2396**, height 900; its intended desktop composition occupies the first 1440 pixels, with empty space to the right. Its original PNG is retained intact. The comparison viewer clips only that empty margin with CSS. No source layer or frame geometry was edited.

The implementation matches the reference's outer layout rectangles:

| Viewport | Chart panel | Quotes panel | Ticket | Account panel |
| --- | --- | --- | --- | --- |
| 1920 × 1080 | x12 y112, 1256 × 806 | x1276 y112, 288 × 806 | x1572 y112, 336 × 934 | x12 y926, 1552 × 120 |
| 1440 × 900 | x12 y112, 792 × 632 | x812 y112, 272 × 632 | x1092 y112, 336 × 752 | x12 y752, 1072 × 112 |

Actual candle plot height increases from 545 to 666 pixels at 1920 and from 365 to 492 pixels at 1440. The previous 244-pixel account panel becomes 120/112 pixels. Desktop fullscreen, fit, zoom and earlier-candle controls were exercised. There is no page-level horizontal overflow at either requested width. Submit and close-position controls remain inside their panels.

The Figma mock order-book ladder and sample quotes are not market data. The implementation displays only the existing provider's real best bid/ask, explicitly states that depth/size is unavailable, and uses existing local fills for the trades tab. Chart high/low is explicitly labelled as the loaded chart range. Unsupported drawing/analytics controls are not presented as functional. Existing fill markers and one compact test-funds explanation are preserved.

## Validation

- TypeScript and Stocks-enabled production build: PASS.
- Default-off production build: PASS; no Stocks simulator route or new desktop header strings in emitted JS assets.
- Stocks frontend regression: **65 tests / 10 suites PASS**, including 4 desktop presentation/allocation tests.
- Unchanged simulator engine/provider/HTTP regression: **52 tests PASS**.
- Existing Vite chunk-size advisory remains; no new compile/type error.
- Browser: 1920×1080 and 1440×900; real AAPLX and NVDAX candles, provider identity, asset picker, Market/Limit, USDT/USDC, history navigation, allocation, fullscreen/zoom/fit: PASS.
- Mobile parity at 390×844: eight chart/header/tab boxes and eight ticket/form boxes have identical before/after geometry and styles. No horizontal overflow. All redesign rules are desktop-scoped; the existing mobile interface is retained.
- Final browser console error capture: empty.

Full repository frontend CI is reported on the PR for its exact final head. The local count above is the targeted Stocks suite, not a claim that the full frontend suite was rerun locally.

## Local paper-trading cycle

The loopback-only review server uses a separate copy of the prior review ledger. It never writes to the original ledger or a VOLTEX financial account.

1. AAPLX/USDT Market buy 0.1; partial sell 0.05; close the remaining 0.05.
2. Limit buy 0.1 at 1 USDT; verify 0.1 USDT reserve; cancel and release the reserve.
3. AAPLX/USDC Market buy 0.1 and close, using the actual `USDCUSDT` conversion quote (1.00082 at capture).
4. Reload; verify history, cash and realized PnL persist.
5. Independently reconcile the new fills with integer decimal arithmetic.

All **17 prior fills and 19 prior orders are unchanged**. Five new fills and six new orders reconcile with cash deltas of −0.01000000 USDT and −0.00999182 USDC; no open position or reserve remains. Existing adjustment history is unchanged. The complete browser capture contains seven write requests, all to the loopback simulator's paper-order/cancel routes; no external trading request occurred. See the JSON evidence alongside this report.

## Preview and limitations

- Local preview: `http://127.0.0.1:4439/stocks/BYBIT%3AAAPLXUSDT`
- Comparison: `http://127.0.0.1:4439/qa/stocks-figma-b-20261010/comparison.html`
- Real-data availability and stale/session guards remain those of PR #492. This desktop change does not claim to solve the existing unavailable MOEX feed or add a market-depth source.
- Actual quotes and candle content naturally differ from Figma's illustrative values and between captures.
- Preview assets are local only. Futures, Spot, Mobile, Admin, backend services, API, database and real trading are outside this change.
