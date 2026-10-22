# Матриця перевірки — ru / шрифти: local / chromium

Після: 2026-10-10T10:32:22.538Z → 2026-10-10T10:50:23.414Z, 1140 знімків стану. До: 2026-10-09T19:12:04.785Z, 1104 знімків.
Запити на запис із браузера, відхилені fixture-сервером: 0. Невідомі fixture-ендпоінти: GET /market/assets, GET /analytics/overview.

Комірка: ✅ — без виміряних дефектів; ❌ — що саме знайдено (page overflow = горизонтальна прокрутка сторінки; spill = блок за краєм екрана; clip = обрізаний текст без «…»; overlap = накладання текстових рядків; covered@end = кнопка накрита шаром наприкінці сторінки); — = стан не існує на цій ширині; «не проверено» = крок до цього стану не виконався (елемент не знайдено) або знімок не вдався; стрілка «до→після» показує зміну відносно базової збірки. Відфільтровано як шум: нижня панель навігації, кнопка підтримки, кнопка «Аналитика» й біжучий рядок котирувань над вмістом на межі екрана; липкі шапка/смужка вкладок/панель над серединою сторінки у положенні «кінець сторінки» (сторінка прокручується далі; плаваюча кнопка під панеллю, навпаки, рахується); тости «Не удалось…»; текст під відкритим меню/чатом підтримки/діалогом (шар поверх сторінки), крім накладань усередині того самого шару; кнопки-упори повзунка над його доріжкою; текст сторінки під липкою шапкою/смужкою вкладок (вони непрозорі).

