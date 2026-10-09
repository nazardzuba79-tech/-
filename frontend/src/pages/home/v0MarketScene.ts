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

// Exact coin-layout.ts coordinates in the 1619x971 reference, translated by
// the scene origin (490,80). No independently guessed scaling or orbit layout.
export const SCENE_SPOTS = [
  { x: 193, y: 282, r: 86 }, { x: 172, y: 58, r: 50 },
  { x: 318, y: 226, r: 52 }, { x: 80, y: 389, r: 53 },
  { x: 270, y: 120, r: 51 }, { x: 175, y: 476, r: 53 },
  { x: 88, y: 172, r: 51 }, { x: 297, y: 410, r: 51 },
] as const;
export const SCENE_WIDTH = 410;
export const SCENE_HEIGHT = 570;
export const MOBILE_SCENE_HEIGHT = 190;
export const MOBILE_SCENE_SPOTS = [
  { x: 56, y: 70, r: 43 }, { x: 156, y: 70, r: 43 },
  { x: 256, y: 70, r: 43 }, { x: 356, y: 70, r: 43 },
] as const;
export const STEP_SECONDS = 3;
export const SCENE_CYCLE_SECONDS = SCENE_INSTRUMENTS.length * STEP_SECONDS;

export type ScenePose = {
  x: number; y: number; z: number; r: number; opacity: number;
  rotationX: number; rotationY: number; rotationZ: number;
};
type Waypoint = { x: number; y: number; z: number; r: number };
// A single clockwise route through the approved anchors, with a foreground
// excursion through the centre. Each instrument keeps its own mesh and texture.
// The rear gate admits the next instrument only after the outgoing one recedes;
// the remaining roster travels invisibly behind the scene, never texture-swaps.
const desktopRoute: readonly Waypoint[] = [
  { x: 90, y: 440, r: 16, z: -220 },
  { ...SCENE_SPOTS[5], z: -80 }, { ...SCENE_SPOTS[7], z: -30 },
  { ...SCENE_SPOTS[2], z: 15 }, { ...SCENE_SPOTS[0], z: 110 },
  { ...SCENE_SPOTS[4], z: 30 }, { ...SCENE_SPOTS[1], z: -30 },
  { ...SCENE_SPOTS[6], z: -50 }, { ...SCENE_SPOTS[3], z: -70 },
  { x: 55, y: 470, r: 16, z: -220 },
];
const mobileRoute: readonly Waypoint[] = [
  { x: 10, y: 100, r: 12, z: -180 },
  { ...MOBILE_SCENE_SPOTS[0], r: 36, z: -30 },
  { ...MOBILE_SCENE_SPOTS[1], r: 50, z: 110 },
  { ...MOBILE_SCENE_SPOTS[2], r: 36, z: 0 },
  { ...MOBILE_SCENE_SPOTS[3], r: 34, z: -50 },
  { x: 399, y: 80, r: 12, z: -180 },
];
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Pure, periodic pose from the one active-time clock; no quotes or timers. */
export function scenePose(index: number, seconds: number, compact = false): ScenePose {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) % SCENE_CYCLE_SECONDS : 0;
  const count = SCENE_INSTRUMENTS.length;
  const phase = ((index - time / STEP_SECONDS + 4 + count) % count) - 4;
  const route = compact ? mobileRoute : desktopRoute;
  const first = compact ? -2 : -4, last = compact ? 3 : 5;
  const coordinate = Math.max(0, Math.min(route.length - 1, phase - first));
  const segment = Math.min(Math.floor(coordinate), route.length - 2);
  const a = route[segment], b = route[segment + 1], t = smooth(coordinate - segment);
  const z = mix(a.z, b.z, t);
  // Perspective scale while retaining the reference's orthographic composition.
  const focal = 900;
  const r = mix(a.r * (1 - a.z / focal), b.r * (1 - b.z / focal), t) / (1 - z / focal);
  const exit = first + 1, entry = last - 1;
  const opacity = phase < exit ? smooth((phase - exit + .45) / .45)
    : phase > entry ? smooth((entry + .45 - phase) / .45) : 1;
  return {
    x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z, r, opacity,
    rotationX: Math.sin(phase * 1.7) * .07,
    rotationY: .14 + Math.sin(phase * Math.PI / 4) * .22,
    rotationZ: -.04 + Math.sin(phase * 1.1) * .035,
  };
}

/** A rear label must not float over the face of a nearer medallion. */
export function sceneLabelOpacity(pose: ScenePose, poses: readonly ScenePose[], compact = false): number {
  const y = pose.y + pose.r * (compact ? 1.04 : 1.16) + 7;
  return poses.reduce((opacity, foreground) => {
    if (foreground.opacity < .9 || foreground.z <= pose.z) return opacity;
    const clearance = Math.hypot(pose.x - foreground.x, y - foreground.y) - foreground.r;
    return Math.min(opacity, smooth(clearance / 12));
  }, 1);
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
