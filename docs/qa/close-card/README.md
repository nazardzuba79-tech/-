# «Позиция закрыта» card — browser QA (2026-10-01)

Built frontend (`vite build`) served by a scratch copy of `scripts/preview-archive-terminal.cjs`. The copy adds a local close fixture:
- `POST /futures/positions/:id/close` answers two fills, 0.300 @ 81,485.50 and 0.150 @ 81,484.00;
- the position history then answers the row with realized P&L +805.32 after 700 ms.

Nothing is sent upstream and no real account is involved. Market data was unavailable in the sandbox, so the chart and book are empty.

| Check | Result |
|---|---|
| Card text: «Позиция закрыта», `BTCUSDT · Лонг 50.00x`, `0.450 BTC`, `81,485.00` (VWAP of the fills), `+805.32 USDT`, «История позиций →» | PASS |
| P&L reads «…» (`aria-busy`) until the history answers | PASS |
| Desktop 1440: 300 px wide, 20 px from the right edge, no fixed element underneath | PASS |
| Auto-hides | PASS, 6.35–6.39 s |
| Hover pauses; hides about 6 s after the pointer leaves | PASS |
| × closes it | PASS |
| «История позиций →» opens the page's Position History tab and closes the card | PASS |
| Refused close (`STALE_BOOK`): red card, `role="alert"`, reason shown once, no history link | PASS |
| Phone 390: 16 px gutters, no horizontal overflow, clear of the support launcher | PASS |

Known trade-off: on 1366–1536 px wide laptops the bottom-right card covers «Открыть Лонг/Шорт» while it is shown. It shows for 6 s and can be closed with ×.

Screenshots: `closed-1440.png`, `history-link-1440.png`, `failed-1440.png`, `closed-390.png`, `failed-390.png`.