| маршрут | стан | 320x568 | 320x740 | 360x800 | 375x812 | 390x844 | 412x915 | 430x932 | 844x390 | 768x1024 | 1366x768 | 1440x900 | 1920x1080 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| / | initial | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| / | menu | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /login | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /login | filled | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /login | text200 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /register | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /register | filled | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /register | text200 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /legal/terms | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy | menu | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy/learn | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy/faq | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy/faq | open-first | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /academy/glossary | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /help/fees | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /markets | initial | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×2, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×8, covered@end ×1 → ✅ | ❌ clip ×12, covered@end ×1 → ✅ | ✅ | ✅ | ✅ |
| /markets | menu | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×2, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×8, covered@end ×1 → ✅ | ❌ clip ×12, covered@end ×1 → ✅ | ✅ | ✅ | ✅ |
| /markets | search | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×2, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×8, covered@end ×1 → ✅ | ❌ clip ×12, covered@end ×1 → ✅ | ✅ | ✅ | ✅ |
| /markets | keyboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /markets | support | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×8, covered@end ×1 → ✅ | ❌ clip ×12, covered@end ×1 → ✅ | ✅ | ✅ | ✅ |
| /markets?view=analytics | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /trade?pair=BTC%2FUSDT | initial | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×2 | ❌ overlap ×2 | ✅ |
| /trade?pair=BTC%2FUSDT | trade | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | trade-sell-limit | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×2 | ❌ overlap ×2 | ✅ |
| /trade?pair=BTC%2FUSDT | keyboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | chart | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | book | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | markets | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | account | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=BTC%2FUSDT | history | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×2 | ❌ overlap ×2 | ✅ |
| /trade?pair=BTC%2FUSDT | assets | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×2 | ❌ overlap ×2 | ✅ |
| /trade?pair=BTC%2FUSDT | deposit | ❌ clip ×1, overlap ×5, covered@end ×6 → ✅ | ❌ clip ×1, overlap ×4 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×3 → ✅ | ❌ overlap ×3 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×4, covered@end ×12 → ✅ | ❌ overlap ×6, covered@end ×36 → ✅ | ❌ overlap ×10 → ✅ | ❌ overlap ×2 → ✅ | ✅ |
| /trade?pair=BTC%2FUSDT | text200 | ❌ page overflow +49px, spill ×1, clip ×6, overlap ×3 → ✅ | ❌ page overflow +49px, spill ×1, clip ×6, overlap ×3 → ✅ | ❌ page overflow +32px, spill ×1, clip ×6, overlap ×1 → ✅ | ❌ page overflow +24px, spill ×1, clip ×6, overlap ×1 → ✅ | ❌ page overflow +15px, spill ×1, clip ×6, overlap ×1 → ✅ | ❌ clip ×6, overlap ×1 → ✅ | ❌ clip ×6, overlap ×1 → ✅ | ❌ clip ×2 → ✅ | — | — | — | — |
| /trade?pair=PEPE%2FUSDT | initial | ✅ | ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×2 | ❌ overlap ×2 | ✅ |
| /trade?pair=PEPE%2FUSDT | trade | ✅ | ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?pair=VTA%2FUSDT | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /trade?pair=VTA%2FUSDT | trade | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?market=cfd | initial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×4 | ❌ clip ×4 | ❌ clip ×4 |
| /trade?market=cfd | trade | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /trade?market=cfd | markets | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | — | — | — | — |
| /trade?market=cfd | account | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×28, overlap ×4 | ❌ clip ×28, overlap ×1 | ❌ clip ×28 |
| /futures | trade-limit | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×28, overlap ×4 | ❌ clip ×28, overlap ×1 | ❌ clip ×28 |
| /futures | keyboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | chart | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | book | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | stats | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | positions | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /futures | tpsl-dialog | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17, overlap ×4 | ❌ clip ×17, overlap ×1 | ❌ clip ×17 |
| /futures | orders | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | position-history | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | order-history | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | assets | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | close-dialog | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | close-market-confirm | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1 → ✅ | ❌ clip ×17, overlap ×2 | ❌ clip ×17, overlap ×1 | ❌ clip ×17 |
| /futures | markets-dialog | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ clip ×30, overlap ×2 | ❌ clip ×30, overlap ×1 | ❌ clip ×30 |
| /futures | calculator | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ overlap ×1, covered@end ×1 → ✅ | ❌ overlap ×1, covered@end ×1 → ✅ | ✅ | ❌ overlap ×2, covered@end ×2 → ✅ | ❌ clip ×17 | ❌ clip ×17 | ❌ clip ×17 |
| /futures | text200 | ❌ overlap ×1 | ❌ overlap ×1 | ❌ overlap ×1 | ❌ page overflow +45px, spill ×8, clip ×10, overlap ×13 → ✅ | ❌ page overflow +36px, spill ×8, clip ×11, overlap ×13 → ✅ | ❌ page overflow +23px, spill ×7, clip ×10, overlap ×12 → ✅ | ❌ page overflow +13px, spill ×4, clip ×10, overlap ×11 → ✅ | ❌ clip ×2, overlap ×6 → ✅ | — | — | — | — |
| /wallet | initial | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×4, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | funding | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | unified | ❌ clip ×2, overlap ×1 → ✅ | ❌ clip ×2, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | pnl | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | orders | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | deposit | ❌ clip ×4, overlap ×1, covered@end ×6 → ✅ | ❌ clip ×4, overlap ×1, covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×9 → ✅ | ❌ overlap ×1, covered@end ×7 → ✅ | ❌ overlap ×2, covered@end ×14 → ✅ | ❌ covered@end ×22 → ✅ | ❌ covered@end ×25 → ✅ | ❌ covered@end ×40 → ✅ |
| /wallet | withdraw | ❌ clip ×4, overlap ×1, covered@end ×6 → ✅ | ❌ clip ×4, overlap ×1, covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×9 → ✅ | ❌ covered@end ×7 → ✅ | ❌ overlap ×1, covered@end ×14 → ✅ | ❌ covered@end ×22 → ✅ | ❌ covered@end ×27 → ✅ | ❌ covered@end ×40 → ✅ |
| /wallet | withdraw-filled | ❌ clip ×4, overlap ×1, covered@end ×6 → ✅ | ❌ clip ×4, overlap ×1, covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×5 → ✅ | ❌ covered@end ×9 → ✅ | ❌ overlap ×1, covered@end ×7 → ✅ | ❌ covered@end ×14 → ✅ | ❌ covered@end ×22 → ✅ | ❌ covered@end ×24 → ✅ | ❌ covered@end ×40 → ✅ |
| /wallet | keyboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| /wallet | transfer | ❌ clip ×4, overlap ×1, covered@end ×7 → ✅ | ❌ clip ×4, overlap ×1, covered@end ×9 → ✅ | ❌ covered@end ×9 → ✅ | ❌ covered@end ×9 → ✅ | ❌ covered@end ×9 → ✅ | ❌ covered@end ×8 → ✅ | ❌ covered@end ×12 → ✅ | ❌ overlap ×1, covered@end ×7 → ✅ | ❌ overlap ×1, covered@end ×14 → ✅ | ❌ covered@end ×24 → ✅ | ❌ covered@end ×27 → ✅ | ❌ covered@end ×40 → ✅ |
| /wallet | text200 | ❌ clip ×21, overlap ×2, covered@end ×5 → ✅ | ❌ clip ×21, overlap ×2, covered@end ×5 → ✅ | ❌ clip ×17, overlap ×2, covered@end ×5 → ✅ | ❌ clip ×16, overlap ×1, covered@end ×5 → ✅ | ❌ clip ×15, overlap ×1, covered@end ×5 → ✅ | ❌ clip ×9, overlap ×1, covered@end ×5 → ✅ | ❌ clip ×9, overlap ×1, covered@end ×5 → ✅ | ❌ clip ×4, overlap ×1, covered@end ×6 → ✅ | — | — | — | — |
| /banking | initial | ❌ page overflow +152px, spill ×6, overlap ×1 → ✅ | ❌ page overflow +152px, spill ×6, overlap ×1 → ✅ | ❌ page overflow +112px, spill ×6 → ✅ | ❌ page overflow +97px, spill ×6 → ✅ | ❌ page overflow +83px, spill ×6 → ✅ | ❌ page overflow +60px, spill ×6 → ✅ | ❌ page overflow +42px, spill ×6 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /banking | calculate | ❌ page overflow +152px, spill ×6, overlap ×1 → ✅ | ❌ page overflow +152px, spill ×6, overlap ×1 → ✅ | ❌ page overflow +112px, spill ×6 → ✅ | ❌ page overflow +97px, spill ×6 → ✅ | ❌ page overflow +83px, spill ×6 → ✅ | ❌ page overflow +60px, spill ×6 → ✅ | ❌ page overflow +42px, spill ×6 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /banking | place-dialog | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ |
| /copy-trading | initial | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /copy-trading | profile | ❌ clip ×1, overlap ×1 → ✅ | ❌ clip ×1, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /copy-trading | profile-trades | ❌ clip ×1, overlap ×1 → ✅ | ❌ clip ×1, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /otc | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /otc | form | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /otc | filled | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /arbitrage | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /arbitrage | dialog | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ⚠️ не проверено → ✅ | ✅ | ✅ | ✅ |
| /arbitrage | strategy | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /tools | initial | ❌ overlap ×13, covered@end ×1 → ✅ | ❌ overlap ×13, covered@end ×3 → ✅ | ❌ overlap ×10, covered@end ×2 → ✅ | ❌ overlap ×10, covered@end ×2 → ✅ | ❌ overlap ×10, covered@end ×2 → ✅ | ❌ overlap ×10, covered@end ×3 → ✅ | ❌ overlap ×8, covered@end ×3 → ✅ | ❌ overlap ×5 → ✅ | ❌ overlap ×5, covered@end ×6 → ✅ | ❌ overlap ×5, covered@end ×4 → ✅ | ❌ overlap ×5, covered@end ×4 → ✅ | ❌ overlap ×3, covered@end ×4 → ✅ |
| /trading-bots | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /trading-bots | bot | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /card | initial | ❌ page overflow +19px, spill ×4, clip ×3, overlap ×3 → ✅ | ❌ page overflow +19px, spill ×4, clip ×3, overlap ×3 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×2 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ |
| /settings | initial | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /settings | security | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /settings | verification | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /settings | api | ❌ clip ×1, overlap ×1 → ✅ | ❌ clip ×1, overlap ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /settings | referral | ❌ overlap ×1 → ✅ | ❌ overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | initial | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×4, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | open | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | specialist | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×4, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /wallet | specialist-filled | ❌ clip ×4, overlap ×1 → ✅ | ❌ clip ×4, overlap ×1 → ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Підсумок після: ✅ 999, ❌ 49, — 92, не перевірено 0. Виправлено комірок: 275; регресій (було ✅, стало ❌): 0.

