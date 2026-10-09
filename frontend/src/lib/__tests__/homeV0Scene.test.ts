import { HERO_INSTRUMENTS, ORBITS, orbitPose, SCENE_INSTRUMENTS, scenePrice, sceneQuote } from '../../pages/home/v0MarketScene';
import { createCoinScene } from '../../pages/home/v0CoinRenderer';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { cfdDisplayState } from '../../lib/cfdPresentation';
const market = (overrides: Record<string, unknown> = {}): any => ({
  tickers: [{ pair: 'BTC/USDT', price: 76746 }, { pair: 'XAU/USDT', price: 99999 }],
  tickersStale: false,
  cfd: { tickers: [{ symbol: 'XAUUSD', price: '4349.19', status: 'sampled', stale: true }] },
  ...overrides,
});
const instrument = (id: string) => SCENE_INSTRUMENTS.find(x => x.id === id)!;

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


test('eight requested hero markets; unchanged 24-entry quote roster', () => {
  expect(HERO_INSTRUMENTS.map(x => x.id)).toEqual(['BTCUSDT','AAPL','XAUUSD','ETHUSDT','NVDA','US500','WTI','EURUSD']);
  expect(SCENE_INSTRUMENTS).toHaveLength(24);
  expect(new Set(ORBITS.map(x => x.period)).size).toBe(7);
  expect(new Set(ORBITS.map(x => x.phase)).size).toBe(7);
});
test.each([false, true])('all satellite paths move continuously, without keyframe stops: compact=%s', compact => {
  for (let t = 0; t < 120; t += .17) for (let i = 1; i < 8; i++) {
    const a = orbitPose(i, t, compact), b = orbitPose(i, t + 1 / 30, compact);
    const speed = Math.hypot(b.x - a.x, b.y - a.y);
    expect(speed).toBeGreaterThan(.35);
    expect(speed).toBeLessThan(2);
    expect(a.x - a.radius * a.scale).toBeGreaterThan(0);
    expect(a.x + a.radius * a.scale).toBeLessThan(410);
    expect(a.y - a.radius * a.scale).toBeGreaterThan(0);
    expect(a.y + a.radius * a.scale + 30).toBeLessThan(compact ? 320 : 570);
    const btc = orbitPose(0, t, compact);
    expect(btc.radius).toBeGreaterThan(a.radius * 1.7);
    expect(Math.hypot(a.x - btc.x, a.y - btc.y)).toBeGreaterThan(btc.radius + a.radius);
  }
});
test.each([false,true])('visible movement within one second and BTC stays dominant: compact=%s', compact => {
  for (let i=1;i<8;i++) {
    const a=orbitPose(i,0,compact), b=orbitPose(i,1,compact);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(15);
  }
  expect(orbitPose(0,1,compact).x).not.toBe(orbitPose(0,0,compact).x);
  expect(orbitPose(0,50,compact).x).toBeGreaterThan(199);
  expect(orbitPose(0,50,compact).x).toBeLessThan(211);
});
test.each(['btc','eth','apple','nvidia','gold','oil','eurusd','us500'])('local real glyph/pictogram %s has no raster/filter art', name => {
  const svg = readFileSync(resolve(__dirname, '../../../public/images/home-v0/asset-icons',name+'.svg'),'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('<path');
  expect(svg).not.toMatch(/<image|<filter|<script|<text|linearGradient|https?:.*href=/);
});
test('preserves live terminal, hero background and non-hero homepage', () => {
  const source=(name:string)=>readFileSync(resolve(__dirname,'../../pages/home',name),'utf8');
  const files=['HomeV0Coins.tsx','v0CoinRenderer.ts','v0MarketScene.ts'].map(source).join(' ');
  expect(files).not.toMatch(/\bfetch\s*\(|new WebSocket|setInterval|Math\.random/);
  expect(source('HomeV0Coins.tsx')).toContain('prefers-reduced-motion: reduce');
  expect(source('HomeV0Coins.tsx')).toContain('document.hidden');
  expect(source('HomeV0Coins.tsx')).not.toMatch(/Pause|Play|motion-toggle/);
  const hero=source('HomeSapphireHero.tsx');
  expect(hero).toContain('/hero/v0-reference-clean.png');
  expect(hero).toContain('<SapphireTerminal market={market}/>');
  for(const route of ['/trade','/markets','/futures','/copy-trading','/card'])expect(hero).toContain('to="'+route+'"');
  for(const section of ['HomeHeader','HomeMarketOverview','HomeCardTravel','HomeTradingSessions','HomeHeatmap','HomeMarkets','HomeEcosystem','HomeFaq','HomeFooter'])expect(source('HomePage.tsx')).toContain('<'+section);
});
test('single RAF starts, stops, resumes without hidden-time jump and disposes', () => {
  const saved = { raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, resize: global.ResizeObserver };
  let id=0; const callbacks=new Map<number, FrameRequestCallback>(), disconnect=jest.fn();
  global.requestAnimationFrame=((callback:FrameRequestCallback)=>{callbacks.set(++id,callback);return id;}) as any;
  global.cancelAnimationFrame=((key:number)=>callbacks.delete(key)) as any;
  global.ResizeObserver=class { observe(){} disconnect(){disconnect();} } as any;
  const nodes=Array.from({length:8},()=>({style:{}}));
  const host={clientWidth:410,dataset:{},querySelectorAll:()=>nodes} as any;
  try {
    const scene=createCoinScene(host,false);
    expect(callbacks.size).toBe(0);
    const frame=(time:number)=>{const c=[...callbacks.values()];callbacks.clear();c.forEach(fn=>fn(time));};
    scene.setActive(true);scene.setActive(true);expect(callbacks.size).toBe(1);
    frame(100);frame(140);const before=Number(host.dataset.elapsed);
    expect(before).toBeGreaterThan(0);
    scene.setActive(false);expect(callbacks.size).toBe(0);
    scene.setActive(true);frame(50000);expect(Number(host.dataset.elapsed)).toBe(before);
    frame(50040);expect(Number(host.dataset.elapsed)).toBeGreaterThan(before);
    scene.dispose();expect(callbacks.size).toBe(0);expect(disconnect).toHaveBeenCalledTimes(1);
    scene.setActive(true);expect(callbacks.size).toBe(0);
  } finally {global.requestAnimationFrame=saved.raf;global.cancelAnimationFrame=saved.cancel;global.ResizeObserver=saved.resize;}
});
