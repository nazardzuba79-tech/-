import { readFileSync } from 'fs';
import { resolve } from 'path';
import { cfdDisplayState, cfdMarketCopy, formatCfdAsOf, formatCfdPrice, resolveCfdSymbol } from '../cfdPresentation';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, 'src', path), 'utf8');
const symbols = ['XAUUSD','XAGUSD','XPTUSD','XPDUSD','WTIUSD','XBRUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'];

test('all 13 canonical display instruments have deterministic professional precision', () => {
  for (const symbol of symbols) expect(formatCfdPrice('123.456789', symbol)).not.toBe('—');
  expect(formatCfdPrice('2400.125', 'XAUUSD')).toBe('2,400.13');
  expect(formatCfdPrice('72.1234', 'WTIUSD')).toBe('72.123');
  expect(formatCfdPrice('1.082145', 'EURUSD')).toBe('1.08215');
  expect(formatCfdPrice(null, 'EURUSD')).toBe('—');
});

test('display states communicate live, market closed, last quote and unavailable without inventing values', () => {
  const at = Date.UTC(2026, 8, 13, 9, 30);
  expect(cfdDisplayState({ price:'1', status:'live', stale:false, asOf:at }).label).toMatch(/^Live/);
  expect(cfdDisplayState({ price:'1', status:'market_closed', stale:false, asOf:at }).label).toMatch(/^Market closed/);
  expect(cfdDisplayState({ price:'1', status:'stale', stale:true, asOf:at }).label).toMatch(/^Last quote/);
  expect(cfdDisplayState({ price:null, status:'unavailable', stale:false, asOf:null })).toEqual({label:'Price unavailable',tone:'off'});
  expect(formatCfdAsOf(at)).toBe('09:30 UTC');
});

test('all seven supported languages have complete CFD and practice copy', () => {
  const langs=['ru','en','zh','es','hi','ja','ko'] as const;
  for(const lang of langs){
    const copy=cfdMarketCopy(lang);
    for(const value of Object.values(copy))expect(typeof value==='string'&&value.trim().length>0).toBe(true);
    expect(copy.practice.length).toBeGreaterThan(0);
    expect(copy.practiceNote.length).toBeGreaterThan(0);
    expect(cfdDisplayState({price:'1',status:'live',stale:false,asOf:null},lang).label).toBe(copy.live);
  }
});

test('CFD terminal exposes working practice controls but never financial execution calls', () => {
  const trade = read('pages/TradePage.tsx');
  const order = read('components/CfdOrderForm.tsx');
  const positions = read('components/CfdPositionsPanel.tsx');
  const store = read('lib/cfdPaperStore.ts');
  expect(trade).toContain('<CfdOrderForm');
  expect(trade).toContain('<CfdPositionsPanel');
  expect(order).toContain('openCfdPaperPosition');
  expect(order).toContain('<form');
  expect(order).toContain('type="submit"');
  expect(order).toContain('LeverageSlider');
  expect(positions).toContain('closeCfdPaperPosition');
  expect(positions).toContain("type Tab='open'|'history'");
  expect(store).toContain("voltex_cfd_practice_v1");
  expect(order).not.toMatch(/api\.openCfdPosition|getFuturesBalances/);
  expect(positions).not.toMatch(/getCfdPositions|getCfdPositionHistory|api\.closeCfdPosition/);
});

test('CFD chart uses same-origin real OHLC and not hosted TradingView', () => {
  const chart=read('components/CfdChart.tsx');
  expect(chart).toContain('/cfd/candles/');
  expect(chart).toContain('CandlestickSeries');
  expect(chart).toContain('createChart');
  expect(chart).not.toContain('TradingViewAdvancedChart');
});

test('homepage GOLD and OIL use routed XAU and exact WTI display rows', () => {
  const hero = read('pages/home/HomeHeroAssets.tsx');
  expect(hero).toMatch(/row\s*=>\s*row\.symbol\s*===\s*['"]XAUUSD['"]/);
  expect(hero).toMatch(/row\s*=>\s*row\.symbol\s*===\s*['"]WTIUSD['"]/);
  expect(hero).not.toMatch(/key:\s*['"]oil['"][\s\S]{0,120}price:\s*null/);
});

test('deep links resolve only to listed canonical instruments', () => {
  const tickers = symbols.map(symbol => ({symbol}));
  expect(resolveCfdSymbol('WTIUSD', tickers)).toBe('WTIUSD');
  expect(resolveCfdSymbol('NOTREAL', tickers)).toBe('XAUUSD');
  expect(resolveCfdSymbol('XBRUSD', [])).toBe('XBRUSD');
});
