# Математичні зв’язки: не рахувати те саме декілька разів
Це власні алгебраїчні виведення з явно заданих визначень, не результати backtest.

## MVRV, realized price, NUPL
При P>0, S>0, RC>0 та MC=P*S:
1. RP=RC/S.
2. MVRV=MC/RC=P/RP.
3. NUPL=(MC-RC)/MC=1-RC/MC=1-1/MVRV.
За MC/RC>0 останнє перетворення строго монотонне. При тих самих датах і відсутності додаткових adjustments ранги MVRV та NUPL однакові; нової незалежної інформації немає. Для cohort або entity-adjusted визначень перевірити однакові universes, перш ніж застосувати тотожність.

## Stochastic і Williams %R
Для того самого n, того самого C, HH та LL, HH>LL:
K=100*(C-LL)/(HH-LL).
W=-100*(HH-C)/(HH-LL)=K-100.
Smoothed %D або інші windows вже не точні дублікати raw K, але сімейство залишається спільним.

## SMA distance і Mayer Multiple
d=C/SMA_200(C)-1. Mayer=C/SMA_200(C)=d+1. Порівняння рівнів може бути різним лише через обрані thresholds, не нові дані.

## Stock vs flow
Delta(TVL)=sum(p_t*q_t-p_prev*q_prev)
=sum(p_t*(q_t-q_prev))+sum(q_prev*(p_t-p_prev)).
Перша частина — quantity change за поточними цінами, друга — revaluation. Delta TVL не чистий inflow. Аналогічна проблема у USD OI та market cap stablecoin при depeg.

## Nested fee accounting
Якщо tokenholder revenue є частиною protocol revenue, а protocol revenue — частиною fees, сума трьох є подвійним/потрійним обліком. Різниці або частки — похідні, не новий незалежний грошовий потік.

## Дати derived metrics
Для X_t=f(A_t,B_t), допустима доступність не раніше max(available_at(A_t),available_at(B_t)). Це необхідна умова, але не достатня без контролю revisions і intraday cutoff.
