import { createSceneSequence, SCENE_INSTRUMENTS, SCENE_SPOTS, scenePrice, sceneQuote } from '../../pages/home/v0MarketScene';
import { medallionSvg } from '../../pages/home/v0MedallionArtwork';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { cfdDisplayState } from '../cfdPresentation';

const market = (overrides: Record<string, unknown> = {}): any => ({
  tickers: [{ pair: 'BTC/USDT', price: 76746 }, { pair: 'XAU/USDT', price: 99999 }],
  tickersStale: false,
  cfd: { tickers: [{ symbol: 'XAUUSD', price: '4349.19', status: 'sampled', stale: true }] },
  ...overrides,
});
const instrument = (id: string) => SCENE_INSTRUMENTS.find(x => x.id === id)!;

test('approved roster retains all 24 unique instruments, not a new trading catalogue', () => {
  expect(SCENE_INSTRUMENTS).toHaveLength(24);
  expect(new Set(SCENE_INSTRUMENTS.map(x => x.id)).size).toBe(24);
  expect(SCENE_INSTRUMENTS.filter(x => x.market === 'stock').map(x => x.id)).toEqual(['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META']);
});

test.each([4, 8])('bounded deterministic %i-slot sequence covers every instrument without duplicates over repeated cycles', count => {
  const sequence = createSceneSequence(count);
  const seen = new Set(sequence.visible);
  for (let step = 0; step < 240; step++) {
    const { slot, id } = sequence.next();
    expect(slot).toBe(step % count);
    expect(sequence.visible[slot]).toBe(id);
    expect(new Set(sequence.visible).size).toBe(count);
    seen.add(id);
    if (step === 23) expect(seen.size).toBe(24);
  }
});

test('quotes use the shared spot/CFD snapshot without mixing price domains', () => {
  expect(sceneQuote(instrument('BTCUSDT'), market(), 'ru').price).toBe(76746);
  expect(sceneQuote(instrument('XAUUSD'), market(), 'ru').price).toBe(4349.19);
  expect(sceneQuote(instrument('XAUUSD'), market({ cfd: null }), 'ru').price).toBeNull();
  expect(sceneQuote(instrument('BTCUSDT'), market({ tickersStale: true }), 'ru').state).toBe('stale');
  expect(instrument('WTI').symbol).toBe('WTIUSD');
  expect(instrument('BRENT').symbol).toBe('XBRUSD');
});

test('stocks and absent CFD instruments never inherit demo, spot or made-up tradable prices', () => {
  const m = market({ tickers: [{ pair: 'AAPL', price: 123 }], cfd: { tickers: [{ symbol: 'AAPL', price: '123', status: 'live' }] } });
  for (const row of SCENE_INSTRUMENTS.filter(x => x.market === 'stock')) expect(sceneQuote(row, m, 'en').price).toBeNull();
  for (const id of ['US500', 'NAS100']) expect(sceneQuote(instrument(id), m, 'en').price).toBeNull();
});

test.each([null, undefined, '', 'NaN', 'Infinity', '-1', '0'])('invalid snapshot value %p stays unavailable', price => {
  expect(sceneQuote(instrument('BTCUSDT'), market({ tickers: [{ pair: 'BTC/USDT', price }], tickersStale: true }), 'en')).toEqual({ price: null, state: 'unavailable' });
  for (const lang of ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko']) {
    expect(sceneQuote(instrument('XAUUSD'), market({ cfd: { tickers: [{ symbol: 'XAUUSD', price, status: 'sampled' }] } }), lang)).toEqual({ price: null, state: cfdDisplayState(undefined, lang).label });
  }
  expect(scenePrice(null, 'ru')).toBe('—');
});

test('CFD error quotes fail closed, market closed/sampled values retain the existing status', () => {
  const cfd = (status: string) => market({ cfd: { tickers: [{ symbol: 'XAUUSD', price: '4349.19', status }] } });
  expect(sceneQuote(instrument('XAUUSD'), cfd('error'), 'en')).toEqual({ price: null, state: cfdDisplayState(undefined, 'en').label });
  expect(sceneQuote(instrument('XAUUSD'), cfd('market_closed'), 'en')).toEqual({ price: 4349.19, state: 'Market closed' });
});

