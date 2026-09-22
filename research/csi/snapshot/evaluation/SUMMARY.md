# Оцінка
## Обмеження
NOT RUN — NO MARKET DATA. IC, forward returns, clustering, ranking and backtests не обчислювалися. Відсутність CSV з метриками результату навмисна; нулі замість відсутніх тестів були б неправдивими.

## Контракт для наступного агента
1. Одиночні кандидати, а не композити. Causal rolling/expanding transforms, не global fit.
2. Цілі 1/7/30/90/180/365 днів; ціна в момент рішення має бути доступною та виконуваною.
3. Зрізи full; ex_2020-03_2022-01 (виключити 2020-03-01…2022-01-31); ex_2017; since_2022. Це точне операційне тлумачення labels, яке зафіксовано перед оцінкою. Вилучати також observations, чий target window перетинає excluded interval.
4. Rank за найгіршим валідним зрізом при фіксованому напрямі сигналу. Окремо insufficient coverage; не абсолютний IC, підібраний після перегляду test.
5. Кореляції та family clustering лише на train. Різні missing masks не порівнювати як однакове покриття.
6. Long horizons overlap: block-resampling та effective sample size; не iid t-test на тисячах overlapping targets.
7. Дані/фіт/відбір/пороги мають бути відокремлені в часі; feature lookback і label horizon врахувати в purge/embargo. Обмежений pre-registered experiment budget.
8. Кожна спроба й відхилена версія у experiments.jsonl. Відкритий OOS більше не є blind holdout; наступний прогін на ньому не нове підтвердження.
9. Всі джерела/визначення/версії зафіксувати hashes. Primary outcome, sample exclusions, cost assumptions і stopping rule записати до тестів.
