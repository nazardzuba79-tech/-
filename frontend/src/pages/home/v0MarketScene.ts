import type { HomeMarket } from './useHomeMarket';
import { cfdDisplayState } from '../../lib/cfdPresentation';

export type SceneInstrument = {
  id: string;
  ticker: string;
  market: 'spot' | 'cfd' | 'stock';
  symbol: string;
  metal: 'gold' | 'silver' | 'graphite';
};

// The owner's v0 archive contains these 24 instruments. This is a visual roster,
// NOT a trading catalogue. A medallion never grants execution availability.
export const SCENE_INSTRUMENTS: readonly SceneInstrument[] = [
  { id: 'BTCUSDT', ticker: 'BTC', market: 'spot', symbol: 'BTC/USDT', metal: 'gold' },
  { id: 'AAPL', ticker: 'AAPL', market: 'stock', symbol: 'AAPL', metal: 'silver' },
  { id: 'XAUUSD', ticker: 'XAU', market: 'cfd', symbol: 'XAUUSD', metal: 'gold' },
  { id: 'ETHUSDT', ticker: 'ETH', market: 'spot', symbol: 'ETH/USDT', metal: 'silver' },
  { id: 'NVDA', ticker: 'NVDA', market: 'stock', symbol: 'NVDA', metal: 'graphite' },
  { id: 'US500', ticker: 'US500', market: 'cfd', symbol: 'US500', metal: 'silver' },
  { id: 'WTI', ticker: 'WTI', market: 'cfd', symbol: 'WTIUSD', metal: 'graphite' },
  { id: 'EURUSD', ticker: 'EUR/USD', market: 'cfd', symbol: 'EURUSD', metal: 'silver' },
  { id: 'SOLUSDT', ticker: 'SOL', market: 'spot', symbol: 'SOL/USDT', metal: 'graphite' },
  { id: 'XRPUSDT', ticker: 'XRP', market: 'spot', symbol: 'XRP/USDT', metal: 'silver' },
  { id: 'MSFT', ticker: 'MSFT', market: 'stock', symbol: 'MSFT', metal: 'silver' },
  { id: 'BNBUSDT', ticker: 'BNB', market: 'spot', symbol: 'BNB/USDT', metal: 'gold' },
  { id: 'TSLA', ticker: 'TSLA', market: 'stock', symbol: 'TSLA', metal: 'graphite' },
  { id: 'ADAUSDT', ticker: 'ADA', market: 'spot', symbol: 'ADA/USDT', metal: 'silver' },
  { id: 'XAGUSD', ticker: 'XAG', market: 'cfd', symbol: 'XAGUSD', metal: 'silver' },
  { id: 'AMZN', ticker: 'AMZN', market: 'stock', symbol: 'AMZN', metal: 'gold' },
  { id: 'DOGEUSDT', ticker: 'DOGE', market: 'spot', symbol: 'DOGE/USDT', metal: 'gold' },
  { id: 'GBPUSD', ticker: 'GBP/USD', market: 'cfd', symbol: 'GBPUSD', metal: 'silver' },
  { id: 'GOOGL', ticker: 'GOOGL', market: 'stock', symbol: 'GOOGL', metal: 'silver' },
  { id: 'TRXUSDT', ticker: 'TRX', market: 'spot', symbol: 'TRX/USDT', metal: 'graphite' },
  { id: 'BRENT', ticker: 'BRENT', market: 'cfd', symbol: 'XBRUSD', metal: 'gold' },
  { id: 'META', ticker: 'META', market: 'stock', symbol: 'META', metal: 'silver' },
  { id: 'USDJPY', ticker: 'USD/JPY', market: 'cfd', symbol: 'USDJPY', metal: 'silver' },
  { id: 'NAS100', ticker: 'NAS100', market: 'cfd', symbol: 'NAS100', metal: 'graphite' },
];

// The revised hero uses the eight owner-selected markets; the full quote roster stays intact.
export const HERO_INSTRUMENTS = SCENE_INSTRUMENTS.slice(0, 8);
export const SCENE_WIDTH = 410;
export const SCENE_HEIGHT = 570;
export const MOBILE_SCENE_HEIGHT = 320;
export const ORBITS = [
  { rx: 143, ry: 209, period: 29, phase: -1.57 },
  { rx: 149, ry: 201, period: 25, phase: -.67 },
  { rx: 145, ry: 214, period: 33, phase: .23 },
  { rx: 151, ry: 205, period: 27, phase: 1.13 },
  { rx: 147, ry: 216, period: 35, phase: 2.03 },
  { rx: 152, ry: 204, period: 31, phase: 2.93 },
  { rx: 144, ry: 211, period: 37, phase: 3.83 },
] as const;

/** Continuous analytic paths: no keyframe stops, slot swaps or texture changes. */
export function orbitPose(index: number, seconds: number, compact = false) {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const cx = 205, cy = compact ? 148 : 270;
  if (index === 0) return {
    x: cx + Math.sin(t * .7) * 5, y: cy + Math.sin(t * .9) * 7,
    radius: compact ? 43 : 69, scale: 1, depth: 0, rotation: Math.sin(t * .6) * 2,
  };
  const orbit = ORBITS[index - 1];
  // Bounded per-asset speed modulation preserves spacing instead of letting faster
  // neighbours lap and obscure each other. All velocities remain non-zero.
  const angle = orbit.phase + t * Math.PI * 2 / 28 + .10 * Math.sin(t * Math.PI * 2 / orbit.period + orbit.phase);
  const depth = Math.sin(angle);
  return {
    x: cx + Math.cos(angle) * orbit.rx + Math.sin(t * 1.2 + index) * 2,
    y: cy + depth * orbit.ry * (compact ? .48 : 1) + Math.sin(t * .85 + index) * 3,
    radius: compact ? 23 : 35,
    scale: 1 + depth * .09,
    depth,
    rotation: Math.sin(t * .6 + index) * 2.5,
  };
}

const positive = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function sceneQuote(instrument: SceneInstrument, market: HomeMarket, lang: string) {
  if (instrument.market === 'stock') return { price: null, state: 'unavailable' };
  if (instrument.market === 'spot') {
    const ticker = market.tickers.find(x => x.pair === instrument.symbol);
    const price = positive(ticker?.price);
    return { price, state: price === null ? 'unavailable' : market.tickersStale ? 'stale' : 'snapshot' };
  }
  const ticker = market.cfd?.tickers.find(x => x.symbol === instrument.symbol);
  const state = cfdDisplayState(ticker, lang);
  // Never take a spot quote as a substitute for CFD or turn a missing catalogue
  // entry into a synthetic price. Error quotes fail closed even if cached price exists.
  const valid = ticker && ['live', 'sampled', 'stale', 'market_closed'].includes(ticker.status ?? '');
  const price = valid ? positive(ticker.price) : null;
  return { price, state: price === null ? cfdDisplayState(undefined, lang).label : state.label };
}

export function scenePrice(price: number | null, lang: string) {
  if (price === null) return '—';
  return new Intl.NumberFormat(lang, { maximumFractionDigits: price >= 100 ? 2 : price >= 1 ? 4 : 6 }).format(price);
}
