# CSI v1 — CYCLE / REGIME / TACTICAL: зібрані дані, перевірки, три системи (research-only)

**Режим A: дані отримано.** 435 259 рядків, 114 серій, lag_check PASS. **Жодна з трьох систем не має підтвердженої переваги на холдауті.**
Коротко: CYCLE — один price-only компонент з узгодженим напрямом, але ~8 незалежних спостережень; REGIME — слабкий ефект на 2011–2022,
що змінює знак після 2022; TACTICAL — контртрендова гіпотеза спростована. Детально: `systems/SUMMARY_UA.md`, `evaluation/SUMMARY_UA.md`, `docs/LIMITATIONS_UA.md`.

## Як відтворити (Python 3.11, numpy/pandas/scipy/pytest)
```bash
cd research/csi/v1
gunzip -k data/csi.db.gz                 # якщо є лише стиснена база
python -m csi.preflight                   # 4 обов'язкові probe → reports/network_probe_*.json
python -m csi.collect --source all        # повторний збір (upsert; сирі відповіді append-only у raw/)
python -m csi.validate                    # lag_check / coverage / missing / gap audit → reports/
python -m csi.evaluate                    # одиночні IC (≈4 хв, bootstrap) → evaluation/
python -m csi.systems                     # композити + ОДИН холдаут → systems/
python -m csi.catalog_audit               # 240 кандидатів → статус
python -m csi.dashboard                   # platform/dashboard.html
python -m pytest -q tests                 # 13 тестів механіки (не докази дохідності)
```
Увага: повторний `csi.systems` після перегляду холдауту не є новим blind-тестом (див. `docs/PREREGISTRATION.md`, stopping rule).

## Структура
```
README_UA.md, NOTES_UA.md              цей файл; журнал збору дослівно
docs/PREREGISTRATION.md (+_HASH.txt)   протокол, зафіксований до обчислень; docs/LIMITATIONS_UA.md; docs/SOURCES_LICENSES.md
csi/                                   код: store.py (схема, raw, manifest), collect.py (адаптери), validate.py, dataset.py (PIT-вирівнювання),
                                       features.py (реєстр ознак зі знаками), evaluate.py (IC), systems.py (композити), catalog_audit.py, dashboard.py, preflight.py
data/csi.db(.gz), series.csv.gz, sidecar.db (fetch ledger)
raw/<source>/*.gz + MANIFEST.csv + CHECKSUMS.csv   дослівні байти кожної відповіді
reports/                               lag_check, coverage, sources_check, missing/obtained core metrics, units_check, publication_lag_audit,
                                       funding_event_counts, farside_total_check, coinmetrics_wanted_obtained, data_validation.json
evaluation/                            ic_individual.csv, ic_ranking_dev.csv, ic_summary_by_horizon.csv, corr/clusters, catalog_audit.csv, SUMMARY_UA.md
systems/{cycle,regime,tactical}/       results.json, composite_*.csv, backtest_*.csv; systems/SUMMARY_UA.md
experiments/experiments.jsonl          усі спроби з лічильником, включно з поправками протоколу
platform/                              dashboard.html, FEED_FEASIBILITY.md, pine/*_reduced.pine (NOT_COMPILED)
tests/test_protocol.py                 13 тестів: лаги, causal percentile, зрізи, парсер Farside, витрати у backtest
```

## Як читати score
`score ∈ [0,1]` — рівнозважене середнє причинних percentile-рангів компонентів зі знаками. Це **оцінка стану**, не калібрована ймовірність і не інструкція до угоди.
CYCLE: 1 = «дорого» відносно власної історії. REGIME/TACTICAL: 1 = «сприятливо» під pre-registered знаками, які на холдауті не підтвердилися.
Backtests у `systems/*/backtest_*.csv` — модельна експозиція 0..1 з витратами 0.15%/сторона, без шортів і без плечей.

## Що далі (не зроблено у v1)
- ETH-системи; 66 обчислюваних кандидатів із каталогу; NVT/HODL-сімейство потребує платних/інших даних.
- Vintage-аудит FRED (ALFRED) і Coin Metrics revisions перед будь-якою заявою «leakage-free».
- Окрема pre-registration для гіпотез, що виникли post-hoc (протилежний знак fee share на 365d; короткостроковий momentum на 7d).
