import { useEffect, useState } from 'react';
import { api } from './api';

/** Real global 24h trading volume for a coin across every exchange
 * CoinGecko tracks (its own `total_volume` field, in USD) — not just this
 * app's Kraken mirror for one specific pair, which only reflects Kraken's
 * own liquidity and reads unrealistically small (millions, not billions)
 * next to what CoinMarketCap/CoinGecko show for a major coin. Returns null
 * if the asset isn't in CoinGecko's top-200 or the rankings fetch fails —
 * callers fall back to their own pair-specific figure in that case. */
export function useGlobalVolumeUsd(baseAsset: string): number | null {
  const [volume, setVolume] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        const ranking = res.rankings.find((r) => r.symbol === baseAsset);
        setVolume(ranking?.volume24h ?? null);
      })
      .catch(() => {
        if (!cancelled) setVolume(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baseAsset]);

  return volume;
}
