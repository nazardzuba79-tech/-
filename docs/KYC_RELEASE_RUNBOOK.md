# Реліз KYC (PR #530) у production: порядок, перевірки, відкат

**Статус: план. Жоден крок не виконувався** (2026-10-16). Виконує оператор,
який має SSH до сервера Hetzner, доступ до GitHub Actions і Cloudflare.
Кожен крок, що змінює production, робиться лише з окремого дозволу власника.
Тестові дії — тільки на синтетичних даних, ніколи на справжніх документах.

Порядок: **резервна копія PostgreSQL → міграція → API → Workers → frontend →
перевірки**; відкат — у зворотному порядку (розділ 9).

## 0. Що відомо і що треба підтвердити

| Факт | Стан |
|---|---|
| `https://api.voltextech.net/health` → `commit 57a154a0…`, гілка `release/hetzner-api-baseline-3e64ae89`, старт 2026-10-09 | **Перевірено** read-only 2026-10-16 |
| Живий API не має нових маршрутів: `POST /api/v1/internal/kyc/authorize` → 415, `…/internal/kyc/materials/authorize` → 404 | **Перевірено** read-only 2026-10-16 (порожній POST без підпису, до бази не доходить) |
| API і PostgreSQL працюють на Hetzner; Render призупинено; Neon — лише старий резерв | `docs/VOLTEX_CURRENT_STATE.md` |
| Docker Compose у `/opt/voltex-precutover`, PostgreSQL у локальному контейнері | **НЕ ПЕРЕВІРЕНО** (зі звіту оператора 05–10.10; потрібен SSH) |
| Назви сервісів Compose, образ API, назва бази й користувача | **НЕ ПЕРЕВІРЕНО** |
| Злиття в `main` не оновлює API | **Перевірено**: після 38 злиттів у `main` API досі на `57a154a0` |
| Злиття в `main` не деплоїть воркери | Після цього PR: `deploy-kyc-edge.yml` на push лише перевіряє; деплой — ручний запуск |
| Cloudflare Pages публікує frontend з `main` при кожному push; коміт із `[CF-Pages-Skip]` у повідомленні не збирається | Звичайна поведінка Cloudflare Pages; **підтвердити** в панелі Pages для цього проєкту |
| Нове в API відносно `57a154a0`: код KYC з #530 + 4 невеликі файли з `main` (`src/api/routes/cfd.ts`, `src/api/routes/futures.ts`, `src/futures/refusalCode.ts`, `src/services/FuturesChartCandles.ts`); рівно **одна** нова міграція `20261015090000_kyc_material_requests` | **Перевірено** `git diff` 2026-10-16; повторити для фактичного коміту релізу (крок 1) |
| Telegram-виправлення з гілки `release/hetzner-api-baseline-…` уже є в `main` (файли однакові) | **Перевірено** `git diff 57a154a0 main` по цих файлах — порожньо |
| Міграція: одна нова таблиця `KycMaterialRequest` з індексами та зовнішнім ключем на `KycSubmission`; наявні таблиці й рядки не змінюються | **Перевірено** (`prisma/migrations/20261015090000_kyc_material_requests/migration.sql`, тест на одноразовій PostgreSQL) |

## 1. Підготовка (тільки читання, нічого не змінює)

1. GitHub: PR #530 зелений на останньому коміті. Після злиття — коміт у
   `main`, з якого збиратиметься API (далі `RELEASE_COMMIT`, повні 40 знаків).
   Злиття саме по собі production не змінює, якщо: воркери — лише перевірка;
   API — вручну; frontend — пропуск збірки, якщо в назві злиття є
   `[CF-Pages-Skip]` (тоді frontend публікується на кроці 7).
2. Що саме поїде в API:
   ```sh
   git diff --stat 57a154a0322c25afe91641592084c5fc9f88fe8a <RELEASE_COMMIT> -- src prisma package.json package-lock.json Dockerfile
   git diff --name-only --diff-filter=A 57a154a0322c25afe91641592084c5fc9f88fe8a <RELEASE_COMMIT> -- prisma/migrations
   ```
   Очікується лише перелік із таблиці вище та одна міграція. Інакше — зупинитися.
