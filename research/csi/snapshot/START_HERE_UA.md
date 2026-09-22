# Передача пакета наступному агенту
1. Розпакуйте весь ZIP в окрему папку `CSI_Research_Pack`.
2. Відкрийте цю папку локально в Claude Code або Codex. Не репозиторій production VOLTEX.
3. Передайте коротке повідомлення:

```text
Прочитай START_HERE_UA.md, README.md, AGENTS.md і PROMPT_BUILD_THREE_UA.txt.
Виконай завдання з PROMPT_BUILD_THREE_UA.txt. У цьому пакеті RESEARCH ONLY — NO DATA:
спершу отримай і перевір справжню історію. Не будуй композити на порожній базі.
Після перевірки даних досліди кандидатів і реалізуй CYCLE, REGIME, TACTICAL.
Зберігай усі результати, невдачі й стан роботи у файлах проєкту.
```

Вам не потрібно окремо переносити 240 рядків у чат. Ключові файли містяться в архіві. Досьє — `research/RESEARCH_UA.md`; обмеження — `research/SPEC_AUDIT_UA.md`; джерела — `catalog/SOURCES.md`; повний каталог — `catalog/catalog.csv` і `.json`. Власні джерельні файли збережено незмінними в `inputs/`.

Практичний вибір: Claude Code Fable 5.1 основний executor з робочою мережею, Codex незалежний reviewer. Це не доведений рейтинг моделей; деталі у `research/AGENT_CHOICE_UA.md`. Коли тільки Codex має доступ до даних, зробіть його executor.
