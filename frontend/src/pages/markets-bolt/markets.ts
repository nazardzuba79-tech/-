// Data/logic layer for the ported Bolt.new Markets design (see
// components.tsx). Everything here is derived from the same two real
// sources the previous MarketsPage.tsx already used — api.getExternalTickers
// (live Kraken-mirrored spot tickers) and api.getExternalRankings (CoinGecko
// rank/category/7d-sparkline/market-wide change) — never synthetic data.
// Where the Bolt archive's own seed data invented a figure with no real
// counterpart in this app (a single "Fear & Greed" number, a fake
// spot/derivatives volume split, a "New" listing flag with no underlying
// listing-date field), the figure below is either computed from real data
// instead or dropped — see the doc comment on each function for which.

import { parseChangePercent } from '../../lib/priceChange';
import { QUOTE_PRIORITY, type CoinCategory, type CoinRanking as PairListCoinRanking } from '../../lib/pairList';

export interface Ticker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  quoteVolume24h: string;
  changePercent24h: string;
}

export type CoinRanking = PairListCoinRanking;

// The only pairs this exchange actually offers leveraged futures on (see
// FUTURES_SYMBOLS in FuturesPage.tsx — kept in sync manually since it's a
// short, stable, real product-config list, not derived data worth wiring
// through an API round-trip for).
export const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function baseOf(pair: string): string {
  return pair.split('/')[0];
}

export function quoteOf(pair: string): string {
  return pair.split('/')[1];
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 0.001) return value.toFixed(8);
  if (value < 1) return value.toFixed(4);
  if (value < 100) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Compact $ formatting for aggregate figures (total volume, market cap) —
// picks B/M/K the same way the rest of the site's ticker bars already do.
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

// Quote-asset chips: whichever quote assets actually appear in the live
// ticker list, ordered by the same QUOTE_PRIORITY the trade-page sidebar
// uses (most-traded first) with anything else appended alphabetically —
// never the archive's fixed list, which included a quote ('USDE') this
// exchange doesn't even support.
export function deriveQuoteList(tickers: Ticker[]): string[] {
  const present = new Set(tickers.map((tk) => quoteOf(tk.pair)));
  const prioritized = QUOTE_PRIORITY.filter((q) => present.has(q));
  const rest = Array.from(present)
    .filter((q) => !QUOTE_PRIORITY.includes(q))
    .sort();
  return [...prioritized, ...rest];
}

// "Market sentiment" — Bybit's own version of this widget is built from
// order-flow data we don't have (this app mirrors Kraken's public tickers,
// not a derivatives long/short book). Rather than show a static invented
// number, this computes a real, live composite from the same tickers the
// table already renders: the share of tracked pairs currently green vs red
// over the last 24h. Simplified, but genuinely derived from live data and
// updates every refresh like the table does.
export function computeSentiment(tickers: Ticker[]): { score: number; label: 'Жадность' | 'Страх'; longPct: number; shortPct: number } {
  if (tickers.length === 0) return { score: 50, label: 'Жадность', longPct: 50, shortPct: 50 };
  const positive = tickers.filter((tk) => parseChangePercent(tk.changePercent24h, tk.pair) >= 0).length;
  const longPct = Math.round((positive / tickers.length) * 100);
  return {
    score: longPct,
    label: longPct >= 50 ? 'Жадность' : 'Страх',
    longPct,
    shortPct: 100 - longPct,
  };
}

// Real total 24h spot turnover across every tracked pair (sum of each
// pair's own quoteVolume24h) — this exchange has no separate derivatives
// ticker feed, so unlike the archive's fabricated "Spot $42.8B /
// Derivatives $33.5B" split, this reports the one real total plus how many
// pairs it's summed from rather than inventing a second figure.
export function computeVolumeSummary(tickers: Ticker[]): { totalVolume: number; pairCount: number } {
  const totalVolume = tickers.reduce((sum, tk) => sum + (parseFloat(tk.quoteVolume24h) || 0), 0);
  return { totalVolume, pairCount: tickers.length };
}

export interface SectorSummary {
  category: CoinCategory;
  avgChange: number;
  leaderSymbol: string | null;
  leaderChange: number | null;
}

// Per-category aggregate: average real 24h change across every ranked coin
// tagged with that category, plus which single coin in it is moving the
// most — both computed straight from CoinGeckoService's real category
// tags and 24h change figures (see rankByBase), never invented.
export function computeSectorSummaries(rankByBase: Map<string, CoinRanking>, categories: CoinCategory[]): SectorSummary[] {
  return categories.map((category) => {
    const members = Array.from(rankByBase.values()).filter((r) => r.categories.includes(category) && r.changePercent24h !== null);
    if (members.length === 0) return { category, avgChange: 0, leaderSymbol: null, leaderChange: null };
    const avgChange = members.reduce((sum, r) => sum + (r.changePercent24h ?? 0), 0) / members.length;
    const leader = members.reduce((best, r) => ((r.changePercent24h ?? -Infinity) > (best.changePercent24h ?? -Infinity) ? r : best));
    return { category, avgChange, leaderSymbol: leader.symbol, leaderChange: leader.changePercent24h };
  });
}

export function topMovers(tickers: Ticker[], count: number): Ticker[] {
  return [...tickers].sort((a, b) => parseChangePercent(b.changePercent24h, b.pair) - parseChangePercent(a.changePercent24h, a.pair)).slice(0, count);
}

export function topLosers(tickers: Ticker[], count: number): Ticker[] {
  return [...tickers].sort((a, b) => parseChangePercent(a.changePercent24h, a.pair) - parseChangePercent(b.changePercent24h, b.pair)).slice(0, count);
}

export function mostPopular(tickers: Ticker[], count: number): Ticker[] {
  return [...tickers].sort((a, b) => (parseFloat(b.quoteVolume24h) || 0) - (parseFloat(a.quoteVolume24h) || 0)).slice(0, count);
}

// CoinGecko's sparkline_in_7d is ~168 hourly closes — real history, used
// directly (no synthesized wave function like the archive's makePoints).
// Falls back to a flat 2-point line when a pair's base isn't in the
// top-500 ranked set yet, so the chart renders instead of crashing on an
// empty points array.
export function sparklineFor(ranking: CoinRanking | null, lastPrice: number): number[] {
  if (ranking && ranking.sparkline.length >= 2) return ranking.sparkline;
  return [lastPrice, lastPrice];
}
