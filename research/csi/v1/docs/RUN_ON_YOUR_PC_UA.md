# Запуск на вашому комп'ютері (для повного доступу до Binance API)

З дослідницького середовища `api.binance.com` відповідає HTTP 451 (геообмеження). Архів `data.binance.vision` доступний і вже використаний (v2),
але «коротка історія» OI/long-short через REST і найсвіжіші дні funding доступні лише через API. Якщо ваша країна не обмежена Binance:

1. Встановіть Python 3.11+ (python.org). У терміналі:
   ```bash
   pip install numpy pandas scipy pytest
   ```
2. Розпакуйте ZIP, відкрийте папку `v1`, розпакуйте базу: `gunzip -k data/csi.db.gz` (Windows: 7-Zip → розпакувати `csi.db.gz`).
3. Перевірка мережі: `python -m csi.preflight` — має показати 200 для Binance.
4. Збір Binance напряму: `python -m csi.collect --source binance` (спот з 2017, funding з 2019-09, OI/ratios — останні ~30 днів).
5. Оновлення решти: `python -m csi.collect --source all` і `python -m csi.collect_v2 --source all`.
6. Перевірки й dashboard: `python -m csi.validate`, `python -m csi.dashboard` → відкрити `platform/dashboard.html`.
7. Повторна оцінка (довго, ~5–10 хв): `python -m csi.evaluate_v2`, потім `python -m csi.systems_v2`.

Не потрібні: API-ключі, акаунт, гаманець. Код робить лише публічні GET-запити.
Адаптер `binance` (пряме API) написаний за документованим форматом відповідей, але **не тестувався наживо** з дослідницького середовища через 451.
