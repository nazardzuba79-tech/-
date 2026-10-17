# Реліз KYC (PR #530) у production: порядок, перевірки, відкат

**Статус: preflight, не дозвіл на реліз** (2026-10-16). SSH і read-only
production-перевірки виконано; міграцію, merge і deploy НЕ виконано. Виконує оператор,
який має SSH до сервера Hetzner, доступ до GitHub Actions і Cloudflare.
Кожен крок, що змінює production, робиться лише з окремого дозволу власника.
Тестові дії — тільки на синтетичних даних, ніколи на справжніх документах.

Порядок: **резервна копія PostgreSQL → міграція → API → Workers → frontend →
перевірки**; відкат — у зворотному порядку (розділ 9).

## 0. Що відомо і що треба підтвердити

| Факт | Стан |
|---|---|
| `https://api.voltextech.net/health` → `commit 57a154a0…`, branch `null`, старт 2026-10-09 | **Перевірено** read-only 2026-10-16 |
| Живий API не має нових маршрутів: `POST /api/v1/internal/kyc/authorize` → 415, `…/internal/kyc/materials/authorize` → 404 | **Перевірено** read-only 2026-10-16 (порожній POST без підпису, до бази не доходить) |
| API і PostgreSQL працюють на Hetzner; Render призупинено; Neon — лише старий резерв | `docs/VOLTEX_CURRENT_STATE.md` |
| Compose `/opt/voltex-precutover`, project `voltex-cutover`, profile `cutover` | **Перевірено SSH**, повний ланцюжок нижче |
| API `voltex-cutover-api-production-1`, image `sha256:594d20f45f48775be9698793c32de273744bb4c4d7c57f73c4a4087fb896aec1` | **Перевірено**, зберегти незмінним для rollback |
| DB `voltex-cutover-db-1`, PostgreSQL 18.6, database `voltex_stage`, role `neondb_owner` | **Перевірено**; 43 успішні міграції, лише нова KYC pending |
| Злиття в `main` не оновлює API | **Перевірено**: після 38 злиттів у `main` API досі на `57a154a0` |
| Злиття в `main` не деплоїть воркери | Після цього PR: `deploy-kyc-edge.yml` на push лише перевіряє; деплой — ручний запуск |
| Pages `voltex-exchange`: production branch `main`, automatic production builds увімкнені | **Перевірено API**. Merge title має ПОЧИНАТИСЯ з `[CF-Pages-Skip]`; не звичайний merge |
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
    cd /opt/voltex-precutover
    dc=(docker compose -p voltex-cutover --profile cutover
      -f compose.yaml -f compose.runtime.yaml -f compose.cutover.yaml.inactive
      -f releases/hotfix-487-57a154a/compose.hotfix.yaml)
    "${dc[@]}" ps
    docker exec voltex-cutover-db-1 postgres --version
    docker exec voltex-cutover-db-1 pg_isready -U voltex_admin -d voltex_stage
   df -h .
   curl -fsS https://api.voltextech.net/health
   ```
    Звірити ledger `_prisma_migrations` із каталогом кандидата: застосовано все,
    крім нової міграції, і **немає failed-міграцій**. `migrate status` старого
    образу знає лише його 43 міграції, тому сам по собі цього не доводить.
    Не друкувати й не пересилати
   `DATABASE_URL`, паролі, вивід `printenv`.
4. Cloudflare (лише перегляд): адреса `voltex.crypto@gmail.com` — verified
   destination в Email Routing; у воркера `voltex-kyc-edge` є секрет
   `KYC_EDGE_SIGNING_JWK` (дивитися лише назву).
5. Зупинитися, якщо: є failed-міграція; `/health` показує не `57a154a0` (хтось
   уже оновлював — з'ясувати); мало місця для копії; немає доступу до будь-чого вище.

## 2. Резервна копія PostgreSQL

Використовувати **чинний** `/opt/voltex-precutover/backup-local.py` через
`voltex-pg-backup.service`; не додавати другий job, plaintext-архів у `/root`
чи нову retention-систему. Timer активний, останній запуск 16.10 о 03:20 UTC
успішний, наступний 17.10 о 03:21:45 UTC (оновити перед релізом).

Наявний snapshot: `backups/local-20261016T032049Z`, encrypted custom dump
236224078 bytes, 63 tables / 7349 rows. `complete.json` і
`.retention-verified.json` містять manifest/checksums. Чинний workflow робить
`pg_dump`, повне читання `pg_restore`, шифрування AES-GCM+RSA і retention;
це НЕ рівнозначно успішному SQL restore.

Перед міграцією, **після дозволу**, запустити цей самий service для свіжого
унікального snapshot. Існуючий retention зберігає два автоматичних backups;
копії не перезаписуються, protected/emergency не видаляються. Приватний ключ
відновлення залишається на захищеній машині оператора, не копіюється на сервер.

Перевірка: encrypted SHA → authenticated decrypt → plaintext SHA/size →
`pg_restore --exit-on-error --no-owner --no-privileges` у disposable PG18.6
container (`--network none`, no ports/production mounts, memory/CPU limit).
Для даних — окремий приватний тимчасовий каталог із достатнім місцем для WAL
і restore, не малий tmpfs. Каталог створювати через `mktemp -d`, перевіряти
canonical path/ownership і видаляти лише його після завершення. Не змінювати
production volumes. Створити лише необхідну роль `neondb_owner NOLOGIN`. Чекати readiness
по TCP `127.0.0.1`, не temporary init socket. Звірити **всі** counts і row hashes
з manifest того самого snapshot (не з production, яка продовжує працювати).
Видалити тільки exact-owned test container. Не виводити рядки з персональними
даними в логи. Не переносити plaintext dump на диск чи Git.

Окремий звіт restore є обов'язковим gate. Якщо decrypt/restore/hash comparison
не пройшли або результат невідомий — **міграцію не запускати**. На preflight
вільно приблизно 15.8 GiB, а не історичні 23 GiB; повторити `df` перед build.
16.10 о 09:29 UTC snapshot вище пройшов повний restore на PG18.6:
63/63 таблиці, 7349 рядків, усі row hashes збігаються; temporary data/container
видалено. Див. [звіт preflight](qa/kyc-hetzner-preflight-20261016.md).

## 3. Новий образ API (ще без перемикання)

На сервері немає `build:` для production service: `docker compose build`
не є способом оновлення. Попередній реальний реліз зберігається у
`releases/hotfix-487-57a154a`; використовуємо його pinned image/dependency base.
Збірка кандидата — після дозволу, без production secret mounts і без мережі.
Зміни `package.json`, lock, bootstrap або start script відносно `57a154a0`
блокують цей рецепт (потрібен окремий перегляд залежностей).

```sh
# На локальній машині: архів лише exact release, не dirty checkout/.env.
git diff --exit-code 57a154a0322c25afe91641592084c5fc9f88fe8a "$RELEASE_COMMIT" -- package.json package-lock.json scripts/start-render-single-service.cjs
git archive --format=tar --output=kyc-source.tar "$RELEASE_COMMIT" src prisma tsconfig.json scripts/kyc-hetzner.Dockerfile scripts/kyc-hetzner-prisma.cjs
# Передати архів через наявний SSH; розпакувати в НОВИЙ releases/kyc-<SHA>.
# Не копіювати secrets/config із робочого каталогу.
docker build --network none --pull=false --build-arg RELEASE_COMMIT="$RELEASE_COMMIT" -f scripts/kyc-hetzner.Dockerfile -t "voltex-kyc:$RELEASE_COMMIT" .
docker image inspect "voltex-kyc:$RELEASE_COMMIT" --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

