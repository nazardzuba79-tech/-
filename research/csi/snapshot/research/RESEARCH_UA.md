# Дослідницька основа CYCLE / REGIME / TACTICAL
**Дата:** 21 вересня 2026. **Статус:** RESEARCH ONLY — NO DATA.

## 1. Відповідь на головне питання

Підготовлено 120 ринкових та 120 ончейн-кандидатів. Це не рейтинг 240 прибуткових сигналів. Пул містить готові математичні індикатори, первинні поля, операційні гіпотези та негативні контролі. Вони розділені в `selection_metadata.json`; різні похідні одного входу не слід вважати незалежними свідченнями. Обрати емпірично «найкращі» без отриманої історії та відокремлених тестів неможливо підтвердити в цій сесії.

Користувацька постановка задає три різні горизонти. CYCLE оцінює довгу відносну дорожнечу; REGIME — стан потоків та ризику; TACTICAL — коротший перекос позиціонування. Тут не встановлено ваг, порогів, готових композитів чи правил торгівлі. Матеріали призначені наступному агенту для перевірюваного збору даних, відбору та реалізації. Джерело постановки — обидва незмінені файли в `inputs/`, розділ 1.

Усі чотири обов’язкові curl-запити із середовища коду завершилися DNS-помилкою. Відповідь HTTP взагалі не отримана: `000` — це вивід curl, а не код сервера. Публічні вебсторінки відкривалися іншим інструментом; їхні графіки й числа не переносилися до бази. У таблиці `series` нуль рядків. Це фактичний результат локального `reports/network_probe.json`, не висновок про недоступність даних для будь-якого іншого комп’ютера.

## 2. Що означає дослідницький відбір

Попередній вердикт оцінює прозорість визначення, правдоподібність механізму, відмінність від сусідніх кандидатів, можливість побудувати історію та ризик помилки. Він не є результатом backtest. `keep_candidate` означає залишити для одиночної перевірки; `weak` — нижчий пріоритет; `untestable` — спершу вирішити конкретну прогалину визначення або даних; `reject` — не використовувати заявлену реалізацію як торговий голос, зберігши її як негативний контроль.

Публічність опису не означає публічність повної історії, а безкоштовний перегляд графіка не означає право автоматично перевидавати дані. `free` у таблиці описує запланований безключовий шлях, не успішно підтверджений доступ. `freemium` означає невизначений entitlement або обмежений сервіс; це не твердження, що кожна така метрика потребує оплати. Для локального відтворення ledger-метрик витрати обчислень/зберігання враховуються окремо. Відомостей для точного price comparison у пакеті немає.

Каталог навмисно залишає суперечливі S2F, Rainbow, Pi Cycle, Golden Ratio та halving timing. Виключити відомі невдалі або сумнівні ідеї з протоколу означало б приховати частину пошуку. Відхилення S2F як готової цінової моделі тут є нашою методологічною оцінкою, а не новим проведеним статистичним спростуванням.

## 3. Що дійсно дає література про технічні правила

