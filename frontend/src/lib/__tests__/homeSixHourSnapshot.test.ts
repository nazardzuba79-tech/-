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
  // The badge's wording changed ("Stale"/"6h snapshot" named the cache
  // rather than the cadence), but what this guard protects did not: the
  // badge still states the six-hour cadence on its face, which a page
  // fed by a live socket could not say.
  expect(terminal).toContain("stale?'Delayed':'Updated every 6h'");
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

test('homepage paints its last-good snapshot synchronously, keyed by version, on the same six-hour clock', () => {
  const market = read('useHomeMarket.ts');
  const snapshot = read('homeMarketSnapshot.ts');
  expect(snapshot).toContain("export const HOME_SNAPSHOT_KEY = 'voltex.home.market.v1'");
  expect(snapshot).toContain('export const HOME_SNAPSHOT_VERSION = 1');
  // Read once, synchronously, in a state initializer: on screen from the
  // first render, before any effect could issue a request.
  expect(market).toContain('useState<HydratedHomeMarket>(() => readHomeSnapshot(browserStorage(), Date.now()))');
  expect(market.indexOf('readHomeSnapshot(')).toBeLessThan(market.indexOf('useEffect('));
  // Snapshot freshness and the refresh cadence are the same number.
  expect(market).toContain('isFreshObservation(observedAt, now, HOME_MARKET_REFRESH_MS)');
  // Nothing about request state is ever written as data.
  expect(snapshot).not.toMatch(/'(loading|error|refreshing)'/);
});
