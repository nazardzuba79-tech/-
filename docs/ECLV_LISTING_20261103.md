# ECLAVO (ECLV/USDT) — proposed 3 Nov 2026 listing

This is a **candidate config and QA**, NOT a published listing, chain token, venue order, or investor price forecast. Nothing here creates a live Admin Listings row or starts a countdown. Production TYVN/AITH/NRX, Spot/Futures, databases, balances and permissions are unchanged.

## Candidate

| Field | Value | Note |
| --- | --- | --- |
| Name / ticker / pair | **ECLAVO** / `ECLV` / `ECLV/USDT` | Provisional identity: confirm uniqueness again on the live Admin Listings before creating it. |
| Listing | `2026-11-03T13:00:00Z` | Tuesday 13:00 UTC = **15:00 Kyiv** (UTC+2, winter) = 16:00 Moscow. The owner gave the date; 13:00 UTC mirrors TYVN and is still a proposal. |
| Display zone | `Europe/Kyiv` | The exchange prints «03.11.2026 · 15:00 Europe/Kyiv · 13:00 UTC» (the existing format for Kyiv; TYVN, entered in Moscow, prints «… — 13:00 UTC / 16:00 МСК»). Display only: the instant does not depend on it. |
| Initial price | `0.0140` USDT | The exchange shows «0.014000 USDT». |
| Trading / allocation | `tradable: false`, `ownerAllocation: "0"` | A non-executable demo scenario: the Spot gate refuses every order before and after the opening; nothing is credited. |
| Seed | `eclavo-20261103-v1`, **manual** | Entered once; never regenerated (see «No duplicates, no new seed»). |
| Logo | `config/test-markets/eclv-20261103.logo.svg` (998 B) | Byte-identical to the data URL in the JSON, so uploading the file in the form gives the same configuration. |

## Price path (synthetic `scenario-controls-v2`, DEEP_RECOVERY)

This is a designed synthetic trajectory; it is **not historical BTC/ETH data** and not a forecast.

| Phase | Duration | Price at the end (exact) |
| --- | ---: | ---: |
| Opening | 0 h | 0.0140 |
| Growth | 24 h | **0.1092** (+680 %) |
| Range | 24 h | 0.1092 |
| Growth | 96 h | 0.315 |
| Pullback | 36 h | 0.2142 |
| Recovery | 72 h | 0.435 |
| After 252 h | range | every price and wick ≤ 0.518 |

- First 24 h: `0.0140 × (1 + 680/100) = 0.1092`. Verified on the simulation and on the exchange page at 13:00 UTC on 4 Nov: last price 0.1092, «24ч» +680.00 %.
- **0.518 is a ceiling, not a target.** `0.0140 × (1 + 3600/100) = 0.518`; no tick, candle or wick passes it (every 1 m candle of 31 days checked). The highest price actually reached in those 31 days is **≈ 0.4528** (about +3134 %, on day 21). After hour 252 the market ranges between ≈ 0.33 and ≈ 0.45, wicks included.
- Fine settings: pullbacks often, 5–15 %, 70 min; candles high intensity, size diversity 0.85, moderate pauses; pronounced wicks, long wicks often.
- **What the chart really does inside each growth stage (owner decision).** DEEP_RECOVERY gives every growth/recovery stage a deep fall before the stage target. On day one the price rises to ≈ 0.073 by about 23:00 UTC, falls to ≈ 0.0244 by about 04:15 UTC (**−66.7 % from that peak**), then climbs to 0.1092 at 13:00 UTC. The day-one range is 0.0115–0.1186, and the first ~2 h dip to −17.9 % below the opening price. TYVN's deepest day-one fall is −22.6 % for comparison. The 5–15 % setting only adds smaller dips on top. If this is not wanted, choose another scenario before creating the draft. After publication the scenario is locked.
- The chart does not depend on which creation number production assigns (simulation profile): identical candles for every ordinal (tested).

## Logo

Silver/cobalt eclipse «E» in a ring, SVG 128×128. Checked at 256/128/84/64/48/32/24/20/16 px on dark and light grounds, and in place: pre-listing card 64 px, Spot rail 20 px, ticker bar 24 px, Markets row. The «E» stays readable at 20/24 px. Cosmetic only: at large sizes the dark outline of the «E» slightly overlaps the inner ring at its top-right and bottom-right corners. Owner approval of the artwork is still required.

## Import through Admin Listings

Both paths were run on a local Worker and stored **the same draft**, equal to `config/test-markets/eclv-20261103.draft.json`. The store adds only its creation profile and wick model.

**A. The form (as for TYVN).** Admin → Listings → «Создать листинг», in this order:

