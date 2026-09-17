import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, 'src/pages/home', file), 'utf8');

test('homepage public market surfaces use one six-hour quote cadence', () => {
  const market = read('useHomeMarket.ts');
  expect(market).toContain('export const HOME_MARKET_REFRESH_MS = 6 * 60 * 60 * 1000');
  expect(market).toContain('window.setInterval(refresh, HOME_MARKET_REFRESH_MS)');
  expect(market).not.toContain('15_000');
});

test('homepage hero does not open a real-time market socket', () => {
  const hero = read('HomeSapphireHero.tsx');
  const terminal = read('SapphireTerminal.tsx');
  expect(hero).not.toContain('useHeroStream');
  expect(hero).toContain('<SapphireTerminal market={market}/>');
  expect(terminal).toContain("stale?'Stale':'6h snapshot'");
  expect(terminal).not.toContain("'15s refresh'");
});

test('popular-assets sparklines never synthesize a price path', () => {
  const markets = read('HomeMarkets.tsx');
  expect(markets).toContain("market.priceHistory[r.historyKey]");
  expect(markets).toContain("market.cfdPriceHistory?.[r.historyKey]");
  expect(markets).not.toContain('function sparkFor');
});

test('laptop chart motion changes geometry only, never received OHLC values', () => {
  const css = read('home-six-hour-market.css');
  expect(css).toContain('.vx-real-candles');
  expect(css).toContain('translate3d');
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  expect(css).not.toMatch(/price|open|high|low|close\s*:/i);
});
