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

// Coordinates adapted from coin-layout.ts, retaining its eight-medallion cluster.
export const SCENE_SPOTS = [
  { x: 193, y: 282, r: 78 }, { x: 172, y: 58, r: 45 },
  { x: 318, y: 226, r: 47 }, { x: 80, y: 389, r: 48 },
  { x: 270, y: 120, r: 46 }, { x: 175, y: 476, r: 48 },
  { x: 88, y: 172, r: 46 }, { x: 307, y: 410, r: 46 },
] as const;
export const SCENE_WIDTH = 410;
export const SCENE_HEIGHT = 720;
export const MOBILE_SCENE_HEIGHT = 380;
export const MOBILE_SCENE_SPOTS = [
  { x: 225, y: 154, r: 68 }, { x: 94, y: 68, r: 42 },
  { x: 333, y: 59, r: 43 }, { x: 81, y: 224, r: 42 },
] as const;
export const STEP_SECONDS = 1.6;
export const FLIP_SECONDS = 1.15;

// One queue; the outgoing slot is replaced only at the edge-on midpoint.
// Queue order, not random selection, guarantees coverage and no duplicates.
export function createSceneSequence(count = 8) {
  const visible = SCENE_INSTRUMENTS.slice(0, count).map(x => x.id);
  const queue = SCENE_INSTRUMENTS.slice(count).map(x => x.id);
  let step = 0;
  return {
    visible,
    next() {
      const slot = step++ % count;
      const id = queue.shift()!;
      queue.push(visible[slot]);
      visible[slot] = id;
      return { slot, id };
    },
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
    return { price: positive(ticker?.price), state: market.tickersStale ? 'stale' : 'snapshot' };
  }
  const ticker = market.cfd?.tickers.find(x => x.symbol === instrument.symbol);
  const state = cfdDisplayState(ticker, lang);
  // Never take a spot quote as a substitute for CFD or turn a missing catalogue
  // entry into a synthetic price. Error quotes fail closed even if cached price exists.
  const valid = ticker && ['live', 'sampled', 'stale', 'market_closed'].includes(ticker.status ?? '');
  return { price: valid ? positive(ticker.price) : null, state: state.label };
}

export function scenePrice(price: number | null, lang: string) {
  if (price === null) return '—';
  return new Intl.NumberFormat(lang, { maximumFractionDigits: price >= 100 ? 2 : price >= 1 ? 4 : 6 }).format(price);
}