## Залишкові виміряні сигнали після правок

- /trade?pair=BTC%2FUSDT · initial: overlap ×2 (1366x768, 1440x900)
- /trade?pair=BTC%2FUSDT · trade-sell-limit: overlap ×2 (1366x768, 1440x900)
- /trade?pair=BTC%2FUSDT · history: overlap ×2 (1366x768, 1440x900)
- /trade?pair=BTC%2FUSDT · assets: overlap ×2 (1366x768, 1440x900)
- /trade?pair=PEPE%2FUSDT · initial: overlap ×2 (1366x768, 1440x900)
- /trade?market=cfd · initial: clip ×4 (1366x768, 1440x900, 1920x1080)
- /futures · initial: clip ×28 (1366x768, 1440x900, 1920x1080)
- /futures · initial: overlap ×4 (1366x768)
- /futures · initial: overlap ×1 (1440x900)
- /futures · trade-limit: clip ×28 (1366x768, 1440x900, 1920x1080)
- /futures · trade-limit: overlap ×4 (1366x768)
- /futures · trade-limit: overlap ×1 (1440x900)
- /futures · tpsl-dialog: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · tpsl-dialog: overlap ×4 (1366x768)
- /futures · tpsl-dialog: overlap ×1 (1440x900)
- /futures · orders: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · position-history: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · order-history: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · assets: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · close-dialog: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · close-market-confirm: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · close-market-confirm: overlap ×2 (1366x768)
- /futures · close-market-confirm: overlap ×1 (1440x900)
- /futures · markets-dialog: clip ×30 (1366x768, 1440x900, 1920x1080)
- /futures · markets-dialog: overlap ×2 (1366x768)
- /futures · markets-dialog: overlap ×1 (1440x900)
- /futures · calculator: clip ×17 (1366x768, 1440x900, 1920x1080)
- /futures · text200: overlap ×1 (320x568, 320x740, 360x800)