1. «Название» `ECLAVO`, «Тикер» `ECLV`, «Начальная цена, USDT» `0.0140`, «Количество токенов для владельца» `0`.
2. «Часовой пояс» «Киев», «Дата и время листинга» **03.11.2026 15:00**. The line under it must read «= 03.11.2026 13:00 Всемирное время (UTC) · 15:00 Киев (UTC+2) · 16:00 Москва (UTC+3)».
3. «Код варианта» → «Вручную» → `eclavo-20261103-v1`.
4. «Логотип» → «Выбрать файл» → `eclv-20261103.logo.svg`.
5. «Сценарий движения» → «Глубокий откат и восстановление». It presets the fine settings, which step 9 then replaces.
6. «Рост за первые 24 часа, %» `680` (the 24 h price shows 0,1092); «Максимальная цена, USDT» `0.518`.
7. «Этапы движения»: «Добавить этап» until there are 5, then type / hours / target:
   - Рост 24 / 0.1092
   - Боковик 24 / 0.1092
   - Рост 96 / 0.315
   - Откат 36 / 0.2142
   - Восстановление 72 / 0.435

   Units stay in «часов».
8. «Поведение после всех этапов»: «Боковик без дальнейшего направленного роста».
9. «Точная настройка свечей»:
   - откаты «Часто», 70 мин, 5 %, 15 %;
   - сила колебаний «Высокая», разнообразие **85 %**, паузы «Умеренно»;
   - тени «Выраженные», длинные тени «Часто».
10. «Спотовая торговля после листинга» stays off (locked for a demo scenario). Then «Сохранить черновик» → «Предпросмотр». The first 24 h must start at 0.014 and end at 0.1092; maximum 0,518 USDT.

**B. The JSON (exact, no typing).** `POST /api/v1/admin/listings` with body `{"config": <the file without schemaVersion>}`, from an admin session. It is the same call the form makes.

**No duplicates, no new seed** (enforced by the store, verified):
- A second ECLV is refused **409 `DUPLICATE_TICKER`**, whether the seed is manual, automatic or different. One ECLV row exists, whatever is pressed twice.
- The manual seed is stored as entered. Later saves keep it and the profile. A save from a stale page is 409 (`revision_conflict`).
- After publication the ticker, seed, initial price and movement are locked (`HISTORY_LOCKED`). The preview of the saved draft is exactly what the exchange will show.
- Before step A/B, open Admin → Listings and confirm there is no ECLV row (and no old ZRNTH draft) already. If an ECLV draft exists, edit that one instead of creating another.

## Publication path (each step needs the owner's separate go)

1. Owner approves name/ticker, 13:00 UTC, the price path (including the day-one −66.7 % fall) and the logo.
2. Admin → Listings: confirm no ECLV/ZRNTH row; TYVN untouched.
3. Create the draft (A or B), «Предпросмотр»: first 24 h 0.014 → 0.1092, «Рост» horizon up to 0.435, nothing above 0.518.
4. «Опубликовать» with «Запустить таймер сразу после публикации» **unticked** → the row reads «Таймер не запущен»; the exchange shows nothing; Render knows the ticker, every order is refused.
5. Only on the owner's command: «Запустить таймер» → within seconds the exchange shows the ECLAVO card, the countdown, «03.11.2026 · 15:00 Europe/Kyiv · 13:00 UTC», «0.014000 USDT»; Markets and the Spot rail list ECLV/USDT. Before the instant, «Приостановить» / «Остановить и скрыть» hide it, and the date does not change.
6. At 13:00:00 UTC on 3 Nov the chart replaces the countdown by the server clock. No scheduler, deploy or restart. Watch the real transition; do not claim it before the date.

## Local QA (disposable, no production)

- `npx jest --runTestsByPath src/services/listings/__tests__/eclvDraft.test.ts`: values, logo file = data URL, every value enterable in the form (diversity on the 0.05 slider step), the program and exact boundaries, profile-independent candles, 12 days of 5 m candles ≤ 0.518, publish/timer rules.
- `VITE_MARKET_EDGE_URL=http://127.0.0.1:8787 npx vite build --outDir <dir>` (in `frontend/`), then `QA_FRONTEND_DIST=<dir> node scripts/qa-listing-eclv.cjs`. It runs the real Worker in workerd, this checkout's admin router and the production bundle in Chromium: form and API import, duplicates/seed, preview, a staged publish and timer start **on the local Worker only**, the exchange card at 1440/390, Spot search and the 20/24 px logo, Markets, and the chart 30 min / 24 h / 7 days after the opening. The after-opening chart is computed by the Worker's own response code at a simulated server time, without moving any clock. Output: PNG + `report.json`. It publishes before the date, so it only makes sense before 3 Nov 2026.
- CI: `.github/workflows/eclv-listing-draft.yml` runs both on Draft and ready PRs.

**Separate integration constraints:** Demo Spot #596 and Demo Liquidity #599 are merged code-only with every flag off. This listing has no link to them or to any balance. Never claim a synthetic plot represents a real asset or live third-party trading.