[Technical trading and cryptocurrencies](https://link.springer.com/article/10.1007/s10479-019-03357-1) показує, чому не можна звести всю літературу до «індикатори працюють» чи «не працюють». Автори отримали позитивні результати для багатьох технічних правил у своїй вибірці, але обрані Bitcoin-правила не зберегли позитивних результатів на їхньому OOS, тоді як інші досліджені криптоактиви поводилися інакше. Це історичний результат конкретного дизайну; наші 240 кандидати в тій роботі як один пул не досліджувалися. Ми не повторювали її обчислення.

[Time Series Momentum](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum) є первинною авторською сторінкою дослідження трендової інерції на традиційних ф’ючерсах. Вона обґрунтовує перевірку простого trend baseline, але не гарантує перевагу на BTC, конкретній біржі чи після теперішніх витрат. У каталозі така переносимість позначена як гіпотеза. NBER-анотація Liu/Tsyvinski знайдена, але повний документ не відкрився; її не використано як повністю прочитаний доказ і не приписано їй висновків про наші індикатори.

[How Backtest Overfitting in Finance Leads to False Discoveries](https://academic.oup.com/jrssig/article/18/6/22/7038278) розглядає помилкові відкриття при переборі великої кількості варіантів. Наш висновок для робочого процесу: облік усіх спроб, обмеження бюджету пошуку до перегляду результатів, відділення відбору від фінального тесту. Більша кількість індикаторів збільшує простір вибору, а не автоматично кількість незалежних економічних причин руху.

## 4. Ринкові групи: що в них досліджувати

**Тренд і momentum.** SMA/EMA, MACD, ROC, регресійний нахил і time-series momentum описують споріднену історію ціни. Питання для тесту — чи додає форма фільтра щось понад простий контроль, а не скільки «підтверджень» одночасно світяться зеленим. Стандартна бібліотека описує реалізації, warm-up та виходи, але не присвоює їм доведену прибутковість: [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/), [TA-Lib function list](https://ta-lib.org/functions/). Їхній вихідний код у цей архів не скопійовано; агент повинен перевірити ліцензію та зафіксувати версію перед використанням.

**Волатильність.** ATR, realized volatility, bandwidth, downside risk та vol-of-vol доцільно розглядати насамперед як опис стану/масштабу ризику. Це наша класифікація функції, не доказ їхнього прогнозного знака. ATR і NATR несуть майже ту саму інформацію з різним масштабуванням; %B — трансформація локальної відстані ціни за фіксованих bands. Отриманий режим високої волатильності не означає автоматично LONG або SHORT.

**Обсяг.** OBV, CMF, MFI та Force Index використовують барний обсяг і ціну. Їх не можна представляти як точне спостереження «гроші зайшли» або біржову агресорну дельту. Самі їхні операційні формули не містять ідентичності платника/одержувача капіталу. Документація визначає ці виходи: [Obv — library specification](https://python.stockindicators.dev/indicators/Obv/), [Cmf — library specification](https://python.stockindicators.dev/indicators/Cmf/), [Mfi — library specification](https://python.stockindicators.dev/indicators/Mfi/), [ForceIndex — library specification](https://python.stockindicators.dev/indicators/ForceIndex/). Для VWAP з OHLCV потрібно позначити барну апроксимацію TP×V; точний trade-level VWAP потребує угод.

**Позиціонування.** Funding, basis, OI, liquidation tape і option surfaces вимірюють різні речі. Вони не взаємозамінні. Перевірені розділи [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) дають конкретне обмеження OI-history та можливість зміни funding interval. Документація [Deribit API documentation](https://docs.deribit.com/) підтверджує наявність API-платформи, але повну історію expired options тут не отримано. Тому опціонні кандидати залишені `untestable`, а не заповнені волатильністю spot.

**Ширина ринку.** Для top100 breadth потрібен склад ринку, відомий на кожну минулу дату. Поточний список монет, розтягнутий назад, створює survivorship bias — це логічна властивість такого дизайну, не властивість назви індикатора. Документ [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) описує історичні ціни, але сам собою не дає point-in-time constituents. Ринковий індекс Fear & Greed також не незалежний від ціни: його опис включає price momentum/volume та volatility ([Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/)).

## 5. Ончейн valuation: cost basis, а не магічна справедлива ціна

Офіційні визначення [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) та [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) дають основу realized-cap family. Наше математичне застереження: якщо `market_cap=P*S`, `realized_price=realized_cap/S`, то `MVRV=P/realized_price`. За тих самих визначень `NUPL=1-1/MVRV`. Тому голосування MVRV, realized-price distance і aggregate NUPL може тричі підрахувати майже одну інформацію. Виведення наведене окремо, без підбору ваг.

Опис MVRV-Z у [MVRV Z-Score chart explanation](https://charts.bitbo.io/mvrv-z-score/) містить неоднозначність між ціною та capitalization і згадку full history. Не можна мовчки прийняти будь-яку таку формулу. Агент має зафіксувати одиниці чисельника/знаменника, початкову дату та causal expanding window. У каталозі спеціально використано інше канонічне поле `mvrv_z_causal`, щоб не видавати дослідницький варіант за дослівну vendor series. Абсолютні «зони купівлі» з графіка у пакет не перенесені.

STH/LTH realized prices, MVRV та SOPR потребують cohort history. Ділити total supply навпіл або використовувати одну загальну метрику для двох cohorts не дозволено. До уточнення age threshold, entity adjustments та доступності первинних даних ці кандидати не придатні до навчання. Частка старих монет змінюється і через звичайне старіння без нової купівлі; це необхідно відділяти від розповіді про накопичення інвесторів.

## 6. Активність, вік монет та біржові потоки

[Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) визначає адресну активність, [Addresses with positive balance](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adrbalcnt.md) — позитивні native balances, [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — user transaction count. Ці одиниці не є числом людей. Провайдер прямо описує проблеми dust balances у відповідній адресній метриці. Наша перевірка має порівнювати raw activity з normalization, але не називати будь-який ріст адрес adoption нового капіталу.

SOPR, CDD та dormancy описують витрачені coins і їхній вік/базу оцінки. [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) є джерелом визначення SOPR; для Reserve Risk, RHODL та деяких скоригованих варіантів точна первинна специфікація тут не підтверджена. Вони включені за вимогою користувача, але відповідні поля `unverified_definition` і `untestable` забороняють агенту непомітно реалізувати довільну версію.

Для біржових показників потрібні історичні labels. [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) попереджає, що покриття відомих exchange wallets є неповним; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) задає правила виключення частини міжбіржових переказів. Наш висновок: зміна балансу, netflow та перегляд списку labels — три різні операції. Поточні labels не можна видавати за незмінні історичні знання. Депозит на біржу є потенційно корисною подією, але не свідчить сам по собі про виконаний продаж.

## 7. ETH, stablecoins та DeFi не слід механічно переносити з BTC

Ethereum staking має окремі стани deposit, activation, exit і withdrawal; загальний баланс deposit contract не замінює активну частку stake. Публічний опис [Ethereum staking](https://ethereum.org/staking/) пояснює validator participation, але не підтверджує повну безкоштовну історію кожної beacon-метрики. Формули каталогу є контрактами того, що потрібно виміряти, а не завантаженими рядами.

За [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) base fee спалюється і відрізняється від priority fee. [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) вводить окремий blob fee context. Наша рекомендація для нормалізації: зберігати execution, consensus і blob-компоненти окремо та документувати fork boundaries. Не підміняти post-Merge ETH hash rate нулем як новим економічним спостереженням; поле тоді не застосовується у своєму старому PoW значенні.

Stablecoin stocks, net supply change та gross mints/burns також різні. Bridged representation і issuer treasury можуть впливати на counted supply без нового зовнішнього капіталу. Для географії six-chain fields свідомо зберігаються як один family: це місцезнаходження ліквідності, а не шість незалежних глобальних припливів.

[DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) чітко розрізняє TVL, USD inflows, fees, revenue та tokenholder revenue. TVL може змінитися через ціни без депозитів. Тому REGIME не повинен називати `delta(TVL_USD)` фактичним flow. Наш протокол окремо розглядає stock, price-adjusted flow та вкладені частки виручки. Історичні snapshots не реконструйовано із поточних dashboard-значень.

## 8. Найнебезпечніша помилка — час доступності

Точна схема і фіксовані лаги із вкладених вимог збережені. Проте фраза користувацького файлу про «весь захист» не доведена. [FRED API real-time periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) описує різницю між даними, відомими сьогодні, та історичним інформаційним набором. Додавання 8 або 30 днів до observation date не скасовує пізніших revisions і не гарантує правильний релізний час.

Ми не змінюємо контракт `available_at=date+lag` без дозволу. Натомість у `SPEC_AUDIT_UA.md` записані невирішені ризики та вимога до наступного агента підтвердити release/vintage availability перед заявою про leakage-free результати. `lag=0` у daily bar означає використання лише після його завершення, а не на початку тієї ж UTC-доби. Власні derived series мають успадковувати найбільш пізню доступність входів.

Для WALCL і WTREGEN є також відмінність observation convention: перший Wednesday level, другий weekly average. RRP подано в billions, тоді як WALCL/WTREGEN — у millions; це видно у [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL), [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN), [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD). Навіть правильне множення на 1000 не перетворює їхню різницю на офіційний показник crypto inflow.

## 9. Як наступному агенту перевіряти 240 кандидатів

Це запропонований протокол, не виконаний тест. Спершу отримати primary history й перевірити coverage, units, duplicates, daily boundaries та nulls. Після цього розглянути кожен кандидат окремо. `history_start` заповнювати фактичною першою валідною точкою, а не роком із реклами API. Спочатку BTC/ETH daily; повільні макросерії зберігати у природній частоті. Інші активи — лише з їхніми власними релевантними даними.

Вимоги до першої оцінки походять із вкладеного ТЗ: Spearman IC на 1/7/30/90/180/365 днів; rolling або expanding normalization; full, ex_2020-03_2022-01, ex_2017 та since_2022. Для exclusions потрібно перевіряти не лише дату сигналу, але й чи forward-return horizon заходить у вилучений період. Інакше «виключили кризу» лише формально. Ранжування за найгіршим зрізом можливе тільки для заздалегідь однакового напряму score та достатнього coverage; для слабкої вибірки потрібен статус insufficient, а не красиве місце рейтингу.

Вікна forward returns перекриваються. Отже, звичайне припущення незалежності всіх денних точок для 365-day target помилкове з самої конструкції. Пропонується blocked resampling, nested time-ordered відбір, чистий фінальний holdout і журнал кількості спроб. Не рахувати 3650 щоденних 1-year targets як 3650 незалежних циклів. Не заповнювати пропуски та не переносити fit майбутніх років у минуле.

Окремий тест повинен порівняти майбутній композит із ціною-only, onchain-only, простим трендом, cash та buy-and-hold при порівнянному ризику. Зменшення експозиції не слід плутати з новою направленою alpha. Без первинних даних в цьому пакеті ці порівняння не виконані.

## 10. Реалізація та фінальна форма

Python є канонічним місцем research/data pipeline. Окремо провести feasibility audit для TradingView: [Pine Script — Other timeframes and data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/) описує лише підтримані механізми даних, а нові Pine Seeds repositories зараз створювати не можна. Тому не обіцяти, що 240 довільних API-series автоматично потраплять у Pine.

Повна onchain модель може вимагати окремої панелі або backend; зменшена Pine-версія повинна мати свою назву/статус, власні тести й прозорий список відсутніх входів. Не можна заявити parity, підмінивши funding RSI або OI обсягом. Вимоги до repainting описує [Pine Script — Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/); компіляцію чи live sync у цьому пакеті не проводили.

## 11. Межа завершення цього етапу

Дослідницький каталог і матеріали передачі сформовані. Жодна market/onchain history не отримана, одиночні IC та кластеризація не виконані, жодний індикатор не оголошено прибутковим. Покриття джерел різне: є відкриті визначення, відкриті індекси без повної методики, пошукові анотації з невдалим open та явно непідтверджені кандидати. Ці відмінності не приховано в одному слові «перевірено».

Мережеві помилки, порожня база та маленький розмір ZIP — обмеження фактичного результату, а не привід додавати синтетичні котирування або дублювати файли для обсягу. Наступному агенту передається контрольований старт із конкретними стоп-умовами, а не чергова недоведена формула під назвою «супер».