3. На сервері (SSH), без змін:
   ```sh
   cd <COMPOSE_DIR>                      # НЕ ПЕРЕВІРЕНО: /opt/voltex-precutover
   docker compose ps                     # назви сервісів API і бази → <api>, <db>
   docker compose exec <db> postgres --version
   docker compose exec <api> npx prisma migrate status
   df -h .
   curl -fsS https://api.voltextech.net/health
   ```
   `prisma migrate status` має показати, що застосовано все, крім нової
   міграції, і **немає failed-міграцій**. Не друкувати й не пересилати
   `DATABASE_URL`, паролі, вивід `printenv`.
4. Cloudflare (лише перегляд): адреса `voltex.crypto@gmail.com` — verified
   destination в Email Routing; у воркера `voltex-kyc-edge` є секрет
   `KYC_EDGE_SIGNING_JWK` (дивитися лише назву).
5. Зупинитися, якщо: є failed-міграція; `/health` показує не `57a154a0` (хтось
   уже оновлював — з'ясувати); мало місця для копії; немає доступу до будь-чого вище.

## 2. Резервна копія PostgreSQL

```sh
mkdir -p /root/voltex-backups && chmod 700 /root/voltex-backups
ts=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T <db> pg_dump -U <user> -d <database> -Fc > /root/voltex-backups/pre-kyc-$ts.dump
sha256sum /root/voltex-backups/pre-kyc-$ts.dump
docker compose exec -T <db> pg_restore --list < /root/voltex-backups/pre-kyc-$ts.dump | head
```

**Перевірка відновлення** — в окремому тимчасовому контейнері, production не чіпається
(версія PostgreSQL — та сама, що показав крок 1):

```sh
docker run -d --name kyc-restore-test -e POSTGRES_PASSWORD=restore-test-only postgres:<та сама версія>
docker cp /root/voltex-backups/pre-kyc-$ts.dump kyc-restore-test:/tmp/backup.dump
docker exec kyc-restore-test sh -c 'until pg_isready -U postgres; do sleep 1; done; createdb -U postgres restored && pg_restore -U postgres -d restored --no-owner /tmp/backup.dump'
docker exec kyc-restore-test psql -U postgres -d restored -c 'SELECT count(*) FROM "User"' -c 'SELECT count(*) FROM "KycSubmission"' -c 'SELECT count(*) FROM "_prisma_migrations"'
docker rm -f kyc-restore-test
```

Кількості мають збігатися з production (ті самі `SELECT count(*)`, лише читання).
Копію перенести в друге місце, лише зашифрованою: вона містить персональні дані
(імена, email, метадані KYC; самих фото в базі немає). Якщо відновлення не
вдалося — **далі не йти**.

## 3. Новий образ API (ще без перемикання)

```sh
cd <COMPOSE_DIR>
git fetch origin
git checkout --detach <RELEASE_COMMIT>     # НЕ ПЕРЕВІРЕНО: як саме сервер отримує код
docker compose build <api>
```

Старий API продовжує працювати.

## 4. Міграція (окремим кроком)

```sh
docker compose run --rm --no-deps <api> npx prisma migrate deploy
docker compose run --rm --no-deps <api> npx prisma migrate status
docker compose exec <db> psql -U <user> -d <database> -c '\d "KycMaterialRequest"'
```

Має застосуватися **лише** `20261015090000_kyc_material_requests`. Старий API
сумісний із новою таблицею (він її не читає), тож міграцію можна робити до
перемикання API.

Якщо міграція впала: API не перемикати. Старий API працює далі. Подивитися
рядок міграції в `_prisma_migrations`. Нові об'єкти (лише таблиця
`KycMaterialRequest` і її індекси) прибрати, позначити міграцію
`npx prisma migrate resolve --rolled-back 20261015090000_kyc_material_requests`,
з'ясувати причину. Відновлення з копії тут **не** потрібне: наявні таблиці
міграція не змінює.

(У `Dockerfile` команда старту теж виконує `prisma migrate deploy`; якщо
Compose на сервері використовує цей Dockerfile, повторний запуск нічого не
зробить — міграція вже застосована.)

## 5. Перемикання API

```sh
docker compose up -d --no-deps <api>
docker compose logs --since 5m <api> | tail -50
curl -fsS https://api.voltextech.net/health                     # commit = RELEASE_COMMIT
for p in internal/kyc/authorize internal/kyc/materials/authorize internal/kyc/materials/confirmed; do
  curl -s -o /dev/null -w "$p %{http_code}\n" -X POST "https://api.voltextech.net/api/v1/$p"
done                                                             # 415 для всіх трьох
curl -s -o /dev/null -w '%{http_code}\n' https://api.voltextech.net/api/v1/kyc/me                 # 401
curl -fsS https://api.voltextech.net/notifications/public-key   # потрібен для кроку 6
```

