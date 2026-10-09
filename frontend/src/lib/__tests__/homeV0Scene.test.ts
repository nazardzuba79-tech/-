import { HERO_ICONS, HERO_INSTRUMENTS, heroInstruments, ORBITS, orbitPose, orbitRing, SCENE_HEIGHT, SCENE_WIDTH, MOBILE_SCENE_HEIGHT, SCENE_INSTRUMENTS, scenePrice, sceneQuote } from '../../pages/home/v0MarketScene';
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
  for (const row of HERO_INSTRUMENTS.filter(x => ['NFLX', 'AMD'].includes(x.id))) {
    expect(row.market).toBe('stock');
    expect(sceneQuote(row, market({ tickers: [{ pair: row.id, price: 123 }], cfd: { tickers: [{ symbol: row.id, price: '123', status: 'live' }] } }), 'en').price).toBeNull();
  }
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


test('exactly 20 distinct requested assets including the central BTC; unchanged quote roster', () => {
  expect(HERO_INSTRUMENTS.map(x => x.id)).toEqual([
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'NFLX', 'AMD',
    'TRXUSDT', 'AAPL', 'NVDA', 'TSLA', 'META', 'AMZN', 'MSFT', 'US500', 'NAS100',
    'EURUSD', 'XAUUSD', 'WTI', 'USDJPY',
  ]);
  expect(new Set(HERO_INSTRUMENTS.map(x => x.id)).size).toBe(20);
  expect(heroInstruments()).toBe(HERO_INSTRUMENTS);
  expect(SCENE_INSTRUMENTS).toHaveLength(24);
  expect(ORBITS).toHaveLength(3);
  expect(ORBITS.map(x => x.period)).toEqual([14, 19, 25]);
  expect(new Set(ORBITS.map(x => x.phase)).size).toBe(3);
});
test.each([false, true])('one central BTC and three complete rings: compact=%s', compact => {
  const assets = heroInstruments(compact);
  expect(assets).toHaveLength(compact ? 12 : 20);
  expect(assets[0].id).toBe('BTCUSDT');
  expect(new Set(assets.map(x => x.id)).size).toBe(assets.length);
  expect(assets.every(x => HERO_INSTRUMENTS.includes(x))).toBe(true);
  const counts = [0, 0, 0, 0];
  assets.forEach((_, index) => counts[orbitRing(index, compact)]++);
  expect(counts).toEqual(compact ? [1, 3, 4, 4] : [1, 6, 6, 7]);
  expect(() => orbitRing(assets.length, compact)).toThrow(RangeError);
});
test.each([false, true])('every satellite moves every frame with an upright logo: compact=%s', compact => {
  let slowestFrame = Infinity, fastestFrame = 0, maximumRotation = 0;
  for (let t = 0; t < 120; t += .17) for (let i = 1; i < heroInstruments(compact).length; i++) {
    const a = orbitPose(i, t, compact), b = orbitPose(i, t + 1 / 30, compact);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    slowestFrame = Math.min(slowestFrame, distance);
    fastestFrame = Math.max(fastestFrame, distance);
    maximumRotation = Math.max(maximumRotation, Math.abs(a.rotation));
  }
  expect(slowestFrame).toBeGreaterThan(1);
  expect(fastestFrame).toBeLessThan(3);
  expect(maximumRotation).toBe(0);
});
test.each([false, true])('all three rings complete smooth full revolutions in both directions: compact=%s', compact => {
  for (let i = 1; i < heroInstruments(compact).length; i++) {
    const orbit = ORBITS[orbitRing(i, compact) - 1];
    const first = orbitPose(i, 0, compact), end = orbitPose(i, orbit.period, compact);
    const middle = orbitPose(i, orbit.period / 2, compact), centre = orbitPose(0, 0, compact);
    expect(end.x).toBeCloseTo(first.x, 8);
    expect(end.y).toBeCloseTo(first.y, 8);
    expect((first.x + middle.x) / 2).toBeCloseTo(centre.x, 8);
    expect((first.y + middle.y) / 2).toBeCloseTo(centre.y, 8);
    const quarter = orbitPose(i, orbit.period / 4, compact);
    const cross = (first.x - centre.x) * (quarter.y - centre.y) - (first.y - centre.y) * (quarter.x - centre.x);
    expect(Math.sign(cross)).toBe(orbit.direction);
    // Velocity is continuous across a completed revolution, not a reset/pause.
    const before = orbitPose(i, orbit.period - .001, compact), after = orbitPose(i, orbit.period + .001, compact);
    expect(end.x - before.x).toBeCloseTo(after.x - end.x, 4);
    expect(end.y - before.y).toBeCloseTo(after.y - end.y, 4);
  }
});
test.each([false, true])('logos remain separated and inside the scene through the full phase cycle: compact=%s', compact => {
  const count = heroInstruments(compact).length;
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  let minimumClearance = Infinity, minimumBoundary = Infinity;
  // LCM(14,19,25): all relative phases, including opposing-ring encounters.
  for (let t = 0; t <= 6650; t += .25) {
    const poses = Array.from({ length: count }, (_, i) => orbitPose(i, t, compact));
    poses.forEach((pose, i) => {
      const radius = pose.radius * pose.scale;
      minimumBoundary = Math.min(minimumBoundary, pose.x - radius, SCENE_WIDTH - pose.x - radius, pose.y - radius, height - pose.y - radius);
      for (let j = i + 1; j < count; j++) {
        const other = poses[j];
        minimumClearance = Math.min(minimumClearance, Math.hypot(pose.x - other.x, pose.y - other.y) - radius - other.radius * other.scale);
      }
    });
  }
  expect(minimumClearance).toBeGreaterThan(0);
  expect(minimumBoundary).toBeGreaterThan(0);
});
test.each([false, true])('obvious movement in the first second around one dominant, stable BTC: compact=%s', compact => {
  const centre = orbitPose(0, 0, compact);
  for (let i = 1; i < heroInstruments(compact).length; i++) {
    const a = orbitPose(i, 0, compact), b = orbitPose(i, 1, compact);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(25);
    expect(centre.radius).toBeGreaterThan(a.radius * 1.6);
  }
  expect(orbitPose(0, 50, compact)).toEqual(centre);
});
test.each(HERO_INSTRUMENTS.map(x => x.id))('asset %s has a local, self-contained vector logo or market symbol', id => {
  expect(HERO_ICONS[id]).toMatch(/^[a-z0-9]+$/);
  const svg = readFileSync(resolve(__dirname, '../../../public/images/home-v0/asset-icons', HERO_ICONS[id] + '.svg'), 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toMatch(/<(?:path|circle|rect|polygon|polyline)\b/);
  expect(svg).not.toMatch(/<image|<script|<foreignObject|(?:href|src)=["'](?:https?:|data:)/i);
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
test.each([false, true])('one RAF updates every visible asset, pauses/resumes and disposes: compact=%s', compact => {
  const saved = { raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, resize: global.ResizeObserver };
  let id=0; const callbacks=new Map<number, FrameRequestCallback>(), disconnect=jest.fn();
  global.requestAnimationFrame=((callback:FrameRequestCallback)=>{callbacks.set(++id,callback);return id;}) as any;
  global.cancelAnimationFrame=((key:number)=>callbacks.delete(key)) as any;
  global.ResizeObserver=class { observe(){} disconnect(){disconnect();} } as any;
  const nodes=Array.from({length:heroInstruments(compact).length},()=>({style:{} as Record<string, string>}));
  const host={clientWidth:410,getBoundingClientRect:()=>({width:410}),dataset:{},querySelectorAll:()=>nodes} as any;
  try {
    const scene=createCoinScene(host,compact);
    expect(callbacks.size).toBe(0);
    const initial = nodes.map(node => node.style.transform);
    expect(initial.every(transform => transform.startsWith('translate3d('))).toBe(true);
    const frame=(time:number)=>{const c=[...callbacks.values()];callbacks.clear();c.forEach(fn=>fn(time));};
    scene.setActive(true);scene.setActive(true);expect(callbacks.size).toBe(1);
    frame(100);frame(140);const before=Number(host.dataset.elapsed);
    expect(before).toBeGreaterThan(0);
    expect(nodes[0].style.transform).toBe(initial[0]);
    nodes.slice(1).forEach((node, i) => expect(node.style.transform).not.toBe(initial[i + 1]));
    scene.setActive(false);expect(callbacks.size).toBe(0);
    scene.setActive(true);frame(50000);expect(Number(host.dataset.elapsed)).toBe(before);
    frame(50040);expect(Number(host.dataset.elapsed)).toBeGreaterThan(before);
    scene.dispose();expect(callbacks.size).toBe(0);expect(disconnect).toHaveBeenCalledTimes(1);
    scene.setActive(true);expect(callbacks.size).toBe(0);
  } finally {global.requestAnimationFrame=saved.raf;global.cancelAnimationFrame=saved.cancel;global.ResizeObserver=saved.resize;}
});

test.each([false, true])('fractional scene widths keep BTC and moving assets aligned with SVG guides: compact=%s', compact => {
  const saved = { raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, resize: global.ResizeObserver };
  let width = 364.65625, resize = () => {}, nextFrame: FrameRequestCallback = () => {};
  const nodes = Array.from({ length: heroInstruments(compact).length }, () => ({ style: {} as Record<string, string> }));
  const bounds = jest.fn(() => ({ width }));
  const host = { get clientWidth() { return Math.round(width); }, getBoundingClientRect: bounds, dataset: {}, querySelectorAll: () => nodes } as any;
  global.requestAnimationFrame = ((callback: FrameRequestCallback) => { nextFrame = callback; return 1; }) as any;
  global.cancelAnimationFrame = jest.fn();
  global.ResizeObserver = class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} } as any;
  let scene: ReturnType<typeof createCoinScene> | undefined;
  const verifyGuideAlignment = () => {
    const scale = width / SCENE_WIDTH, cx = width / 2, cy = (compact ? 214 : 280) * scale;
    nodes.forEach((node, index) => {
      const translation = node.style.transform.match(/^translate3d\(([-\d.]+)px,([-\d.]+)px,0\)/)!;
      expect(translation).not.toBeNull();
      const x = Number(translation[1]), y = Number(translation[2]);
      if (index === 0) {
        expect(x).toBeCloseTo(cx, 10);
        expect(y).toBeCloseTo(cy, 10);
      } else {
        const ring = ORBITS[orbitRing(index, compact) - 1];
        const rx = ring.rx * scale, ry = (compact ? ring.mobileRy : ring.ry) * scale;
        expect(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2).toBeCloseTo(1, 10);
      }
    });
  };
  try {
    scene = createCoinScene(host, compact);
    verifyGuideAlignment();
    const initialBoundsReads = bounds.mock.calls.length;
    scene.setActive(true);
    nextFrame(100); nextFrame(140);
    verifyGuideAlignment();
    expect(bounds).toHaveBeenCalledTimes(initialBoundsReads);
    width = 299.375;
    resize();
    verifyGuideAlignment();
    expect(bounds).toHaveBeenCalledTimes(initialBoundsReads + 1);
    nextFrame(180);
    verifyGuideAlignment();
    expect(bounds).toHaveBeenCalledTimes(initialBoundsReads + 1);
  } finally {
    scene?.dispose();
    global.requestAnimationFrame = saved.raf;
    global.cancelAnimationFrame = saved.cancel;
    global.ResizeObserver = saved.resize;
  }
});