test('scene has no network/pricing scheduler and keeps live terminal, real links and source artwork', () => {
  const source = (name: string) => readFileSync(resolve(__dirname, '../../pages/home', name), 'utf8');
  const files = ['v0MarketScene.ts', 'v0CoinRenderer.ts', 'HomeV0Coins.tsx'].map(source).join('\n');
  expect(files).not.toMatch(/\bfetch\s*\(|new WebSocket|setInterval|demo.quotes|Math\.random|https:\/\//);
  const hero = source('HomeSapphireHero.tsx');
  expect(hero).toContain('<SapphireTerminal market={market}/>');
  expect(hero).toContain('/hero/v0-reference-clean.png');
  expect(hero).not.toContain('/hero/sapphire-refined.png');
  expect(hero).toContain('<HomeSapphireTape market={market}/>');
  for (const route of ['/trade', '/markets', '/futures', '/copy-trading', '/card']) expect(hero).toContain(`to="${route}"`);
  const renderer = source('v0CoinRenderer.ts');
  for (const cleanup of ['cancelAnimationFrame', 'observer.disconnect()', 'resource.dispose()', 'renderer.dispose()', 'renderer.forceContextLoss()', 'renderer.domElement.remove()']) expect(renderer).toContain(cleanup);
  expect(source('HomeV0Coins.tsx')).toContain('prefers-reduced-motion: reduce');
  expect(source('HomeV0Coins.tsx')).toContain('document.hidden');
  for (const section of ['HomeHeader', 'HomeMarketOverview', 'HomeCardTravel', 'HomeTradingSessions', 'HomeHeatmap', 'HomeMarkets', 'HomeEcosystem', 'HomeFaq', 'HomeFooter']) expect(source('HomePage.tsx')).toContain(`<${section}`);
});

test('desktop coin geometry uses the exact archive positions, not the rejected composition', () => {
  expect(SCENE_SPOTS.map(s => [s.x + 490, s.y + 80, s.r])).toEqual([
    [683,362,86], [662,138,50], [808,306,52], [570,469,53],
    [760,200,51], [665,556,53], [578,252,51], [787,490,51],
  ]);
  const renderer = readFileSync(resolve(__dirname, '../../pages/home/v0CoinRenderer.ts'), 'utf8');
  expect(renderer).not.toMatch(/fillText|platformX|glowTexture/);
  expect(renderer).toContain('CylinderGeometry');
  expect(renderer).toContain('TorusGeometry');
  expect(renderer).toContain('if (cancelled()) return null');
  const component = readFileSync(resolve(__dirname, '../../pages/home/HomeV0Coins.tsx'), 'utf8');
  expect(component).toContain('if (disposed || !scene)');
  expect(component).not.toContain('v0-pedestal-fallback');
});

test.each(SCENE_INSTRUMENTS)('local %s face uses vector relief, no demo prices or category labels', instrument => {
  const svg = medallionSvg(instrument);
  expect(svg).toContain('linearGradient');
  expect(svg).toContain('<path');
  expect(svg).not.toMatch(/STOCKS|CRYPTO|CFD|104,235|https:|<script|<image/);
  expect(svg).toContain('width="256"');
});

test('context loss reveals fallback and cannot resume GPU work until a fresh mount', () => {
  const css = readFileSync(resolve(__dirname, '../../pages/home/home-v0-approved.css'), 'utf8');
  expect(css).toMatch(/\[data-ready=false\] \.v0-coin-canvas\s*\{\s*visibility:\s*hidden/);
  const renderer = readFileSync(resolve(__dirname, '../../pages/home/v0CoinRenderer.ts'), 'utf8');
  expect(renderer).toContain('contextLost = true');
  expect(renderer).toContain('if (disposed || contextLost || active === value) return');
  expect(renderer).toContain('if (disposed || contextLost) return');
});
