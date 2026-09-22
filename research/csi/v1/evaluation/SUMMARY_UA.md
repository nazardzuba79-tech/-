# Оцінка одиночних кандидатів — підсумок (v1, 2026-09-22)

## Обмеження (читати першим)
- Це оцінка **51 реалізованої ознаки** (44 id з каталогу + 7 нових N-id + 2 контролі), а не 240 кандидатів. Повна карта 240 → статус у `catalog_audit.csv`
  (`evaluated` 44, `redundant_family` 11, `computable_not_evaluated` 66, `data_unavailable` 52, `insufficient_history` 6, `untestable_definition` 61).
- Ціна для CYCLE і REGIME — референсна ціна Coin Metrics `PriceUSD` (не виконувана біржова); для TACTICAL — OKX spot (Binance/Bybit геозаблоковані).
- Coin Metrics lag 1, FRED 1/8/30, DefiLlama 1 — контрактні лаги власника, **не** перевірені дати релізів/vintages. `available_at` не доводить відсутність leakage при revisions.
- Для h ≥ 180 ефективна вибірка ≈ 8–12 неперекривних спостережень на development. Це принципово слабкі докази; bootstrap-інтервали широкі.
- Холдаут (з 2023-01-31) для h ≥ 90 має N_eff < 30 (h=90: ~14; h=180: ~6; h=365: ~2.6) → усі холдаут-значення для цих горизонтів мають статус `insufficient` за правилом протоколу і в таблицях показані як порожні.
- Знаки зафіксовано до обчислень (`docs/PREREGISTRATION.md`, хеш `csi/features.py`). Дві поправки протоколу після першого прогону записані в `experiments/experiments.jsonl` (attempt 3): порогова кількість N_eff для h≥180 та довше CM-вікно для REGIME. Знаки не змінювалися.

## Результат на development (до 2022-12-31), первинний горизонт, найгірший зріз
Файл: `ic_ranking_dev.csv`. «confirmed_dev» = знак збігся у всіх валідних зрізах **і** 90% block-bootstrap інтервал pooled IC не містить 0.

| Система | confirmed_dev | найкращі (signed IC у найгіршому зрізі) | не підтверджені / протилежний знак |
|---|---|---|---|
| CYCLE (h=365) | **M066** log power-law residual (0.53), **O013** mcap/thermocap (0.42) | O081 exch. supply ratio 0.26, O072 Puell 0.22, N001 ROI1y 0.22, M058 2Y-MA 0.16, O059 fee share 0.16, O004 MVRV-Z 0.15 (усі з CI, що містить 0) | O003 MVRV −0.14 (у зрізі ex_2020), M057 Mayer −0.13, O067 hash ribbons −0.13, N002, O011; M059/M065 — insufficient |
| REGIME (h=30) | **O080** exch. balance Δ30 (0.15), **O079** exch. netflow (0.15; сім'я O080, ρ=1.0), **O046** active addresses Δ30 (0.14), **M106** broad dollar Δ (0.13), **N004** spot volume Δ (0.10) | O049 tx count 0.09, M015 momentum 0.09, M115 net liquidity 0.085, O102 stablecoin Δ 0.08, M001 SMA200 0.07, M107 real yield 0.07 | M088 ETH/BTC (−0.14, протилежний), O113 TVL, M096 FNG, M110 SP500, O115 DEX, M105 M2, M109 VIX; M108/M117 insufficient |
| TACTICAL (h=7, контртрендова гіпотеза) | **немає** | — | усі stretch-міри мають **позитивний** IC на 7 днів (RSI +0.07, CCI +0.075, %B +0.05): короткостроковий momentum, а не реверс; M044 drawdown −0.23 у since_2022; funding/LS/taker — insufficient (72–180 днів) |

## Що це означає
1. Валуаційні міри одного сімейства (MVRV, MVRV-Z, Mayer, 2Y-MA, thermocap, power-law, ROI1y, mcap/address) корелюють між собою ρ 0.8–0.98 на development (`clusters_dev.csv`). Це **одна** інформація, а не 8 голосів.
2. З цього сімейства найстійкіший напрям на development має power-law residual / mcap-thermocap (обидва — «відстань від довгого тренду з часу генезису»). MVRV на 365 днів у full-зрізі ≈ 0, тобто популярний «купуй при низькому MVRV» **не** підтверджений на цих даних у цьому дизайні.
3. REGIME: біржові баланси, активність адрес, долар і спот-обсяг мають слабкий, але узгоджений напрям на 2011–2022; ефекти 0.10–0.16 IC.
4. TACTICAL: контртрендова гіпотеза на 7 днів **спростована на development** (напрям протилежний). Це валідний негативний результат.

## Файли
`ic_individual.csv` (усі комбінації ознака × ціна × горизонт × вікно × зріз, з 90% інтервалами), `ic_summary_by_horizon.csv`, `ic_ranking_dev.csv`, `corr_dev.csv`, `clusters_dev.csv`, `catalog_audit.csv`, `evaluate_run.log`.
