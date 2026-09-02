// Data/logic layer for the ported Bolt.new Markets design (see
// components.tsx). Everything here is derived from the same two real
// sources the previous MarketsPage.tsx already used — api.getExternalTickers
// (live Kraken-mirrored spot tickers) and api.getExternalRankings (CoinGecko
// rank/category/7d-sparkline/market-wide change) — never synthetic data.
// The market-WIDE headline figures (total 24h volume, market cap, and the
// published Fear & Greed Index) come from a third real source,
// api.getGlobalMarket. Where the Bolt archive's own seed data invented a
// figure with no real counterpart in this app (a fake spot/derivatives
// volume split, a "New" listing flag with no underlying listing-date
// field), the figure below is either computed from real data instead or
// dropped — see the doc comment on each function for which.

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
// picks T/B/M/K the same way the rest of the site's ticker bars already do.
// The trillions step matters now that this also formats total market cap,
// which is well past $1T: without it the card read "$2410.00B".
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
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

// Market breadth: the share of tracked pairs currently green vs red over
// the last 24h, computed from the same tickers the table below renders.
//
// This is NOT the Fear & Greed Index and is no longer labelled as one. The
// published index (see FearGreedService on the backend) is a composite of
// volatility, momentum/volume, social sentiment, BTC dominance and search
// trends; breadth measures one of those inputs, so the two numbers
// routinely sit tens of points apart — showing breadth under a "Fear &
// Greed" label is what made this card read 43 while every other exchange
// showed 71. Both are now shown, each under its own honest label.
export function computeBreadth(tickers: Ticker[]): {
  longPct: number;
  shortPct: number;
  advancing: number;
  declining: number;
} {
  if (tickers.length === 0) return { longPct: 0, shortPct: 0, advancing: 0, declining: 0 };
  const advancing = tickers.filter((tk) => parseChangePercent(tk.changePercent24h, tk.pair) >= 0).length;
  const longPct = Math.round((advancing / tickers.length) * 100);
  return { longPct, shortPct: 100 - longPct, advancing, declining: tickers.length - advancing };
}

// alternative.me publishes the index bucket in English; this is the only
// place it's translated, so the number and its label always agree.
export function fearGreedLabelRu(classification: string): string {
  switch (classification.toLowerCase()) {
    case 'extreme fear':
      return 'Крайний страх';
    case 'fear':
      return 'Страх';
    case 'neutral':
      return 'Нейтрально';
    case 'greed':
      return 'Жадность';
    case 'extreme greed':
      return 'Крайняя жадность';
    default:
      return classification;
  }
}

// Turnover across the pairs THIS exchange lists (sum of each pair's own
// quoteVolume24h), used for the card's secondary "по нашим парам" line and
// its pair count. The card's headline 24h figure is market-wide instead
// (api.getGlobalMarket) — that's the ~$76B number every other exchange
// shows, whereas this sum only ever covers the pairs listed here and so
// lands one to two orders of magnitude lower.
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
