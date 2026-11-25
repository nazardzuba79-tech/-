import type { LiveSource } from "./marketData/live/contract";

export const ASSET_CAP = 100;
const FRESH_MS = 60_000;
export function thomasCoverage(source: LiveSource | null, now = Date.now) {
  function read(at: number) {
    const frame = source?.snapshot();
    if (!frame || frame.status !== "live")
      return { status: "unavailable" as const };
    const assets = new Map<string, { volume: number; change: number }>();
    for (const row of frame.rows) {
      if (
        row.marketType !== "spot" ||
        row.quoteAsset !== "USDT" ||
        !row.baseAsset ||
        row.stale ||
        !Number.isFinite(row.receivedAt) ||
        row.receivedAt > at ||
        at - row.receivedAt > FRESH_MS ||
        !(
          row.lastPrice != null &&
          Number.isFinite(row.lastPrice) &&
          row.lastPrice > 0
        ) ||
        !(
          row.quoteVolume24h != null &&
          Number.isFinite(row.quoteVolume24h) &&
          row.quoteVolume24h > 0
        ) ||
        row.changePercent24h == null ||
        !Number.isFinite(row.changePercent24h)
      )
        continue;
      const old = assets.get(row.baseAsset);
      if (!old || old.volume < row.quoteVolume24h)
        assets.set(row.baseAsset, {
          volume: row.quoteVolume24h,
          change: row.changePercent24h,
        });
    }
    const selected = [...assets.entries()]
      .sort(([a, x], [b, y]) => y.volume - x.volume || a.localeCompare(b))
      .slice(0, ASSET_CAP);
    if (!selected.length) return { status: "unavailable" as const };
    return {
      status: "connected" as const,
      asOf: new Date(at).toISOString(),
      assets: selected.length,
      advancing: selected.filter(([, s]) => s.change > 0).length,
      declining: selected.filter(([, s]) => s.change < 0).length,
    };
  }
  let cached: ReturnType<typeof read> | undefined;
  let expires = 0;
  return () => {
    const at = now();
    if (!cached || at >= expires) {
      cached = read(at);
      expires = at + 2000;
    }
    return cached;
  };
}
