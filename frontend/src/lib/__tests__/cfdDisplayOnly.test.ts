import { readFileSync } from 'fs';
import { resolve } from 'path';
import { cfdDisplayState, formatCfdAsOf, formatCfdPrice, resolveCfdSymbol } from '../cfdPresentation';

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

test('CFD terminal is visibly read-only market data, not an order-entry surface', () => {
  const trade = read('pages/TradePage.tsx');
  const formerOrderPanel = read('components/CfdOrderForm.tsx');
  const formerPositionsPanel = read('components/CfdPositionsPanel.tsx');
  expect(trade).toContain('<CfdInstrumentList');
  expect(trade).toContain('<CfdTickerBar');
  expect(trade).toContain('<CfdChart');
  expect(formerOrderPanel).toContain('<CfdMarketOverview');
  expect(formerOrderPanel).not.toContain('openCfdPosition');
  expect(formerOrderPanel).not.toContain('getFuturesBalances');
  expect(formerPositionsPanel).toContain('Market data coverage');
  expect(formerPositionsPanel).not.toContain('closeCfdPosition');
  expect(formerPositionsPanel).not.toContain('getCfdPositions');
});

test('homepage GOLD and OIL use routed XAU and exact WTI display rows', () => {
  const hero = read('pages/home/HomeHeroAssets.tsx');
  expect(hero).toContain("row.symbol === 'XAUUSD'");
  expect(hero).toContain("row.symbol === 'WTIUSD'");
  expect(hero).not.toMatch(/key:\s*'oil'[\s\S]{0,120}price:\s*null/);
});

test('market overview discloses update time and multi-source routing', () => {
  const overview = read('components/CfdMarketOverview.tsx');
  expect(overview).toContain('Updated');
  expect(overview).toContain('Multi-source');
  expect(overview).toContain('Missing data stays unavailable instead of being estimated');
});

test('deep links resolve only to listed canonical instruments', () => {
  const tickers = symbols.map(symbol => ({symbol}));
  expect(resolveCfdSymbol('WTIUSD', tickers)).toBe('WTIUSD');
  expect(resolveCfdSymbol('NOTREAL', tickers)).toBe('XAUUSD');
  expect(resolveCfdSymbol('XBRUSD', [])).toBe('XBRUSD');
});