16.10 рецепт зібрано без мережі на чинному pinned base: Prisma generate і
backend TypeScript build PASS. Неактивний тестовий image
`voltex-kyc-preflight:checked-history-20261016` містить код PR `0e2b5a29`;
це НЕ фінальний release image. `status` із нього, з явним entrypoint,
показав рівно одну pending KYC migration. API не запускався і ledger не змінено.
Усі 43 історичні migration.sql у ньому побайтово тотожні чинному image:
рецепт зберігає їх із base і копіює лише schema + нову KYC migration, не весь
каталог `prisma`. Це також зберігає історичні CRLF/checksums.
Перед перемиканням зібрати/перевірити image вже з exact затвердженого merge SHA,
не використовувати preflight tag як production. Старий API продовжує працювати.

Створити **новий** `releases/kyc-<SHA>/compose.kyc.yaml` з двома точними override:

```yaml
services:
  api-production:
    image: sha256:<candidate image ID>
    environment:
      VOLTEX_RELEASE_SHA: <RELEASE_COMMIT>
```

Чинний Compose явно задає `VOLTEX_RELEASE_SHA=57a154a0…`, тому лише image ENV
не змінить release identity. Інших полів не змінювати. Додати overlay останнім:
`kc=("${dc[@]}" -f "$PWD/releases/kyc-$RELEASE_COMMIT/compose.kyc.yaml")`.
Звірити effective config лише за безпечними полями: порти
127.0.0.1:13020→3000, mounts, limits, networks і secret NAMES без змін;
image та release SHA — єдині різниці. Не друкувати весь config/env.

## 4. Міграція (окремим кроком)

**Критично:** чинний `runtime-bootstrap.cjs` ігнорує command arguments і
запускає API/collector. Звичайний `compose run ... npx prisma` НЕ виконує
безпечну окрему міграцію. Явно замінити entrypoint на `node` і запустити
обмежений helper, який читає лише змонтований database password, ніколи його
не логує і не запускає API. `production.json` не потрібно змінювати/читати.

