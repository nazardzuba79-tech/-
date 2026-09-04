# v0 final reference — voltex-analytics-dashboard(7).zip

This document captures the final v0 implementation that must remain the functional reference while Magic Patterns continues the visual design.

## What v0 had that is stronger than the first Magic Patterns pass

### Local liquidation microstructure
- Default view is LOCAL, not a broad weekly/global distribution.
- Asset-specific default visible ranges: BTC about ±4%, ETH about ±4.5%, SOL/XRP about ±5%.
- High bucket density: BTC 220 buckets, ETH 200, SOL/XRP 180.
- Working zoom controls: ±2%, ±4%, ±6%, GLOBAL.
- Short-term period controls: 4Ч, 12Ч, 24Ч, 3Д.
- Multiple exchange contributions: Binance, Bybit, OKX, Deribit, Bitget.
- Cumulative Long and Short curves are drawn on the same chart.
- Current price is a vertical reference marker.

### Liquidity voids
v0 explicitly generated true low-liquidity/near-empty areas rather than filling every price bucket. The local distribution was intentionally irregular:
cluster → void → shelf → spike → thin area → wall.

The voids were actual data-level low-density regions (not CSS gaps), so the cumulative curves flattened across them and accelerated across dense walls/clusters.

### Irregular / asymmetric structure
v0 used asset-specific local feature definitions with:
- narrow spikes,
- broader clusters,
- shelves,
- hard low-liquidity ranges,
- varying exchange participation by zone,
- asymmetric structure above vs below current price.

### Canonical derived analytics
The main chart dataset was used to derive or support:
- nearest major wall above current price,
- nearest major wall below current price,
- largest cluster,
- liquidity balance around current price,
- long vs short liquidation share,
- cluster ranking,
- nearest liquidity void,
- cumulative curves.

### Risk model
The liquidation cascade risk score was mathematically derived from factors, not a standalone magic constant. The weighting used:
- Open Interest 25%
- Funding 20%
- Position imbalance 15%
- Liquidity concentration 25%
- Volatility 15%

## Known problems still present in v0 final
1. The visible period label could change to 4Ч / 12Ч / 3Д while the top liquidation total still came from a hardcoded `liquidations24h` field. This must be fixed: displayed period totals must match the selected period or be marked unavailable.
2. Exchange filtering changed the chart, but the top nearest-wall summary was derived without the selected exchange filter. Summary and chart must always come from the same filtered canonical dataset.
3. Several lower Analytics sections duplicated OI / Long-Short / funding information already introduced in the liquidation intelligence area.
4. Some old panels still displayed fake live provider freshness such as `CoinGlass · обновлено 14 сек. назад` although those providers are not connected. Do not imply live external-provider data.

## What to preserve from the Magic Patterns pass
The first Magic Patterns pass introduced a cleaner institutional visual treatment, especially the restrained gold stacked liquidation bars and the structured light dashboard layout. Keep that direction.

## Target combination
Use the Magic Patterns pass as the working visual shell, but rebuild its liquidation map data/geometry to match the v0 functional depth:
- many more narrow local buckets,
- real voids,
- jagged local walls,
- asymmetric microstructure,
- cumulative curves that react to density,
- coherent filtering,
- summaries derived from the exact same displayed dataset.

Do not turn this into a buy/sell signal. It is market-structure intelligence.
