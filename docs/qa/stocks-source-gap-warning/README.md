# Own-source gap warning and raw-token marking — before / after (#613 ← #621)

Synthetic fixture only: the hosted bundle, the real chart in Chromium, in-page source pages
(`scripts/qa-stocks-source-chart-browser.cjs`); no gateway, provider, RPC or real market.

| | 1440 | 390 |
|---|---|---|
| before (`5645884b`) | «Пробелы в данных» painted over by the chart at 3 of 5 sampled points, next to the attribution logo; «Цена токена» not rendered (desktop hides the chart-tools label) | «Пробелы в данных» painted over at 5 of 5 points (invisible) |
| after | warning in its own row under the chart, topmost at 5 of 5 points, no overlap with the chart, attribution or controls; heading reads «… · Цена токена» | warning under the chart, topmost at 5 of 5 points; «Цена токена» in the chart tools |

- `measure.json`: warning and attribution-logo boxes, the topmost element at the warning's corners and centre, label visibility.
- `browser-check.json`: the fixture with the visibility/occlusion assertion — before 3 passed / 8 failed, after 11 passed / 0 failed.
- Change: `.vxg-chart-warning` is laid out in the chart column instead of absolutely over the canvas; the desktop chart heading adds «Цена токена» only for own-source prices. Admission, gaps logic, CEX path and trading flags are unchanged.
