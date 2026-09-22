# volatility

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M033 · Average True Range

**Канонічне поле:** `atr` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `WilderMean_n(max(H-L,abs(H-Cprev),abs(L-Cprev)))`

**Входи:** H;L;C

**Гіпотеза механізму:** Опис ризику діапазону, не прогноз напряму.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Залежить від одиниці ціни; нормалізувати окремо.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** true_range · **Перевірка визначення:** research_candidate

**Джерела:** [Atr — library specification](https://python.stockindicators.dev/indicators/Atr/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M034 · Normalized ATR

**Канонічне поле:** `natr` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `100*ATR/C`

**Входи:** H;L;C

**Гіпотеза механізму:** Порівнянність амплітуди активів.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Похідна ATR, не нове підтвердження.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** true_range · **Перевірка визначення:** research_candidate

**Джерела:** [Atr — library specification](https://python.stockindicators.dev/indicators/Atr/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M035 · Coin Metrics 30-day realized volatility

**Канонічне поле:** `VtyDayRet30d` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** Native VtyDayRet30d: точний estimator, return convention, одиниці й annualization треба перевірити за методологією Coin Metrics; не підставляти stdev Binance під це ім’я

**Входи:** Coin Metrics native VtyDayRet30d; provider methodology required

**Гіпотеза механізму:** Оцінка ризику для режиму.

**Що підтверджено:** Канонічне поле задане у ТЗ. Точне визначення та Community entitlement не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: волатильність не визначає знак дохідності; локальний estimator може не збігатися з provider series. Проксі потребує окремого metric.

**Вердикт:** keep_candidate — Залишити як потрібний у ТЗ кандидат ризику; відтворення та використання лише після перевірки визначення, entitlement і реальної історії.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics; cost=freemium; lag=1. Community entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** unverified_provider_definition

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## M036 · Volatility of volatility

**Канонічне поле:** `vol_of_vol` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `stdev(rolling_realized_vol,n)`

**Входи:** C

**Гіпотеза механізму:** Нестабільність ризику.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Другий рівень шуму, overlap вікон.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M037 · Parkinson range volatility

**Канонічне поле:** `parkinson_vol` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sqrt(mean(log(H/L)^2)/(4*log(2))*365)`

**Входи:** H;L

**Гіпотеза механізму:** Внутрішньоденний range як оцінка дисперсії.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Brownian assumptions, jumps та microstructure.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M038 · Garman-Klass volatility

**Канонічне поле:** `garman_klass_vol` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sqrt(mean(0.5*log(H/L)^2-(2*log(2)-1)*log(C/O)^2)*365)`

**Входи:** O;H;L;C

**Гіпотеза механізму:** Використання open-close разом із range.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Drift/jumps порушують припущення; від’ємне не приховувати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M039 · Bollinger bandwidth

**Канонічне поле:** `bollinger_width` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `(upper-lower)/SMA_n(C)`

**Входи:** C

**Гіпотеза механізму:** Стиснення/розширення діапазону.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не дає напряму; спільна інформація з realized vol.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [BollingerBands — library specification](https://python.stockindicators.dev/indicators/BollingerBands/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M040 · Bollinger %B

**Канонічне поле:** `bollinger_pctb` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `(C-lower)/(upper-lower)`

**Входи:** C

**Гіпотеза механізму:** Відстань ціни всередині волатильнісних смуг.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Еквівалент локального price z-score за фіксованих параметрів.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [BollingerBands — library specification](https://python.stockindicators.dev/indicators/BollingerBands/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M041 · Squeeze state

**Канонічне поле:** `squeeze_state` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `Bollinger bands lie inside Keltner bands`

**Входи:** H;L;C

**Гіпотеза механізму:** Гіпотеза переходу до розширення.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Дві оцінки волатильності, а не дві незалежні причини руху.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M042 · Choppiness Index

**Канонічне поле:** `choppiness` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `100*log10(sum(TR)/(HH-LL))/log10(n)`

**Входи:** H;L;C

**Гіпотеза механізму:** Шумність шляху відносно range.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не прогнозує напрям наступного виходу.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Chop — library specification](https://python.stockindicators.dev/indicators/Chop/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M043 · Ulcer Index

**Канонічне поле:** `ulcer_index` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sqrt(mean(drawdown_from_trailing_high^2))`

**Входи:** C

**Гіпотеза механізму:** Тривалість і глибина падіння як стан ризику.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Безпосередньо залежить від вже минулого drawdown.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [UlcerIndex — library specification](https://python.stockindicators.dev/indicators/UlcerIndex/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M044 · Current drawdown

**Канонічне поле:** `drawdown` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `C/running_max(C)-1`

**Входи:** C

**Гіпотеза механізму:** Дистанція від історичного максимуму.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Рівень -x% не гарантує дна.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M045 · Downside semivolatility

**Канонічне поле:** `downside_vol` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sqrt(mean(min(r,0)^2)*365)`

**Входи:** C

**Гіпотеза механізму:** Асиметричний негативний ризик.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не замінює повний stress test.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.

## M046 · Return skewness

**Канонічне поле:** `return_skewness` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `trailing sample skewness(r)`

**Входи:** C

**Гіпотеза механізму:** Асиметрія хвостів як гіпотеза режиму.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Дуже нестійка на коротких вікнах; оцінювати uncertainty.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volatility · **Перевірка визначення:** research_candidate

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.
