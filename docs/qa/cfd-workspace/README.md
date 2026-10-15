# CFD terminal on the shared Chart Workspace — evidence (2026-10-15)

LOCAL QA ONLY. `scripts/qa-cfd-workspace.cjs` serves the production bundle on a
loopback Express host together with the real `/cfd/*` router from the compiled
backend (no database: any access throws). Quotes and OHLC are the real public
display sources that router already uses; nothing is fabricated. Every non-GET
request is refused and counted; the practice ticket writes only the browser's
own `localStorage`. External hosts are blocked (only `fonts.googleapis.com` was
asked for).

- `before/` — the `main` `f5875c00` build: nine widths (1920, 1440, 1366, 1024,
  768, 430, 390, 360, 320) and `report-before.json` (layout measurements only).
- `after/` — this branch: the same nine widths, plus the feature shots (1M,
  Heikin-Ashi, indicators, data window, analytics, compare, two charts, four
  charts at 1920, drawings and ruler, full screen, PNG snapshot, practice
  history at 1440 and 390) and `report-after.json` (74 checks, 0 failed,
  0 page errors, 0 writes refused).

Run it again:

```
npx tsc -p tsconfig.json            # the backend router the host loads
npm run build --prefix frontend
node scripts/qa-cfd-workspace.cjs --dist frontend/dist --out docs/qa/cfd-workspace/after --phase after
```

Sections: `shots` (nine widths, layout metrics), `chart` (workspace, verified
stats, all 13 intervals, six bar types with an unchanged execution price,
indicators without VWAP/OBV, data window, analytics, compare, two charts with
their own instrument and interval, sync, «Торговать», back to one chart,
drawings and ruler in CFD's own store, templates, «К дате», settings, snapshot,
full screen, digit keys, request and socket counts), `layout4` (1920),
`list` (groups, names, marks and bundled flags, change against the strip,
search, five fast switches, sort, bounded daily requests), `trade` (1440 and
390: market-only ticket, long, short, partial close with a refused quantity,
close all, history, compact empty state), `mobile` (430/390/360/320).
