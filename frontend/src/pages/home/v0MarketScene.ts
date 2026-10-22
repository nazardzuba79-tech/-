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

// Twenty distinct owner-selected assets TOTAL: BTC centre, then rings of 6/6/7.
// Keep the existing quote roster/domain mapping independent of presentation.
const HERO_IDS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'NFLX', 'AMD',
  'TRXUSDT', 'AAPL', 'NVDA', 'TSLA', 'META', 'AMZN',
  'MSFT', 'US500', 'NAS100', 'EURUSD', 'XAUUSD', 'WTI', 'USDJPY'];
export const HERO_INSTRUMENTS: readonly SceneInstrument[] = HERO_IDS.map(id => {
  // Presentation-only stock identities; no new quote subscription or trading entry.
  if (id === 'NFLX' || id === 'AMD') return { id, ticker: id, market: 'stock', symbol: id, metal: 'graphite' };
  return SCENE_INSTRUMENTS.find(item => item.id === id)!;
});
export const HERO_ICONS: Readonly<Record<string, string>> = {
  BTCUSDT: 'btc', ETHUSDT: 'eth', SOLUSDT: 'sol', XRPUSDT: 'xrp', BNBUSDT: 'bnb', NFLX: 'netflix', AMD: 'amd',
  TRXUSDT: 'trx', AAPL: 'apple', NVDA: 'nvidia', TSLA: 'tesla', META: 'meta', AMZN: 'amazon', MSFT: 'microsoft',
  US500: 'us500', NAS100: 'nas100', EURUSD: 'eurusd', XAUUSD: 'gold', WTI: 'oil', USDJPY: 'usdjpy',
};
const MOBILE_IDS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'AAPL', 'NVDA', 'TSLA', 'META',
  'MSFT', 'US500', 'EURUSD', 'XAUUSD']);
export function heroInstruments(compact = false) {
  return compact ? HERO_INSTRUMENTS.filter(item => MOBILE_IDS.has(item.id)) : HERO_INSTRUMENTS;
}
export const SCENE_WIDTH = 410;
export const SCENE_HEIGHT = 570;
export const MOBILE_SCENE_HEIGHT = 430;
export const ORBITS = [
  { rx: 72, ry: 107, mobileRy: 85, period: 14, direction: 1, phase: -.8, count: 6, mobileCount: 3 },
  { rx: 124, ry: 179, mobileRy: 139, period: 19, direction: -1, phase: -1.2, count: 6, mobileCount: 4 },
  { rx: 177, ry: 251, mobileRy: 190, period: 25, direction: 1, phase: -1.5, count: 7, mobileCount: 4 },
] as const;

export function orbitRing(index: number, compact = false) {
  if (index === 0) return 0;
  let end = 0;
  for (let ring = 0; ring < ORBITS.length; ring++) {
    end += compact ? ORBITS[ring].mobileCount : ORBITS[ring].count;
    if (index <= end) return ring + 1;
  }
  throw new RangeError('Hero asset index outside the visible roster');
}

/** Three steady ellipses. Only position changes; logos always remain upright. */
export function orbitPose(index: number, seconds: number, compact = false) {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const cx = 205, cy = compact ? 214 : 280;
  if (index === 0) return {
    x: cx, y: cy, radius: 39, scale: 1, depth: 0, rotation: 0,
  };
  const ring = orbitRing(index, compact) - 1;
  const orbit = ORBITS[ring];
  const preceding = ORBITS.slice(0, ring).reduce((sum, item) => sum + (compact ? item.mobileCount : item.count), 0);
  const count = compact ? orbit.mobileCount : orbit.count;
  const angle = orbit.phase + (index - preceding - 1) * Math.PI * 2 / count + t * Math.PI * 2 / orbit.period * orbit.direction;
  return {
    x: cx + Math.cos(angle) * orbit.rx,
    y: cy + Math.sin(angle) * (compact ? orbit.mobileRy : orbit.ry),
    radius: compact ? 23 : 24, scale: 1, depth: 0, rotation: 0,
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
