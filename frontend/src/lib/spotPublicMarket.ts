import type { Candle } from './indicators';
import type { FuturesDepthSnapshot } from './futuresDepth';

const DIRECT_KRAKEN_BASE = 'https://api.kraken.com';
const EDGE_BASE = 'https://market.voltextech.net';
const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

const INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

const KRAKEN_ASSET: Record<string, string> = {
  BTC: 'XBT',
  DOGE: 'XDG',
};

function productionSite(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'voltextech.net' || host.endsWith('.voltextech.net');
}

function pairSlug(pair: string): string {
  return pair.replace('/', '-');
}

function krakenPair(pair: string): string {
  const [base, quote] = pair.toUpperCase().split('/');
  return `${KRAKEN_ASSET[base] ?? base}${KRAKEN_ASSET[quote] ?? quote}`;
}

function finitePositiveText(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`spot_market_http_${response.status}`);
  return response.json();
}

function resultValue(payload: any): any {
  if (!payload || !Array.isArray(payload.error) || payload.error.length) throw new Error('kraken_market_error');
  if (!payload.result || typeof payload.result !== 'object') throw new Error('kraken_market_shape');
  const key = Object.keys(payload.result).find(name => name !== 'last');
  if (!key) throw new Error('kraken_market_empty');
  return payload.result[key];
}

export function parseDirectSpotBook(payload: any, pair: string): FuturesDepthSnapshot {
  const raw = resultValue(payload);
  const read = (rows: unknown): { price: string; quantity: string }[] => {
    if (!Array.isArray(rows)) throw new Error('kraken_book_shape');
    return rows.slice(0, 25).map(row => {
      if (!Array.isArray(row) || !finitePositiveText(row[0]) || !finitePositiveText(row[1])) throw new Error('kraken_book_level');
      return { price: row[0], quantity: row[1] };
    });
  };
  const bids = read(raw.bids).sort((a,b)=>Number(b.price)-Number(a.price));
  const asks = read(raw.asks).sort((a,b)=>Number(a.price)-Number(b.price));
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error('kraken_book_unusable');
  const newest = Math.max(
    ...[...(raw.bids ?? []), ...(raw.asks ?? [])].slice(0, 50)
      .map((row: any) => Number(row?.[2]) * 1000)
      .filter((value: number) => Number.isFinite(value) && value > 0),
    0,
  );
  return { bids, asks, asOf: newest || Date.now(), source: 'rest', status: 'live' };
}

export function parseEdgeSpotBook(payload: any, pair: string): FuturesDepthSnapshot {
  if (payload?.pair !== pair || !Array.isArray(payload?.bids) || !Array.isArray(payload?.asks)) throw new Error('edge_spot_book_identity');
  const read = (rows: any[]) => rows.slice(0, 25).map(row => {
    if (!row || !finitePositiveText(row.price) || !finitePositiveText(row.quantity)) throw new Error('edge_spot_book_level');
    return { price: row.price, quantity: row.quantity };
  });
  const bids = read(payload.bids).sort((a,b)=>Number(b.price)-Number(a.price));
  const asks = read(payload.asks).sort((a,b)=>Number(a.price)-Number(b.price));
  if (!bids.length || !asks.length || Number(bids[0].price) >= Number(asks[0].price)) throw new Error('edge_spot_book_unusable');
  const asOf = Number(payload.timestamp ?? payload.fetchedAt);
  return { bids, asks, asOf: Number.isFinite(asOf) && asOf > 0 ? asOf : Date.now(), source: 'rest', status: 'live' };
}

export async function readSpotPublicBook(pair: string, signal?: AbortSignal): Promise<{ pair: string } & FuturesDepthSnapshot> {
  if (!/^[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}$/.test(pair)) throw new Error('Invalid spot pair');

  if (!productionSite()) {
    const body = await fetchJson(`${API_BASE}/market/display/spot-book/${pairSlug(pair)}`, signal);
    return { pair, ...parseEdgeSpotBook(body, pair) };
  }

  try {
    const query = new URLSearchParams({ pair: krakenPair(pair), count: '25' });
    const body = await fetchJson(`${DIRECT_KRAKEN_BASE}/0/public/Depth?${query}`, signal);
    return { pair, ...parseDirectSpotBook(body, pair) };
  } catch (error) {
    if (signal?.aborted) throw error;
    const body = await fetchJson(`${EDGE_BASE}/market/display/spot-book/${pairSlug(pair)}`, signal);
    return { pair, ...parseEdgeSpotBook(body, pair) };
  }
}

