# Як отримати середню ставку Bybit на Windows (через Codex)

Мета — отримати офіційну історію funding Bybit за 30 повних днів UTC. Скрипт лише читає публічні дані Bybit і нічого не змінює.

- Не потрібні ключі, акаунт Bybit, секрети, production чи база даних.
- Хмарне середовище Claude та раннери GitHub отримують від Bybit `403` «доступ з вашої країни заблоковано», тому запуск має бути з вашого комп'ютера.
- Не обходьте блокування Bybit (VPN, проксі, сторонні сайти). Якщо Bybit не відповідає напряму, зупиніться й повідомте про це. Ставку не вигадуйте.

## Що потрібно

- Windows 10/11 з PowerShell.
- Node.js 20 або новіший. Перевірка: `node -v`.
- Git і клон репозиторію `nazardzuba79-tech/-`.

## Кроки (PowerShell, у корені репозиторію)

```powershell
# 1. Гілка PR #534 (там скрипт і місце для результату)
git fetch origin claude/peaceful-volta-h5zw7g-funding-fixed
git checkout claude/peaceful-volta-h5zw7g-funding-fixed
git pull --ff-only

# 2. Чи відповідає Bybit напряму. Потрібно "retCode":0.
#    Якщо 403 або "block access from your country" — ЗУПИНИТИСЬ.
curl.exe -sS https://api.bybit.com/v5/market/time

# 3. Розрахунок: 30 повних днів UTC до 16.10.2026, 10 найліквідніших USDT-perpetual + BTC/ETH/SOL
node scripts/research/bybit-funding-average.mjs --end 2026-10-16 --days 30 --top 10 --out docs/research
echo "exit code: $LASTEXITCODE"   # має бути 0; 2 = історія неповна, результат НЕ використовувати

# 4. Перевірка результату
$j = Get-Content docs/research/bybit-funding-2026-10-16.json -Raw | ConvertFrom-Json
$j.summary.usable          # True
$j.summary.incomplete      # порожньо
$j.summary.fixedRate8h     # одна ставка за 8 год, 8 знаків
$j.summary.totalRecords    # кількість записів
$j.summary.assets | Format-Table symbol, records, intervalsMinutes, complete, mean8hEquivalent

# 5. Відбиток файлу (за ним код перевіряє, що ставку взято саме з цього файлу)
Get-FileHash docs/research/bybit-funding-2026-10-16.json -Algorithm SHA256
```

## Що надіслати

Нічого не редагуйте у файлах — навіть один пробіл змінить SHA-256.

Є два варіанти:

- **Codex комітить файли в гілку PR #534:**
  ```powershell
  git add docs/research/bybit-funding-2026-10-16.json docs/research/bybit-funding-2026-10-16.md
  git commit -m "research: Bybit 30-day funding history to 2026-10-16 (official v5 API)"
  git push origin claude/peaceful-volta-h5zw7g-funding-fixed
  ```
  `.gitattributes` забороняє git змінювати кінці рядків у цих файлах, тож SHA-256 збережеться.
- **Або надішліть обидва файли (`.json` і `.md`) мені в чат.**

Після цього я:

1. Звірю записи, інтервали, повноту і `fixedRate8h`.
2. Впишу в `src/private-trading/native/fundingModel.ts` ставку `rate = fixedRate8h` і `evidence = SHA-256`.
3. Запущу тести, зокрема:
   - перевірку, що ставка збігається з файлом;
   - перевірку, що funding, нарахований до старту нової ставки, не змінився.

Вмикання в production — тільки з вашого окремого дозволу. Перед ним треба застосувати міграцію `20261016150000_native_funding_model`.

## Готове завдання для Codex (скопіювати)

> Repository nazardzuba79-tech/-, branch `claude/peaceful-volta-h5zw7g-funding-fixed` (PR #534). On this Windows machine, without any API keys, secrets, VPN/proxy or production access, run `docs/research/BYBIT_FUNDING_WINDOWS_RUN.md` steps 1–5 exactly.
> 1. If `curl.exe -sS https://api.bybit.com/v5/market/time` does not return `"retCode":0`, stop and report the exact response. Do not use any other source.
> 2. If `$LASTEXITCODE` is not 0 or `summary.usable` is not true, stop and report `summary.incomplete`. Do not commit anything.
> 3. Otherwise:
>    - Commit only `docs/research/bybit-funding-2026-10-16.json` and `.md` unmodified, and push to the same branch.
>    - Do not edit `fundingModel.ts`, do not merge, do not deploy, do not run migrations.
>    - Report `fixedRate8h`, `totalRecords`, the contracts with their record counts, the SHA-256 and the pushed commit SHA.
