# FEED_FEASIBILITY — чи можна подати кожен вхід у TradingView Pine

Pine Script читає лише символи, доступні в TradingView через `request.security()`; довільний REST API недоступний;
нові Pine Seeds репозиторії зараз не створюються (див. `snapshot/research/SPEC_AUDIT_UA.md`, п.16). Отже повна
Python-модель у TradingView **не відтворюється**. Нижче — статус кожного входу v1.

| Вхід (fid) | Джерело в Python | Еквівалент у TradingView | Статус для Pine |
|---|---|---|---|
| OKX spot OHLCV (M017, M018, M021, M040, M044, N005, N006, M053, C001) | OKX `BTC-USDT` 1Dutc | `OKX:BTCUSDT` D (той самий venue) | **feasible**, паритет можливий, але не перевірено компіляцією тут |
| Coin Metrics PriceUSD (M057, M058, M059, M065, M066, M001, M015, N003, C002) | CM reference rate | немає точного еквівалента; `INDEX:BTCUSD` / `CRYPTOCAP:BTC` наближення | **approximation** — інша ціна, інша історія, інший id |
| CapMVRVCur, realized cap (O003, O004) | Coin Metrics Community | немає (в TV є лише деякі `GLASSNODE:`/`INTOTHEBLOCK:` символи з іншими визначеннями) | **not feasible** в еквівалентному визначенні |
| IssTotUSD, HashRate, FeeTotNtv, IssTotNtv (O072, O013, O067, O059) | Coin Metrics | частково `INDEX:BTC_HASHRATE`?; не перевірено | **unverified** |
| Exchange flows/supply (O079, O080, O081) | Coin Metrics | немає | **not feasible** |
| AdrActCnt, TxCnt (N002, O046, O049) | Coin Metrics | немає еквівалента з тим самим визначенням | **not feasible** |
| Stablecoin mcap, TVL, DEX volume (O102, O103, O113, O115) | DefiLlama | `CRYPTOCAP:USDT`+`CRYPTOCAP:USDC` — наближення; TVL/DEX немає | **approximation / not feasible** |
| FRED (M115, M106, M107, M109, M110, M108, M105) | FRED CSV | `FRED:WALCL`, `FRED:WTREGEN`, `FRED:RRPONTSYD`, `FRED:M2SL`, `FRED:DTWEXBGS`, `FRED:DFII10`, `FRED:BAMLH0A0HYM2`, `CBOE:VIX`, `SP:SPX` | **feasible**, але дата публікації в TV ≠ контрактний lag 8/30 днів: паритет по часу треба перевіряти окремо |
| Fear & Greed (M096) | alternative.me | немає офіційного символу | **not feasible** |
| ETF flows (M117) | Farside | немає | **not feasible** |
| Perp-spot basis (M068) | OKX perp/spot | `OKX:BTCUSDT.P` / `OKX:BTCUSDT` | **feasible** (2020+) |
| Funding, OI, long/short, taker (M067, N007, N008) | OKX rubik, 72–180 днів | немає історії | **not feasible / insufficient** |

## Висновок
- **Повна модель**: лише Python + dashboard (`platform/dashboard.html`, `csi/dashboard.py`).
- **Reduced Pine**: окремі версії з іншим статусом і назвою (`*_reduced`), тільки з feasible-входів:
  - `CYCLE_reduced`: Mayer Multiple, 2Y MA multiplier, 200W MA distance (ціна — символ графіка; онлайн-складники MVRV/Puell/thermocap **втрачено**).
  - `REGIME_reduced`: SMA200 distance, TS momentum 90d, realized vol 30d, FRED DTWEXBGS/DFII10 зміни (втрачено: stablecoins, exchange flows, net liquidity з контрактним лагом, ETH/BTC можна додати як `OKX:ETHBTC`).
  - `TACTICAL_reduced`: RSI14, %B, stochastic, CCI, drawdown 90d, basis (OKX perp/spot).
- Pine-файли в `platform/pine/` **не компілювалися** в TradingView у цьому середовищі (немає доступу до редактора). Статус: `NOT_COMPILED`, `NOT_BACKTESTED_IN_TV`. Паритет сигналів з Python не заявляється.

## Оновлення v3 (2026-09-23)
- **BitMEX funding (R101, T102, C102): недоступний наживо ніде** — контракти XBTUSD/ETHUSD закрито 2026-09-16.
- FRED H.10 (`DTWEXBGS`, `DEXKOUS`) виходять щотижня; у TradingView `FRED:*` символи показують значення на дату спостереження, тобто з заглядом уперед на 3–7 днів відносно реальної публікації.
- `DERIBIT:DVOL` — назва символу не перевірена (немає доступу до TradingView); у скрипті її можна змінити, а за відсутності символу компонент пропускається.
- Нові скрипти v3 і що в них втрачено: `CSI_Cycle_Gauge` — лише відхилення від тренду (MVRV, Puell, thermocap і біржові баланси в TradingView відсутні); `CSI_Trend_Filter` — нічого не втрачено (ціна графіка); `CSI_Regime_Premiums_research` — 2 з 4 входів REGIME pruned (немає біржових балансів Coin Metrics і BitMEX funding); `CSI_Tactical_DVOL_research` — 2 з 3 (немає BitMEX funding).