## Розподіл комірок ❌

- стан «200% тексту» (телефони): 3
- десктоп 1366/1440/1920: 46
- стан з відкритою клавіатурою: 0
- інше (телефон/планшет/ландшафт): 0

## Відкрита клавіатура (вьюпорт зменшено до 55% висоти, поле у фокусі)

| маршрут | екран | видима область | поле вводу | кнопка підтвердження |
|---|---|---|---|---|
| /markets | 320x568 | 320×312 | поле видно, не накрите | — |
| /markets | 320x740 | 320×407 | поле видно, не накрите | — |
| /markets | 360x800 | 360×440 | поле видно, не накрите | — |
| /markets | 375x812 | 375×447 | поле видно, не накрите | — |
| /markets | 390x844 | 390×464 | поле видно, не накрите | — |
| /markets | 412x915 | 412×503 | поле видно, не накрите | — |
| /markets | 430x932 | 430×513 | поле видно, не накрите | — |
| /markets | 844x390 | 844×215 | поле видно, не накрите | — |
| /trade?pair=BTC%2FUSDT | 320x568 | 320×312 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 320x740 | 320×407 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 360x800 | 360×440 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 375x812 | 375×447 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 390x844 | 390×464 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 412x915 | 412×503 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 430x932 | 430×513 | поле видно, не накрите | кнопка досяжна |
| /trade?pair=BTC%2FUSDT | 844x390 | 844×215 | поле видно, не накрите | кнопка досяжна |
| /futures | 320x568 | 320×312 | поле видно, не накрите | кнопка досяжна |
| /futures | 320x740 | 320×407 | поле видно, не накрите | кнопка досяжна |
| /futures | 360x800 | 360×440 | поле видно, не накрите | кнопка досяжна |
| /futures | 375x812 | 375×447 | поле видно, не накрите | кнопка досяжна |
| /futures | 390x844 | 390×464 | поле видно, не накрите | кнопка досяжна |
| /futures | 412x915 | 412×503 | поле видно, не накрите | кнопка досяжна |
| /futures | 430x932 | 430×513 | поле видно, не накрите | кнопка досяжна |
| /futures | 844x390 | 844×215 | поле видно, не накрите | кнопка досяжна |
| /wallet | 320x568 | 320×312 | поле видно, не накрите | кнопка досяжна |
| /wallet | 320x740 | 320×407 | поле видно, не накрите | кнопка досяжна |
| /wallet | 360x800 | 360×440 | поле видно, не накрите | кнопка досяжна |
| /wallet | 375x812 | 375×447 | поле видно, не накрите | кнопка досяжна |
| /wallet | 390x844 | 390×464 | поле видно, не накрите | кнопка досяжна |
| /wallet | 412x915 | 412×503 | поле видно, не накрите | кнопка досяжна |
| /wallet | 430x932 | 430×513 | поле видно, не накрите | кнопка досяжна |
| /wallet | 844x390 | 844×215 | поле видно, не накрите | кнопка досяжна |