Також відкрити сайт: вхід, баланс, Spot/Futures відкриваються. Якщо щось не
так — відкат API (розділ 9).

## 6. Workers — ручний запуск

GitHub → Actions → **Deploy KYC and notification Workers (Cloudflare)** →
**Run workflow**:

- branch: `main`;
- `workers`: `notification-and-kyc`;
- `api_commit`: `RELEASE_COMMIT` (повні 40 знаків, як у `/health`);
- `migration_applied`: позначити (після кроку 4).

Запуск сам перевіряє (лише читання), що `/health` показує саме цей коміт, що
в цьому коміті є маршрути й міграція і що живий API відповідає 415 на трьох
маршрутах. Якщо ні — зупиняється й нічого не деплоїть. Якщо в налаштуваннях
репозиторію для середовища `kyc-workers-production` задано reviewers —
підтвердити. Далі деплоїться спочатку notification Worker, потім KYC edge;
перевіряються `/health`, публічний ключ, 401 без сесії на `/v1/submit` і
`/v1/materials`, CORS, `no-store`, здоров'я notification Worker. Telegram-
пересилання в пошті не змінюється.

## 7. Frontend

Якщо злиття було з `[CF-Pages-Skip]`: Cloudflare → Pages → проєкт сайту →
Deployments → запустити production-деплой коміту `main` (або злити будь-який
наступний коміт без цієї мітки). Назви кнопок у панелі — **перевірити**.
Після публікації: адмінка → «Верификация KYC» → у заявці є «Запросить
дополнительные материалы»; у користувача → Налаштування → Верифікація
відкривається як раніше.

## 8. Перевірки після релізу (тільки синтетичні дані)

1. Окремий тестовий акаунт (не справжня людина), синтетичне зображення.
2. Адмін: запит «Селфи» → користувач бачить запит (також після
   перезавантаження) → завантажує синтетичне зображення → лист із темою, що
   починається з `[KYC]`, і заголовком `X-Voltex-Kyc-Material` приходить у `voltex.crypto@gmail.com`
   → текстове повідомлення VOLTEX у Telegram (без файлу) → в адмінці
   «Дополнительные материалы получены».
3. Адмін: рішення по тестовій заявці. Потім тестовий лист видалити з пошти
   (і з Telegram, якщо пересилання передало файл) і видалити тестовий акаунт
   (з 16.10 це працює й для акаунтів із запитом матеріалів).
4. Справжні заявки користувачів не чіпати.

## 9. Відкат

У зворотному порядку; кожен рівень окремо:

1. **Workers** (першими — щоб edge перестав викликати нові маршрути):
   Cloudflare → Workers → `voltex-kyc-edge` (і за потреби
   `voltex-notification-edge`) → Deployments → повернути попередню версію.
   Старий edge нових маршрутів не викликає, тож працює з будь-яким API.
2. **Frontend**: Cloudflare Pages → Deployments → попередній деплой → rollback.
3. **API**:
   ```sh
   git checkout --detach 57a154a0322c25afe91641592084c5fc9f88fe8a
   docker compose build <api> && docker compose up -d --no-deps <api>
   curl -fsS https://api.voltextech.net/health                  # commit = 57a154a0…
   ```
   Таблицю `KycMaterialRequest` **не видаляти**: старий код її не читає, а
   вона — журнал запитів. Користувачі з відкритим запитом бачать звичайне
   «На рассмотрении»; адмін, як і раніше, може схвалити чи відхилити.
4. **Відновлення бази з копії — лише в крайньому разі** і з окремого рішення
   власника: воно стирає все, що сталося після копії (депозити, ордери,
   реєстрації). Для відкату KYC воно не потрібне.
5. Листи, що вже надійшли в пошту, лишаються — далі за
   `docs/KYC_DOCUMENT_POLICY.md`.

## 10. Що потрібно від людей

- Власник: дозвіл на кожен крок 2–7; рішення щодо reviewers для середовища
  `kyc-workers-production`; правила з `docs/KYC_DOCUMENT_POLICY.md`
  (строки — з юристом).
- Оператор із SSH: заповнити всі «НЕ ПЕРЕВІРЕНО» на кроці 1 до будь-яких змін.
