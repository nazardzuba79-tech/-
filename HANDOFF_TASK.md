# Next Magic Patterns task

Continue from the CURRENT repository root. Do not rebuild from scratch.

1. Preserve the current Magic Patterns visual direction, especially the gold liquidation bars and clean light institutional layout.
2. Upgrade `src/components/LiquidationMap.tsx` from the current coarse 16-bin profile to a genuinely high-detail LOCAL liquidity map inspired by the functional behavior described in `_reference/V0_FINAL_REFERENCE.md`.
3. Default BTC local view should contain roughly 180–220 narrow buckets within about ±4% of current price.
4. Create genuine near-empty liquidity voids in the data, not visual whitespace only.
5. Make walls/clusters irregular and asymmetric. Avoid a smooth/bell-curve distribution.
6. Make cumulative Long/Short curves flatten across voids and change sharply across major walls.
7. Make ±2% / ±4% / ±6% and 4Ч / 12Ч / 24Ч / 3Д controls either truly alter the dataset or disable unsupported states; no fake controls.
8. Make exchange filtering affect the chart AND every derived nearest-wall/cluster/summary metric.
9. Derive top summary values and the cluster/nearest-structure panels from one canonical currently-displayed dataset. Do not keep separate hardcoded values that can disagree with the chart.
10. Remove misleading live provider/freshness copy for data sources that are not actually connected; use `Источник данных не подключен` where appropriate.
11. Keep the page hierarchy and other approved panels intact unless removing obvious duplicate information.
12. No external API integration in this design task. No API keys. No direct frontend provider calls.
13. No visible Demo / Mock / Simulation / Synthetic / Test wording.
14. Keep responsive behavior clean: desktop dense and useful; mobile may scroll inside the chart area but must not create page-level horizontal overflow.
