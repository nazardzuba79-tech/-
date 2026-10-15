/**
 * CFD asset identity (2026-10-15): one registry for every place that shows a
 * CFD instrument — the market list, the information strip, the homepage
 * markets block, the compare list and the extra chart panes.
 *
 * What identifies each instrument is a real designation, never an invented
 * brand: currency pairs by the flags of the two currencies' issuers (the euro
 * by the EU flag), precious metals by their chemical element symbol (Au, Ag,
 * Pt, Pd), the two oil benchmarks by their benchmark name (WTI, Brent). None
 * of these instruments has a corporate logo, and none is drawn.
 *
 * The flags are the flag-icons set (MIT, lipis/flag-icons 7.5.0, square
 * 1x1 variant) shipped with the bundle under assets/cfd-flags — each file is
 * a few hundred bytes, which Vite inlines, so a list of thirteen rows makes
 * no image request at all. The licence travels with them.
 */
import type { CfdUiLang } from './cfdDisplayCopy';

export type CfdAssetClass = 'metals' | 'energy' | 'forex';
export type CfdCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'NZD';

export interface CfdAssetIdentity {
  symbol: string;
  assetClass: CfdAssetClass;
  /** Base and quote of the price (XAU per USD, EUR per USD). */
  base: string;
  quote: CfdCurrency;
  /** The designation shown on the mark: the element symbol or the benchmark. */
  mark: string;
  /** Short readable names per language; the full provider name stays in the tooltip. */
  names: Record<CfdUiLang, string>;
}

const n = (ru: string, en: string, es: string, zh: string, ja: string, ko: string, hi: string): Record<CfdUiLang, string> => ({ ru, en, es, zh, ja, ko, hi });

/** Catalogue order (src/services/marketData/cfd/catalog.ts): metals, energy, FX majors. */
export const CFD_ASSETS: readonly CfdAssetIdentity[] = Object.freeze([
  { symbol: 'XAUUSD', assetClass: 'metals', base: 'XAU', quote: 'USD', mark: 'Au', names: n('Золото', 'Gold', 'Oro', '黄金', '金', '금', 'सोना') },
  { symbol: 'XAGUSD', assetClass: 'metals', base: 'XAG', quote: 'USD', mark: 'Ag', names: n('Серебро', 'Silver', 'Plata', '白银', '銀', '은', 'चांदी') },
  { symbol: 'XPTUSD', assetClass: 'metals', base: 'XPT', quote: 'USD', mark: 'Pt', names: n('Платина', 'Platinum', 'Platino', '铂金', 'プラチナ', '백금', 'प्लैटिनम') },
  { symbol: 'XPDUSD', assetClass: 'metals', base: 'XPD', quote: 'USD', mark: 'Pd', names: n('Палладий', 'Palladium', 'Paladio', '钯金', 'パラジウム', '팔라듐', 'पैलेडियम') },
  { symbol: 'WTIUSD', assetClass: 'energy', base: 'WTI', quote: 'USD', mark: 'WTI', names: n('Нефть WTI', 'WTI crude oil', 'Petróleo WTI', 'WTI 原油', 'WTI原油', 'WTI 원유', 'WTI कच्चा तेल') },
  { symbol: 'XBRUSD', assetClass: 'energy', base: 'XBR', quote: 'USD', mark: 'Brent', names: n('Нефть Brent', 'Brent crude oil', 'Petróleo Brent', '布伦特原油', 'ブレント原油', '브렌트유', 'ब्रेंट कच्चा तेल') },
  { symbol: 'EURUSD', assetClass: 'forex', base: 'EUR', quote: 'USD', mark: 'EUR', names: n('Евро', 'Euro', 'Euro', '欧元', 'ユーロ', '유로', 'यूरो') },
  { symbol: 'GBPUSD', assetClass: 'forex', base: 'GBP', quote: 'USD', mark: 'GBP', names: n('Британский фунт', 'British pound', 'Libra esterlina', '英镑', '英ポンド', '영국 파운드', 'ब्रिटिश पाउंड') },
  { symbol: 'USDJPY', assetClass: 'forex', base: 'USD', quote: 'JPY', mark: 'JPY', names: n('Японская иена', 'Japanese yen', 'Yen japonés', '日元', '日本円', '일본 엔', 'जापानी येन') },
  { symbol: 'AUDUSD', assetClass: 'forex', base: 'AUD', quote: 'USD', mark: 'AUD', names: n('Австралийский доллар', 'Australian dollar', 'Dólar australiano', '澳元', '豪ドル', '호주 달러', 'ऑस्ट्रेलियाई डॉलर') },
  { symbol: 'USDCAD', assetClass: 'forex', base: 'USD', quote: 'CAD', mark: 'CAD', names: n('Канадский доллар', 'Canadian dollar', 'Dólar canadiense', '加元', 'カナダドル', '캐나다 달러', 'कनाडाई डॉलर') },
  { symbol: 'USDCHF', assetClass: 'forex', base: 'USD', quote: 'CHF', mark: 'CHF', names: n('Швейцарский франк', 'Swiss franc', 'Franco suizo', '瑞士法郎', 'スイスフラン', '스위스 프랑', 'स्विस फ़्रैंक') },
  { symbol: 'NZDUSD', assetClass: 'forex', base: 'NZD', quote: 'USD', mark: 'NZD', names: n('Новозеландский доллар', 'New Zealand dollar', 'Dólar neozelandés', '新西兰元', 'NZドル', '뉴질랜드 달러', 'न्यूज़ीलैंड डॉलर') },
] as CfdAssetIdentity[]);

const BY_SYMBOL = new Map(CFD_ASSETS.map(asset => [asset.symbol, asset]));
export const CFD_SYMBOLS: readonly string[] = Object.freeze(CFD_ASSETS.map(asset => asset.symbol));
export const CFD_ASSET_CLASSES: readonly CfdAssetClass[] = Object.freeze(['metals', 'energy', 'forex']);

export const cfdAsset = (symbol: string): CfdAssetIdentity | null => BY_SYMBOL.get(symbol.toUpperCase()) ?? null;

/** The readable name in the viewer's language; the provider's own name, then the symbol, when the registry has none. */
export function cfdAssetName(symbol: string, lang: string, fallback?: string | null): string {
  const asset = cfdAsset(symbol);
  if (asset) return asset.names[(lang as CfdUiLang)] ?? asset.names.en;
  return fallback && fallback.trim() ? fallback : symbol;
}

/** Issuer flag (flag-icons code) of each currency the catalogue quotes. */
export const CURRENCY_FLAG: Record<CfdCurrency, 'us' | 'eu' | 'gb' | 'jp' | 'au' | 'ca' | 'ch' | 'nz'> = Object.freeze({
  USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', AUD: 'au', CAD: 'ca', CHF: 'ch', NZD: 'nz',
});
export const isCfdCurrency = (code: string): code is CfdCurrency => Object.prototype.hasOwnProperty.call(CURRENCY_FLAG, code);
