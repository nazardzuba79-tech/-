import { useEffect, useState } from 'react';
import { api } from './api';

export interface CoinGeckoStats {
  // Real global 24h trading volume across every exchange CoinGecko tracks
  // (its own `total_volume` field, in USD) — not just this app's Kraken
  // mirror for one specific pair, which only reflects Kraken's own
  // liquidity and reads unrealistically small (millions, not billions)
  // next to what CoinMarketCap/CoinGecko show for a major coin.
  volume24h: number;
  // Real market cap (price * circulating supply), also from CoinGecko —
  // null on the rare row where CoinGecko itself doesn't report one.
  marketCap: number | null;
}

/** Returns null (not partial data) if the asset isn't in CoinGecko's
 * top-200 or the rankings fetch fails — callers fall back to their own
 * pair-specific figures in that case rather than showing a stat that's
 * silently wrong for that one asset. */
export function useCoinGeckoStats(baseAsset: string): CoinGeckoStats | null {
  const [stats, setStats] = useState<CoinGeckoStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        const ranking = res.rankings.find((r) => r.symbol === baseAsset);
        setStats(ranking ? { volume24h: ranking.volume24h, marketCap: ranking.marketCap } : null);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baseAsset]);

  return stats;
}
