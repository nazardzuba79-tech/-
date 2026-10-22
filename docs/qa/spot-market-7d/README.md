# Spot market list «Цена · 24ч % · 7д %» — browser QA (2026-10-03)

`node scripts/qa-spot-market-7d.cjs` runs against the production bundle with a read-only local fixture (no backend, no writes). CI runs the same script in `.github/workflows/spot-market-7d.yml`.

The fixture covers three cases the column must not invent a number for: NEAR is ambiguous in the catalogue, NIGHT is absent, and ZEC has no reported week.

| Check | 1920 · 1440 · 1366, panel 240 / 250 / 258 / 300 / 340 |
|---|---|
| Price, 24h and 7d cells fit their columns | PASS. The one allowed overflow is a sub-satoshi price, «0.000000123456» (77px), shown with «…» and its full value in the title. It already overflowed main's 76px column. |
| Header «Цена · 24ч % · 7д %» over its columns | PASS, 0px offset |
| Horizontal overflow (list, page); wrapped rows | none |
| Pair name runs into the price | never; long names end in «…» |
| Logo | hidden only below 250px |
| «7д %» sort | descending → ascending → normal list, unknown weeks last both ways |
| Unknown week | «—», never 0% |
| 24h cells | identical before and after 7d sorting |

Grid bands, with the panel as its own size container:
- ≥300px: 12px figures, 20px logo; price 68px, each % column 54px.
- 250–299px (the default 258px panel): 11px figures, 16px logo; price 59px, % columns 50px.
- <250px: as 250–299px, without the logo.

Screenshots: `panel-<viewport>-<panel>.png` for panels 240, 258 and 340 at each viewport.