export function parseDirectSpotCandles(payload: any): Candle[] {
  const rows = resultValue(payload);
  if (!Array.isArray(rows)) throw new Error('kraken_candle_shape');
  const seen = new Set<number>();
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const [time, open, high, low, close, _vwap, volume] = row;
    const values = [Number(time), Number(open), Number(high), Number(low), Number(close), Number(volume)];
    if (!values.every(Number.isFinite) || values[0] <= 0 || Math.min(...values.slice(1,5)) <= 0) continue;
    if (values[2] < Math.max(values[1], values[4]) || values[3] > Math.min(values[1], values[4]) || seen.has(values[0])) continue;
    seen.add(values[0]);
    candles.push({ time: values[0], open: values[1], high: values[2], low: values[3], close: values[4], volume: Math.max(0, values[5]) });
  }
  candles.sort((a,b)=>a.time-b.time);
  if (!candles.length) throw new Error('kraken_candle_empty');
  return candles;
}

function parseEdgeSpotCandles(payload: any, pair: string, interval: string): Candle[] {
  if (payload?.pair !== pair || payload?.interval !== interval || !Array.isArray(payload?.candles)) throw new Error('edge_spot_candle_identity');
  const candles = payload.candles.map((row: any) => {
    const candle = { time:Number(row?.time), open:Number(row?.open), high:Number(row?.high), low:Number(row?.low), close:Number(row?.close), volume:Number(row?.volume) };
    if (![candle.time,candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite)
      || candle.time <= 0 || Math.min(candle.open,candle.high,candle.low,candle.close) <= 0
      || candle.high < Math.max(candle.open,candle.close) || candle.low > Math.min(candle.open,candle.close)) throw new Error('edge_spot_candle_row');
    return candle;
  }).sort((a:Candle,b:Candle)=>a.time-b.time);
  if (!candles.length) throw new Error('edge_spot_candle_empty');
  return candles;
}

export async function getSpotPublicCandles(pair: string, interval: string, limit: number, signal?: AbortSignal, endTime?: number): Promise<{ candles: Candle[] }> {
  if (!/^[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}$/.test(pair) || !INTERVAL_MINUTES[interval] || !Number.isInteger(limit) || limit < 1) {
    throw new Error('Unsupported spot candle instrument');
  }

  // Spot chart currently has no historical backfill path, but keep the loader
  // contract truthful if a future caller requests an older window.
  if (endTime !== undefined) {
    const response = await fetchJson(`${API_BASE}/market/external/candles/${pairSlug(pair)}?interval=${encodeURIComponent(interval)}&limit=${Math.min(1000,limit)}`, signal);
    if (response?.pair !== pair || response?.interval !== interval || !Array.isArray(response?.candles)) throw new Error('Spot candles unavailable');
    return { candles: parseEdgeSpotCandles(response, pair, interval) };
  }

  if (!productionSite()) {
    const response = await fetchJson(`${API_BASE}/market/external/candles/${pairSlug(pair)}?interval=${encodeURIComponent(interval)}&limit=${Math.min(720,limit)}`, signal);
    return { candles: parseEdgeSpotCandles(response, pair, interval) };
  }

  try {
    const query = new URLSearchParams({ pair: krakenPair(pair), interval: String(INTERVAL_MINUTES[interval]) });
    const payload = await fetchJson(`${DIRECT_KRAKEN_BASE}/0/public/OHLC?${query}`, signal);
    const candles = parseDirectSpotCandles(payload);
    return { candles: candles.slice(-Math.min(720, limit)) };
  } catch (error) {
    if (signal?.aborted) throw error;
    const query = new URLSearchParams({ interval, limit:String(Math.min(720,limit)) });
    const payload = await fetchJson(`${EDGE_BASE}/market/display/spot-candles/${pairSlug(pair)}?${query}`, signal);
    return { candles: parseEdgeSpotCandles(payload, pair, interval) };
  }
}
