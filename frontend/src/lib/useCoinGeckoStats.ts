import { useEffect, useState } from 'react';
import { api } from './api';

// The backend's own cache (RANKINGS_TTL_MS in CoinGeckoService) only
// refreshes once an hour, so polling faster than this doesn't get fresher
// numbers — it would just re-fetch the same cached response repeatedly.
// Five minutes still recovers a transient failure quickly (see the retry
// note below) without polling our own backend pointlessly often.
const POLL_MS = 5 * 60_000;

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
 * top-500 or the rankings fetch fails — callers fall back to their own
 * pair-specific figures in that case rather than showing a stat that's
 * silently wrong for that one asset.
 *
 * Polls rather than fetching once: a one-shot fetch that happened to land
 * during a transient failure (CoinGecko's free tier rate-limits fairly
 * readily) used to leave this null for the rest of that page view, with no
 * way to recover short of a full reload. Polling means the next successful
 * cycle repairs it automatically, no reload needed. */
export function useCoinGeckoStats(baseAsset: string): CoinGeckoStats | null {
  const [stats, setStats] = useState<CoinGeckoStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalRankings()
        .then((res) => {
          if (cancelled) return;
          const ranking = res.rankings.find((r) => r.symbol === baseAsset);
          setStats(ranking ? { volume24h: ranking.volume24h, marketCap: ranking.marketCap } : null);
        })
        .catch(() => {
          // Transient — leave the last-known-good stats in place rather
          // than blanking them out over one failed poll; the next cycle
          // retries.
        });
    }
    load();
    const interval = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [baseAsset]);

  return stats;
}
