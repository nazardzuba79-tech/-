/**
 * CFD candles for the chart workspace (2026-10-15).
 *
 * The same public display route the CFD terminal has always drawn from
 * (`/cfd/display/candles/:symbol` — the market edge in production, the API
 * host elsewhere) through the same bounded snapshot cache
 * (lib/displaySnapshotCache: one in-flight request per URL, six-hour
 * snapshots kept across reloads). One URL per instrument and interval — the
 * route's 500-bar maximum, whatever the caller asked for — so the main
 * chart, a second pane, a compare line and the derived intervals built from
 * the same base bars all read one cached answer, and a five-second chart
 * poll costs no request at all.
 *
 * Real OHLC only. The OTC quote feed carries no exchange volume (`volume`
 * is 0; `tickVolume` counts price updates, which is not traded size), so
 * every bar's volume is 0 and the chart hides volume for this source
 * (SOURCE_HAS_VOLUME in lib/chartTimeframes). Nothing here invents a bar.
 */
import { readDisplayJson, SLOW_DISPLAY_REFRESH_MS } from './displaySnapshotCache';
import { API_BASE } from './api';
import type { Candle } from './indicators';
import { CFD_DISPLAY_TIMEFRAMES, type ChartTimeframe } from './chartTimeframes';
import { timeframeUnavailableError } from './chartCandleSource';

const MARKET_EDGE_BASE = 'https://market.voltextech.net';
/** The display route's own ceiling (src/api/routes/cfd.ts, workers/market-edge): one cache entry per instrument and interval. */
export const CFD_CANDLE_LIMIT = 500;
/** The provider's names for the two oil benchmarks; the envelope may carry either. */
const PROVIDER_SYMBOL: Record<string, string> = { WTIUSD: 'USOIL', XBRUSD: 'UKOIL' };

const production = () => typeof window !== 'undefined' && !!window.location
  && (window.location.hostname === 'voltextech.net' || window.location.hostname.endsWith('.voltextech.net'));

/** The URL of one instrument's bars. `symbol` is the terminal's form (XAUUSD). */
export function cfdCandleUrl(symbol: string, interval: ChartTimeframe): string {
  const path = `/cfd/display/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=${CFD_CANDLE_LIMIT}`;
  return production() ? `${MARKET_EDGE_BASE}${path}&v=9` : `${API_BASE.replace(/\/$/, '')}${path}`;
}

const positive = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };

/** Validated bars of a display envelope, oldest first; throws on another instrument, another interval or a broken body. */
export function parseCfdCandles(body: unknown, symbol: string, interval: ChartTimeframe): Candle[] {
  const raw = body as { symbol?: unknown; interval?: unknown; bars?: unknown } | null;
  const provider = PROVIDER_SYMBOL[symbol] ?? symbol;
  if (!raw || typeof raw !== 'object' || raw.interval !== interval || typeof raw.symbol !== 'string' || ![symbol, provider].includes(raw.symbol)) throw new Error('cfd_chart_identity');
  if (!Array.isArray(raw.bars)) throw new Error('cfd_chart_shape');
  const seen = new Set<number>(), rows: Candle[] = [];
  for (const item of raw.bars) {
    if (!item || typeof item !== 'object') continue;
    const bar = item as Record<string, unknown>;
    const openMs = typeof bar.openTime === 'number' ? bar.openTime : typeof bar.openTime === 'string' ? Date.parse(bar.openTime) : NaN;
    const open = positive(bar.open), high = positive(bar.high), low = positive(bar.low), close = positive(bar.close);
    if (!Number.isFinite(openMs) || openMs <= 0 || open === null || high === null || low === null || close === null) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    const time = Math.floor(openMs / 1000);
    if (seen.has(time)) continue;
    seen.add(time);
    rows.push({ time, open, high, low, close, volume: 0 });
  }
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

/** The workspace loader contract (lib/chartTrading ChartCandleLoader) over the CFD display route. */
export async function getCfdDisplayCandles(pair: string, interval: string, limit: number, signal?: AbortSignal, endTime?: number): Promise<{ candles: Candle[] }> {
  const symbol = pair.toUpperCase().replace('/', '');
  if (!(CFD_DISPLAY_TIMEFRAMES as readonly string[]).includes(interval)) throw timeframeUnavailableError(interval);
  const body = await readDisplayJson(cfdCandleUrl(symbol, interval as ChartTimeframe), SLOW_DISPLAY_REFRESH_MS, signal);
  let candles = parseCfdCandles(body, symbol, interval as ChartTimeframe);
  // The route does not page back: an older window is whatever this snapshot holds before that instant.
  if (endTime !== undefined) candles = candles.filter(bar => bar.time * 1000 <= endTime);
  return { candles: candles.slice(-Math.max(1, Math.min(CFD_CANDLE_LIMIT, Math.floor(limit) || CFD_CANDLE_LIMIT))) };
}
