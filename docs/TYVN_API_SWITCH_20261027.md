# TYVN/USDT — перемикання лише API-контейнера на Hetzner (27.10.2026, 13:00 UTC)

Доповнює `docs/TYVN_RELEASE_20261027.md` з гілки PR #578. **Нічого з цього не виконано на сервері.**
Production не змінено; TYVN не опубліковано; таймер вимкнений; баланси, БД, AITH, NRX і Worker не зачіпались.

## Що вже перевірено без доступу до сервера (22.10.2026, ~13:30 UTC)

| Перевірка | Результат |
|---|---|
| Кандидат API | PR #578, `release/tyvn-api-isolated-20261022`, HEAD `6f082a98d0c97c28215e6c5c8056b786d6fa6c99`, база `2e7acf158000404133db85723bac13695215e25c` |
| GitHub Actions на точному HEAD | 11 workflow runs **success** (у т.ч. isolated backend QA #39783837579: 7 suites / 97 tests; Admin Listings browser #39783847313; Worker verify + live-smoke #39783847346, job `deploy` — skipped, як і має бути). Жодного failed / pending. |
| Публічний `/health` | `https://api.voltextech.net/health` → `status: ok`, `commit: 2e7acf158000404133db85723bac13695215e25c`, `startedAt: 2026-10-16T10:45:32.377Z` — збігається з очікуваною базою |
| Без входу `GET /api/v1/admin/listings` | 401 (так і має лишитися після перемикання) |
| Публічні лістинги `market.voltextech.net/market/listings` | лише `AITH/USDT`; TYVN відсутній |
| Залежності/БД/запуск | `git diff 2e7acf1 6f082a98 -- package.json package-lock.json prisma scripts/start-render-single-service.cjs render.yaml` — **порожній** |
| Архів джерел | `git archive --format=tar 6f082a98 src tsconfig.json scripts/tyvn-hetzner.Dockerfile` → 604 файли `src`, `tsconfig.json`, Dockerfile; без `.env`/ключів; SHA-256 `b6bd0e9bc20fbabd709b7c5096124e6c132fc17252685cedc75c1169cbf63555` (git 2.43.0; інша версія git може дати інший хеш тар-файлу — тоді звіряти `git get-tar-commit-id` = `6f082a98…`) |
| Збірка образу | рецепт перекладає лише `src` → `dist`; файлів у `src` не видалено відносно `2e7acf1`, тож накладання `COPY src` не лишає старих модулів; `prisma generate` не потрібен (схема не змінена). TypeScript у живому образі є з KYC-релізу (той самий рецепт `node node_modules/typescript/bin/tsc` спрацював 16.10) — **на сервері це перевіряє сама збірка**. |

## Що потребує доступу до консолі Hetzner (виконує власник)

У мене немає SSH/консолі Hetzner, ключів чи Docker-сервера production. Кроки 1–4 — лише читання;
крок 5 створює **неактивний** образ; крок 6 пише один файл overlay і перевіряє його. Перемикання (крок 7) —
**тільки після окремого дозволу власника**.

```sh
cd /opt/voltex-precutover
RELEASE_SHA=6f082a98d0c97c28215e6c5c8056b786d6fa6c99
KIT=/path/to/checkout/scripts   # чекаут цієї гілки: tyvn-api-switch.py (в образ не потрапляє)
```

1. **Preflight (read-only):** `bash scripts/tyvn-hetzner-preflight.sh` з гілки #578. Має закінчитися `PASS`
   (один `api-production`, public і local SHA = `2e7acf1`, ≥5 GiB вільно, `pg_isready`, активний `voltex-pg-backup.timer`).
2. **Живий образ і rollback:**
   ```sh
   LIVE_IMAGE="$(docker inspect "$(docker ps -q --filter label=com.docker.compose.service=api-production)" --format '{{.Image}}')"
   echo "$LIVE_IMAGE"   # записати: це образ для rollback
   docker image inspect "$LIVE_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'   # очікується 2e7acf1…
   ```
3. **Резервна копія:** свіжий знімок наявною службою `voltex-pg-backup` і **реальне відновлення в ізольований PostgreSQL**
   за `docs/KYC_RELEASE_RUNBOOK.md` (розшифрування лише на машині власника, повний `pg_restore --exit-on-error`,
   звірка таблиць/рядків). Production БД не відновлювати, міграцій не робити — TYVN їх не потребує.
4. Будь-яка розбіжність SHA, образу, Compose, бекапу чи місця — **СТОП**.
5. **Неактивний образ** (мережа вимкнена, нічого не запускається):
   ```sh
   mkdir "releases/tyvn-$RELEASE_SHA" && cd "releases/tyvn-$RELEASE_SHA"
   tar -xf /path/to/tyvn-api-source.tar          # архів з точного 6f082a98, звірити git get-tar-commit-id
   docker build --network none --pull=false --build-arg LIVE_IMAGE="$LIVE_IMAGE" \
     --build-arg RELEASE_COMMIT="$RELEASE_SHA" -f scripts/tyvn-hetzner.Dockerfile -t "voltex-tyvn:$RELEASE_SHA" .
   NEW_IMAGE="$(docker image inspect "voltex-tyvn:$RELEASE_SHA" --format '{{.Id}}')"; echo "$NEW_IMAGE"
   docker run --rm --network none --entrypoint grep "$NEW_IMAGE" -c countdown /app/dist/services/listings/store.js   # >0: новий код у dist
   cd /opt/voltex-precutover
   ```
   Якщо `tsc` відсутній або збірка падає — **СТОП**, нічого не доінстальовувати в production.
6. **Overlay лише для API і його перевірка** (скрипт з цієї гілки, `scripts/tyvn-api-switch.py`, лише читання):
   ```sh
   python3 "$KIT/tyvn-api-switch.py" overlay --release-dir "releases/tyvn-$RELEASE_SHA" --image "$NEW_IMAGE" --sha "$RELEASE_SHA"
   python3 "$KIT/tyvn-api-switch.py" check --overlay "releases/tyvn-$RELEASE_SHA/compose.tyvn-api.yaml" --sha "$RELEASE_SHA" --profile cutover
   ```
   `check` сам бере з етикеток контейнера проєкт, каталог, усі Compose-файли й env-файли, рендерить конфіг
   у пам'яті двічі й друкує **лише шляхи ключів**, що змінились. Має бути рівно
   `services.api-production.image` і `services.api-production.environment.VOLTEX_RELEASE_SHA`;
   новий образ — з revision/`VOLTEX_RELEASE_SHA` = `6f082a98…`; старий образ існує, і старий конфіг вказує саме на нього.
   Тоді друкує `READY TO SWITCH` і точні команди switch/rollback. Інакше — `BLOCKED` (exit 2).
7. **Перемикання — лише після окремого дозволу власника:** виконати надруковану команду `switch`
   (`up -d --no-deps --no-build --pull never api-production` — лише API, без перезапуску БД чи інших сервісів).
8. **Після перемикання:** `curl -fsS https://api.voltextech.net/health` і `curl -fsS http://127.0.0.1:13020/health` →
   `commit: 6f082a98…`; `GET /api/v1/admin/listings` без входу → 401; адмінка Listings / Preview під власником — лише читання;
   публічні свічки AITH і NRX без змін; smoke Spot/Futures/Wallet. Жодних реальних ордерів чи зарахувань.
9. **Rollback** (якщо будь-що не так): надрукована команда `rollback` → `/health` знову `2e7acf1`. БД не відновлювати,
   Worker не чіпати.

## Після API (кожен крок — окремий дозвіл власника)

Створити TYVN **Draft** з `config/test-markets/tyvn.draft.json` (seed `teryvane-20261026-v1`, 0.0250 USDT,
27.10.2026 13:00 UTC = 15:00 Київ = 16:00 Москва, `tradable:false`) → перевірити приватний preview → опублікувати
**staged** (таймер не стартує) → окремо **Start Timer** до 13:00 UTC. Деталі — `docs/TYVN_RELEASE_20261027.md`.

## Стан

| Етап | Стан |
|---|---|
| GitHub Actions #578 на `6f082a98` | ✅ зелені |
| Архів джерел з `6f082a98` + перевірка залежностей | ✅ підготовлено (локально) |
| Інструмент перемикання лише API + самоперевірка | ✅ підготовлено |
| Preflight на сервері, образ для rollback, бекап з відновленням | ⛔ BLOCKED — потрібен доступ до консолі Hetzner |
| Неактивний образ, його ID | ⛔ BLOCKED — збирається лише на сервері з живого образу |
| Перемикання API | ⛔ не виконувати без дозволу власника і перевіреного rollback |
| TYVN Draft / staged publish / таймер | ⛔ кожен — окремий дозвіл власника |
