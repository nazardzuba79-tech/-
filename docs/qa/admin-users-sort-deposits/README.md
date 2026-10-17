# Admin: sortable users list and a restructured «Пополнения» — evidence (2026-10-15)

LOCAL QA ONLY, synthetic data. Both pages are the production bundle served by the
`QA_PREVIEW` host of `scripts/qa-admin-practicality.cjs`: 40 synthetic users
(`client.NN@example.invalid`, no password), one ready package, one awaiting a
top-up, one unattributed transfer. No production host, no real user, no write.

- `before/` — the `main` `f5875c00` build at 1440, 1024, 390 and 320
  (`measurements.json`: page heights, sideways scroll).
- `after/` — this branch, from `scripts/qa-admin-sort-deposits.cjs`
  (`measurements.json`: 23 checks, 0 failed, 0 page errors): deposits at six
  widths, the top-up tab, the schedule opened, the phone's folded manual checks
  opened, users at 1440/390, oldest registrations first, oldest logins first, and
  the phone select.

Page height of «Пополнения» (same fixture):

| width | before | after |
|---|---|---|
| 1440 | 1040 px | 900 px (one screen) |
| 1366 | 1057 px | 768 px |
| 1024 | 1065 px | 877 px |
| 390 | 1422 px | 960 px |
| 320 | 1583 px | 1112 px |

Run it again:

```
npm run build --prefix frontend
node scripts/qa-admin-sort-deposits.cjs --dist frontend/dist --out output/admin-sort-deposits
```