```sh
test "$KYC_APPROVED_RELEASE_SHA" = "$RELEASE_COMMIT"
export KYC_APPROVED_RELEASE_SHA KYC_VERIFIED_BACKUP_SHA256
# KYC_VERIFIED_BACKUP_SHA256 = plaintext checksum щойно відновленого snapshot.
# Це НЕ секрет, але НЕ заміна реальній перевірці restore і дозволу власника.
"${kc[@]}" run --rm --no-deps --entrypoint node \
  -e KYC_APPROVED_RELEASE_SHA -e KYC_VERIFIED_BACKUP_SHA256 \
  api-production /opt/operations/kyc-hetzner-prisma.cjs deploy
"${kc[@]}" run --rm --no-deps --entrypoint node \
  api-production /opt/operations/kyc-hetzner-prisma.cjs status
docker exec voltex-cutover-db-1 psql -U voltex_admin -d voltex_stage -X -c '\d "KycMaterialRequest"'
```

Має застосуватися **лише** `20261015090000_kyc_material_requests`. Старий API
сумісний із новою таблицею (він її не читає), тож міграцію можна робити до
перемикання API.

Якщо міграція впала/SSH перервався: API не перемикати, автоматично НЕ
повторювати. Звірити ledger та об'єкти read-only. Не виконувати DROP, migrate
resolve чи restore без окремого плану й дозволу. Старий API працює далі.
Helper блокує будь-яку іншу pending migration, failed ledger або повторне
застосування після невідомого результату. Старт чинного bootstrap НЕ заміняє
окремий migration gate. Історичний checksum `session_remembered` відповідає
CRLF-байтам; не «виправляти» ledger або стару міграцію заради LF/CRLF.

## 5. Перемикання API

```sh
"${kc[@]}" up -d --no-deps api-production
# Логи перевіряти локально з редагуванням secrets/PII, не копіювати в чат.
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
підтвердити. На preflight такого environment ще немає: не називати його
налаштованим approval barrier. Без прямого дозволу власника не dispatch.
Далі деплоїться спочатку notification Worker, потім KYC edge;
перевіряються `/health`, публічний ключ, 401 без сесії на `/v1/submit` і
`/v1/materials`, CORS, `no-store`, здоров'я notification Worker. Telegram-
пересилання в пошті не змінюється.

## 7. Frontend

Merge title починається з `[CF-Pages-Skip]`, див.
[офіційну документацію Cloudflare](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).
Після merge перевірити, що старий production deployment лишився активним.
Не використовувати випадковий наступний commit для запуску frontend.
Після API/Workers gates зібрати frontend **точно з RELEASE_COMMIT**, з чинними
production build settings, перевірити артефакт і виконати дозволений manual
Pages deploy `voltex-exchange` на branch `main` із `--commit-hash RELEASE_COMMIT`.
Не брати build із dirty checkout або іншого SHA. Перевірити deployment status,
production commit і живий сайт — HTTP 200 сам по собі не доводить новий реліз.
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
    # dc = початкові 4 Compose files, БЕЗ compose.kyc.yaml; build не потрібен.
    "${dc[@]}" up -d --no-deps api-production
   curl -fsS https://api.voltextech.net/health                  # commit = 57a154a0…
   ```
   Таблицю `KycMaterialRequest` **не видаляти**: старий код її не читає, а
   вона — журнал запитів. Користувачі з відкритим запитом бачать звичайне
   «На рассмотрении»; адмін, як і раніше, може схвалити чи відхилити.
4. **Відновлення бази з копії — лише в крайньому разі** і з окремого рішення
   власника: воно стирає все, що сталося після копії (депозити, ордери,
   реєстрації). Для відкату KYC воно не потрібне.
5. Збережені Worker rollback versions (оновити перед релізом): KYC
   `63ae9935-b121-4b04-81c8-9697b484f759`, notification
   `484c4eac-2623-4ff0-9d07-5dc5ae012468`. Після notification rollback звірити
   signing key pin; не ротувати чинні ключі без потреби. Чинні здоров'я
   `KYC configured=true`, notification `CONFIGURED`; деградація до
   `NOT_CONFIGURED` не є успішним релізом.
6. Листи, що вже надійшли в пошту, лишаються — далі за
   `docs/KYC_DOCUMENT_POLICY.md`.

## 10. Що потрібно від людей

- Власник: дозвіл на кожен крок 2–7; рішення щодо reviewers для середовища
  `kyc-workers-production`; правила з `docs/KYC_DOCUMENT_POLICY.md`
  (строки — з юристом).
- Оператор: fresh-check head/main/CI/runtime і свіжий verified backup перед
  виконанням. Поточна перевірка не є дозволом на merge/migration/deploy.
- Пошта `voltex.crypto@gmail.com` Verified, KYC_MAIL і signing key існують.
  Mail→Telegram forwarding не змінюємо й нові сервіси не створюємо. Фактична
  доставка нового material-листа та його пересилання в цьому preflight НЕ
  тестувалися; підтвердити synthetic лист після окремого дозволу. API 200,
  mock та Worker health не є підтвердженням отримання листа.
