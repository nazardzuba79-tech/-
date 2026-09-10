import type { HomeTicker } from './useHomeMarket';

export interface HeatTile {
  ticker: HomeTicker;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every tile's area is proportional to its actual quote turnover. No minimum
 * area, invented market cap, or logarithmic scaling silently alters that fact.
 * The selector alongside the map keeps even very small tiles accessible. */
export function heatmapLayout(tickers: HomeTicker[], limit = 12): { tiles: HeatTile[]; volumeWeighted: boolean } {
  const seen = new Set<string>();
  const valid = tickers.filter((ticker) => {
    if (ticker.quote !== 'USDT' || !Number.isFinite(ticker.price) || ticker.price <= 0 || !Number.isFinite(ticker.change) || seen.has(ticker.pair)) return false;
    seen.add(ticker.pair);
    return true;
  });
  const withVolume = valid.filter((ticker) => Number.isFinite(ticker.quoteVolume) && ticker.quoteVolume > 0);
  const volumeWeighted = withVolume.length > 0;
  const rows = (volumeWeighted ? withVolume : valid)
    .slice()
    .sort((a, b) => volumeWeighted ? b.quoteVolume - a.quoteVolume || a.pair.localeCompare(b.pair) : Math.abs(b.change) - Math.abs(a.change) || a.pair.localeCompare(b.pair))
    .slice(0, Math.max(0, limit));
  if (rows.length === 0) return { tiles: [], volumeWeighted };
  // Normalize before summing to keep finite inputs finite even at large scale.
  const maximum = volumeWeighted ? rows[0].quoteVolume : 1;
  const weights = rows.map((ticker) => volumeWeighted ? ticker.quoteVolume / maximum : 1);
  const tiles: HeatTile[] = [];

  function partition(start: number, end: number, x: number, y: number, width: number, height: number) {
    if (end - start === 1) {
      tiles.push({ ticker: rows[start], x, y, width, height });
      return;
    }
    const total = weights.slice(start, end).reduce((sum, value) => sum + value, 0);
    let cut = start + 1;
    let first = weights[start];
    while (cut < end - 1 && Math.abs(total / 2 - (first + weights[cut])) < Math.abs(total / 2 - first)) {
      first += weights[cut++];
    }
    const ratio = first / total;
    // Design aspect ratio 2:1; the percentage coordinates remain exact at all widths.
    if (width * 2 >= height) {
      partition(start, cut, x, y, width * ratio, height);
      partition(cut, end, x + width * ratio, y, width * (1 - ratio), height);
    } else {
      partition(start, cut, x, y, width, height * ratio);
      partition(cut, end, x, y + height * ratio, width, height * (1 - ratio));
    }
  }
  partition(0, rows.length, 0, 0, 100, 100);
  return { tiles, volumeWeighted };
}
