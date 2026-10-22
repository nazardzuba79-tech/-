# VOLTEX — одноразове серверне впровадження API лістингів (TYVN, 27.10.2026)

**Для кого:** сесія Claude Code, що працює **на комп'ютері власника**, з якого вже є авторизований SSH-доступ
до сервера Hetzner. Саме з такої «машини оператора» Codex 16.10.2026 робив KYC-preflight і тест відновлення
бекапу (ключ розшифрування бекапу лежить там і нікуди не копіюється), і так само того дня був розгорнутий
нинішній API `2e7acf1`. Хмарна сесія Claude цього зробити не може: її мережа пропускає лише HTTPS (порт 22 закритий).

**Власник не вводить жодних команд** — ні в Hetzner Console, ні в терміналі. Усе виконує сесія Claude.
Власник відповідає лише на окремі короткі запитання-погодження в інтерфейсі Claude (див. «Погодження»).

Після цього одного оновлення API всі наступні лістинги створюються в **Адмінка → Листинги** без коду,
GitHub, Hetzner і Claude (це вже перевірено в CI: 20 лістингів без жодного рядка коду — run 39824765013).

## Незмінні вхідні дані

| Що | Значення |
|---|---|
| Репозиторій | `nazardzuba79-tech/-` |
| Живий API (база, rollback) | `2e7acf158000404133db85723bac13695215e25c` |
| Новий API (кандидат, PR #578) | `6f082a98d0c97c28215e6c5c8056b786d6fa6c99` (у `main` **не зливати**) |
| Архів джерел | Actions run 39801126275, artifact 12434259743 (до 05.11.2026): `tyvn-api-source.tar`, SHA-256 `b6bd0e9bc20fbabd709b7c5096124e6c132fc17252685cedc75c1169cbf63555`, `git get-tar-commit-id` = `6f082a98…` |
| Рецепт образу | `scripts/tyvn-hetzner.Dockerfile` (усередині архіву) |
| Read-only preflight | `scripts/tyvn-hetzner-preflight.sh` з коміту `6f082a98…` |
| Перевірка overlay | `scripts/tyvn-api-switch.py` (з цього набору; `check` також порівнює конфігурацію образів) |
| Докази «до/після» | `scripts/tyvn-release-verify.py` (лише GET, без входу) |
| Міграції | у `2e7acf1` і `6f082a98` однакові 44; кандидат **не має нових** — жодних міграцій |

Відомі факти сервера (16.10.2026, оновити на preflight): каталог `/opt/voltex-precutover`, Compose-проєкт
`voltex-cutover`, профіль `cutover`, сервіс `api-production` на `127.0.0.1:13020`, БД — контейнер
`voltex-cutover-db-1` (PostgreSQL 18.6, база `voltex_stage`), бекапи `voltex-pg-backup.timer` /
`/opt/voltex-precutover/backup-local.py` → `/opt/voltex-precutover/backups/local-*` (AES-256-GCM + RSA-OAEP-SHA256,
manifest у `complete.json` / `.retention-verified.json`).

## Заборонено (будь-який етап)

- Друкувати, копіювати чи пересилати ключі, паролі, токени, `DATABASE_URL`, `printenv`, `.env`, вміст рядків БД.
- Міграції Prisma, `migrate resolve`, restore/reset/seed production БД, будь-які SQL-записи в production.
- Зміни балансів, гаманців, ордерів, Stocks, AITH, NRX, Cloudflare Worker, Pages, DNS.
- Перезапуск чи перестворення будь-чого, крім `api-production` на етапі H — і лише після погодження.
- Rescue, reboot, нові SSH-ключі, вимкнення перевірки host key (`StrictHostKeyChecking=no`), відкриття портів.
- Hetzner web-консоль (VNC) як канал — вона спотворює символи.
- Публікація TYVN, запуск таймера, `tradable:true` — лише окремими погодженнями (етап J).
- Позначати PASS те, що не виконано. Невідоме = STOP.

## A. Канал (лише читання)

1. Знайти SSH-налаштування, якими вже працювали з сервером (`~/.ssh/config`, `known_hosts`, нотатки Codex у
   робочій теці). Значення ключів не відкривати й не друкувати.
2. `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes <HOST> 'hostname; date -u; docker --version'`.
   Якщо host key невідомий/змінився, пароль чи помилка доступу — **STOP: BLOCKED: NO AUTHORIZED REMOTE SERVER
   EXECUTION**; власника просити лише про одне: підтвердити в інтерфейсі, з якої машини оператор раніше
   заходив на сервер. Консольних інструкцій не давати.

## B. Публічна база «до» (на машині оператора)

```sh
python3 scripts/tyvn-release-verify.py baseline --out tyvn-baseline.json
python3 scripts/tyvn-release-verify.py verify --baseline tyvn-baseline.json --expect-api-sha 2e7acf158000404133db85723bac13695215e25c
ssh <HOST> 'curl -fsS http://127.0.0.1:13020/health'
```
Очікується `PASS: 17/17` і локальний `commit` = `2e7acf1…`. Інакше STOP (production уже змінювався — з'ясувати).

## C. Preflight на сервері (лише читання)

```sh
git show 6f082a98d0c97c28215e6c5c8056b786d6fa6c99:scripts/tyvn-hetzner-preflight.sh | ssh <HOST> 'bash -s'
```
Має закінчитися `PASS: read-only baseline gate`. Додатково зафіксувати (лише читання):
- `LIVE_IMAGE` = `docker inspect <api-container> --format '{{.Image}}'`, мітка revision, `StartedAt`, `RestartCount`;
- мітки Compose контейнера: project, working_dir, config_files, environment_file (шляхи, не вміст);
- `df -h /opt`, `pg_isready`, `systemctl status voltex-pg-backup.timer` (останній/наступний запуск);
- журнал міграцій **лише SELECT**:
  `docker exec voltex-cutover-db-1 psql -U voltex_admin -d voltex_stage -XAtc "select count(*), count(*) filter (where finished_at is null or rolled_back_at is not null) from _prisma_migrations"`
  — очікується `44|0`, імена збігаються з `prisma/migrations` у `2e7acf1`. Інакше STOP.

## D. Бекап: ізольоване відновлення (обов'язковий gate)

1. Взяти **останній автоматичний** знімок `backups/local-*` (не старший за 26 год). Нового знімка не запускати
   (ротація могла б прибрати старіший); якщо знімок старіший — STOP і спитати власника про запуск наявної служби.
2. Прочитати `/opt/voltex-precutover/backup-local.py` (лише читання), щоб точно відтворити формат шифрування,
   manifest і спосіб підрахунку рядків/хешів. Нічого не вигадувати.
3. Перевірки: SHA-256 зашифрованого файлу = manifest → автентифіковане розшифрування **на машині оператора**
   (приватний ключ не залишає її) → SHA-256/розмір plaintext = manifest → `pg_restore --exit-on-error --no-owner
   --no-privileges` у **одноразовий PostgreSQL 18.6** (`--network none`, без портів і production-томів, ліміт
   пам'яті, дані в `mktemp -d` з достатнім місцем, роль `neondb_owner NOLOGIN`) → **усі** таблиці, рядки та хеші
   збігаються з manifest того самого знімка.
   Plaintext не записувати на диск (лише потоком), рядків не друкувати. Якщо тест іде на сервері — контейнер
   і тимчасовий каталог мають унікальні імена, після тесту видаляються саме вони.
4. Результат: PASS/FAIL, час UTC, знімок, encrypted/plaintext SHA-256, кількість таблиць/рядків. FAIL або невідомо = STOP.

## E. Архів і неактивний образ

1. Архів: завантажити artifact 12434259743 (якщо на машині є авторизований `gh`) **або** `git archive --format=tar
   -o tyvn-api-source.tar 6f082a98… src tsconfig.json scripts/tyvn-hetzner.Dockerfile`. Вимоги:
   `git get-tar-commit-id` = `6f082a98…`; SHA-256 = `b6bd0e9b…3555` (з іншою версією git хеш може відрізнятись —
   тоді кожен файл архіву має збігатися з `git ls-tree -r 6f082a98…` для `src`, `tsconfig.json` і Dockerfile).
2. Новий каталог (відмовитися, якщо вже існує):
   `ssh <HOST> 'mkdir /opt/voltex-precutover/releases/tyvn-6f082a98'`, `scp` архів туди, на сервері перевірити
   SHA-256 і розпакувати.
3. Збірка без мережі й без запуску:
   ```sh
   cd /opt/voltex-precutover/releases/tyvn-6f082a98
   docker build --network none --pull=false --build-arg LIVE_IMAGE="$LIVE_IMAGE" \
     --build-arg RELEASE_COMMIT=6f082a98d0c97c28215e6c5c8056b786d6fa6c99 \
     -f scripts/tyvn-hetzner.Dockerfile -t voltex-tyvn:6f082a98d0c97c28215e6c5c8056b786d6fa6c99 .
   NEW_IMAGE="$(docker image inspect voltex-tyvn:6f082a98d0c97c28215e6c5c8056b786d6fa6c99 --format '{{.Id}}')"
   docker run --rm --network none --entrypoint grep "$NEW_IMAGE" -c countdown /app/dist/services/listings/store.js   # > 0
   docker run --rm --network none --entrypoint grep "$LIVE_IMAGE" -c countdown /app/dist/services/listings/store.js  # 0
   ```
   Якщо `tsc` відсутній чи збірка падає — STOP, нічого не доінстальовувати.

## F. Overlay лише для API і перевірка (лише читання)

```sh
KIT=<коміт цього набору>
git show $KIT:scripts/tyvn-api-switch.py | ssh <HOST> 'cd /opt/voltex-precutover && python3 - overlay --release-dir releases/tyvn-6f082a98 --image <NEW_IMAGE> --sha 6f082a98d0c97c28215e6c5c8056b786d6fa6c99'
git show $KIT:scripts/tyvn-api-switch.py | ssh <HOST> 'cd /opt/voltex-precutover && python3 - check --overlay releases/tyvn-6f082a98/compose.tyvn-api.yaml --sha 6f082a98d0c97c28215e6c5c8056b786d6fa6c99 --profile cutover'
```
`check` має надрукувати рівно два змінені ключі (`services.api-production.image`,
`services.api-production.environment.VOLTEX_RELEASE_SHA`), «New image runs like the old one…», наявний rollback-образ
і `READY TO SWITCH` з командами `switch` / `rollback`. Будь-яке `BLOCKED` = STOP. Зберегти обидві команди дослівно.

## G. Звіт і одне погодження

Показати власнику таблицю: SHA (живий/новий), `LIVE_IMAGE` і `NEW_IMAGE` (повні `sha256:`), шляхи змінених ключів,
бекап (знімок, час, PASS), місце на диску, міграції `44|0`, команди switch/rollback, GO/NO-GO.
Лише якщо все PASS — одне коротке запитання: **«Перемкнути лише API на 6f082a98? Так / Ні»**.
Загальне «продовжуй» погодженням не вважається.

## H. Перемикання (лише після «Так»)

1. Виконати надруковану команду `switch` через `ssh <HOST>` (вона змінює лише `api-production`:
   `up -d --no-deps --no-build --pull never api-production`).
2. До 90 с чекати `curl -fsS http://127.0.0.1:13020/health` з `commit` = `6f082a98…`.
3. `python3 scripts/tyvn-release-verify.py verify --baseline tyvn-baseline.json --expect-api-sha 6f082a98d0c97c28215e6c5c8056b786d6fa6c99` → `PASS: 17/17`.
4. Через 5 хв: `RestartCount` = 0; кількість рядків журналу контейнера з `error` (лише число, без вмісту).
5. **Будь-який FAIL** → негайно надрукована команда `rollback`, потім `verify … --expect-api-sha 2e7acf1…` = PASS,
   звіт власнику. БД не відновлювати, Worker не чіпати.

## I. Перевірки після оновлення (без змін даних)

Через браузер власника (сесія адміністратора вже відкрита; якщо в цієї сесії Claude є керування браузером):
- Адмінка → Листинги відкривається; AITH показує статус таймера; примітки «Первая публикация закрыта…» більше немає
  (API тепер повертає `countdown`); попередній перегляд опублікованого лістингу працює. Нічого не публікувати.
- Spot, Futures, Гаманець, сторінки AITH і NRX відкриваються без помилок. Жодних ордерів, переказів, зарахувань.
- Самостійне створення: тестових лістингів у production не створювати (видалити чернетку неможливо). Першим реальним
  лістингом через адмінку стане TYVN (етап J); 20 самостійних лістингів уже перевірено в CI.

## J. TYVN — кожен крок окремим погодженням

1. **Чернетка** (погодження 2): Адмінка → Листинги → створити з `config/test-markets/tyvn.draft.json` без змін:
   TERYVANE, TYVN, 0.0250 USDT, 27.10.2026 13:00 UTC (16:00 Москва, 15:00 Київ), seed `teryvane-20261026-v1`,
   `scenario-controls-v2`, +1725% за 24 год (0.45625), максимум 2.33675, `afterGrowth: range`, ownerAllocation
   `100000000` лише як параметр, `tradable:false`. Перевірити збережене проти JSON, приватний preview, 1440 і 390 px,
   відсутність у `market/listings`.
2. **Публікація staged** (погодження 3): «Запустить таймер сразу после публикации» — **знято**. Після цього TYVN
   відсутній у `market/listings`, ордери неможливі, AITH без змін (`verify --expect-api-sha 6f082a98…`).
3. **Запуск таймера** (погодження 4): «Запустить таймер» до 13:00 UTC 27.10. Якщо час минув — не запускати й не
   переносити дату назад; новий час — окреме погодження.

## K. Докази

Коментар у PR #578 і запис у `docs/AI_HANDOFF.md`: SHA, `LIVE_IMAGE`/`NEW_IMAGE`, змінені ключі, бекап, результати
`verify`, час кожного кроку, що НЕ виконано. Жодних секретів. Відрізняти «підготовлено» від «розгорнуто».

## Погодження власника (кожне — окреме коротке «Так»)

1. Перемкнути лише API на `6f082a98`.
2. Створити чернетку TYVN.
3. Опублікувати TYVN staged (прихований).
4. Запустити таймер TYVN.
