import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { HERO_INSTRUMENTS, HERO_PLATFORM_ASSET } from '../../pages/home/heroInstruments';
import * as motion from '../../pages/home/marketPlatformMotion';
import { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_STEP_MS, MARKET_SWAP_MS, ORBIT, orbitPose, orbitPoseAt, restingPose, ENTRY_DEG, EXIT_DEG } from '../../pages/home/marketPlatformMotion';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { act } = React;
const { JSDOM } = req('jsdom');
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8').replace(/\r\n/g, '\n');

describe('orbital hero presentation boundary', () => {
  it('changes only the scene mount and the owner-approved market mix line inside the Sapphire hero', () => {
    expect(read('src/pages/home/HomeHero.tsx')).toBe("export { HomeSapphireHero as HomeHero } from './HomeSapphireHero';\n");
    // Artwork/projection, copy, CTAs, visible terminal and tape stay byte-for-byte.
    const restored = read('src/pages/home/HomeSapphireHero.tsx')
      .replace("import { HomeMarketPlatformHero } from './HomeMarketPlatformHero';", "import { HomeHeroAssets } from './HomeHeroAssets';")
      .replace(/<HomeMarketPlatformHero(?: market=\{market\})?\s*\/>/, '<HomeHeroAssets market={market} englishLabels/>')
      .replace('<p className="market-mix"><span>Crypto</span><i aria-hidden="true">•</i><span>CFD</span><i aria-hidden="true">•</i><span>Stocks soon</span></p>', '');
    expect(createHash('sha256').update(restored).digest('hex')).toBe('a982f2b68e0a2ca9afa2a67b4d18ded4c414e224f2b0095c69f72f7262608db7');
  });

  it('mixes crypto, CFD and stocks-soon markets in the owner\'s order with honest badges', () => {
    expect(HERO_INSTRUMENTS.map(item => item.symbol)).toEqual(['BTC', 'AAPL', 'OIL', 'GOLD', 'ETH', 'NVDA', 'EURUSD', 'SOL']);
    expect(new Set(HERO_INSTRUMENTS.map(item => item.instrumentId)).size).toBe(HERO_INSTRUMENTS.length);
    for (const item of HERO_INSTRUMENTS) {
      expect(Object.keys(item).sort()).toEqual(['instrumentId', 'symbol', 'label', 'displayName', 'category', 'badge', 'face', 'asset', 'size', 'enabled'].sort());
      expect(item.enabled).toBe(true);
      expect(['graphite', 'white']).toContain(item.face);
      expect(item.badge).toBe(item.category === 'cfd' ? 'CFD' : item.category === 'stock' ? 'STOCKS SOON' : null);
      if (item.category === 'stock') expect(item.displayName).toMatch(/coming soon/);
      expect(item.size).toBeGreaterThanOrEqual(.9);
      expect(item.size).toBeLessThanOrEqual(1.1);
    }
    expect(HERO_INSTRUMENTS.filter(item => item.category === 'crypto').map(item => item.symbol)).toEqual(['BTC', 'ETH', 'SOL']);
    // US500 is not in the CFD catalogue, so it is not shown as a tradable CFD.
    expect(HERO_INSTRUMENTS.filter(item => item.category === 'cfd').map(item => item.symbol)).toEqual(['OIL', 'GOLD', 'EURUSD']);
    expect(HERO_INSTRUMENTS.some(item => /US500|SPX|S&P/i.test(item.symbol + item.label + item.displayName))).toBe(false);
    expect(HERO_INSTRUMENTS.filter(item => item.category === 'stock').map(item => item.symbol)).toEqual(['AAPL', 'NVDA']);
    expect(HERO_INSTRUMENTS[0]).toMatchObject({ symbol: 'BTC', face: 'graphite', size: 1 });
  });

  it('ships pre-rendered local medallions and a platform with a reproducible, licensed pipeline', () => {
    let bytes = 0;
    const webp = (file: string) => { const data = readFileSync(resolve(frontend, 'public' + file)); expect(data.subarray(0, 4).toString('latin1')).toBe('RIFF'); expect(data.subarray(8, 12).toString('latin1')).toBe('WEBP'); return data.length; };
    for (const item of HERO_INSTRUMENTS) {
      expect(item.asset).toMatch(/^\/hero\/medallions\/[a-z]+\.webp$/);
      const size = webp(item.asset);
      expect(size).toBeLessThan(item.symbol === 'BTC' ? 90_000 : 50_000);
      bytes += size;
      // Every medallion is rendered from a spec of the same renderer (face, logo, ticker relief).
      const spec = JSON.parse(readFileSync(resolve(frontend, '../scripts/hero-medallions/specs', item.asset.split('/').pop()!.replace('.webp', '.json')), 'utf8'));
      expect(spec.kind).toBe('coin');
      expect(spec.face).toBe(item.face);
      expect(spec.label.text).toBe(item.label);
      expect(spec.logo.png).toMatch(/^logos\/[a-z-]+\.png$/);
    }
    expect(HERO_PLATFORM_ASSET).toBe('/hero/medallions/platform.webp');
    bytes += webp(HERO_PLATFORM_ASSET);
    expect(bytes).toBeLessThan(420_000);
    expect(existsSync(resolve(frontend, 'public/hero/instruments'))).toBe(false);
    // Logo sources: Simple Icons paths (MIT) and VOLTEX's own marks, documented with the licence.
    const simple = (name: string) => read(`node_modules/@icons-pack/react-simple-icons/src/icons/Si${name}.tsx`).match(/<path d='([^']+)'/)?.[1];
    const logo = (file: string) => read(`../scripts/hero-medallions/logos/${file}`);
    for (const [file, icon] of [['eth.svg', 'Ethereum'], ['sol.svg', 'Solana'], ['aapl.svg', 'Apple'], ['nvda.svg', 'Nvidia']]) {
      expect(logo(file).match(/<path[^>]* d="([^"]+)"/)?.[1]).toBe(simple(icon));
    }
    expect(simple('Bitcoin')).toContain(logo('btc-mark.svg').match(/<path[^>]* d="([^"]+)"/)![1].replace(/^M17\.288 10\.291/, ''));
    expect(read('../scripts/hero-medallions/LICENSE-simple-icons.txt')).toMatch(/MIT License/);
    expect(read('../scripts/hero-medallions/SOURCES.md')).toMatch(/SiApple[\s\S]*SiNvidia/);
    expect(read('../scripts/hero-medallions/render3d.py')).toMatch(/def render_coin[\s\S]*def render_platform/);
  });
});

describe('orbit rhythm, depth and continuity', () => {
  const frames = marketTileFrames();
  const poseFrames = frames.filter(frame => frame.transform != null);
  const depthFrames = frames.filter(frame => frame.translate != null);
  const scaleOf = (frame: Keyframe) => Number(String(frame.transform).match(/scale\(([\d.]+)\)$/)?.[1]);

  it('changes the centre every 2.5 s with a 1.4 s staggered swap, inside the requested range', () => {
    expect(MARKET_STEP_MS).toBeGreaterThanOrEqual(2500);
    expect(MARKET_STEP_MS).toBeLessThanOrEqual(4500);
    expect(MARKET_SWAP_MS).toBe(1400);
    expect(ORBIT.swapStagger).toBeGreaterThanOrEqual(.4);
    expect(MARKET_CYCLE_MS).toBe(MARKET_STEP_MS * HERO_INSTRUMENTS.length);
    let previous = -1;
    for (const frame of frames) {
      expect(Number(frame.offset)).toBeGreaterThanOrEqual(previous);
      expect(Number(frame.offset)).toBeLessThanOrEqual(1);
      previous = Number(frame.offset);
      // Compositor-only properties; no layout, no stepped jumps.
      expect(Object.keys(frame).filter(key => !['transform', 'opacity', 'translate', 'offset', 'easing'].includes(key))).toEqual([]);
      expect(frame.easing ?? '').not.toMatch(/steps\(/);
    }
  });

  it('closes the loop on the same pose and depth, so the cycle never snaps', () => {
    expect(poseFrames[0].transform).toBe(poseFrames[poseFrames.length - 1].transform);
    expect(poseFrames[0].opacity).toBe(poseFrames[poseFrames.length - 1].opacity);
    expect(depthFrames[0].translate).toBe(depthFrames[depthFrames.length - 1].translate);
    for (const frame of poseFrames) expect(String(frame.transform)).toMatch(/^translate3d\(-?[\d.]+px, -?[\d.]+px, 0px\) perspective\(900px\) rotateY\(-?[\d.]+deg\) scale\([\d.]+\)$/);
    // Consecutive orbit samples stay close: no teleport on the ring.
    const xy = poseFrames.map(frame => String(frame.transform).match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/)!.slice(1).map(Number));
    const steps = xy.slice(1).map((point, i) => Math.hypot(point[0] - xy[i][0], point[1] - xy[i][1]));
    // Swap legs are sampled too: no keyframe jumps further than a few px.
    expect(Math.max(...steps)).toBeLessThan(40);
    // The two swapping medallions never touch: the outgoing one has landed on
    // the ring before the incoming one is anywhere near the centre.
    let closest = Infinity;
    for (let time = 0; time < MARKET_CYCLE_MS; time += 20) {
      const moving = HERO_INSTRUMENTS.map((_, index) => orbitPoseAt(index, time)).filter(pose => pose.phase === 'exit' || pose.phase === 'entry' || pose.phase === 'centre');
      for (let a = 0; a < moving.length; a++) for (let b = a + 1; b < moving.length; b++) {
        closest = Math.min(closest, Math.hypot(moving[a].x - moving[b].x, moving[a].y - moving[b].y) - ORBIT.coin / 2 * (moving[a].scale + moving[b].scale));
      }
    }
    expect(closest).toBeGreaterThan(8);
    // Nor does anything else: the incoming medallion's dip keeps it clear of
    // the medallion descending behind it on the ring.
    let closestAny = Infinity;
    for (let time = 0; time < MARKET_CYCLE_MS; time += 20) {
      const all = HERO_INSTRUMENTS.map((_, index) => orbitPoseAt(index, time));
      for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
        closestAny = Math.min(closestAny, Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y) - ORBIT.coin / 2 * (all[a].scale + all[b].scale));
      }
    }
    // (The static floor is the far-side medallion passing the centre's equator.)
    expect(closestAny).toBeGreaterThan(6);
  });

  it('keeps one dominant centre, nearer orbit coins larger and the incoming coin in front during a swap', () => {
    expect(scaleOf(poseFrames[0])).toBe(1);
    const front = orbitPose(90), back = orbitPose(270), side = orbitPose(0);
    expect(front.scale).toBeGreaterThan(side.scale);
    expect(side.scale).toBeGreaterThan(back.scale);
    // One dominant centre: the nearest helper is at most ~0.7 of it, the farthest under half.
    expect(1 / front.scale).toBeGreaterThanOrEqual(1.4);
    expect(1 / back.scale).toBeGreaterThanOrEqual(1.7);
    expect(front.z).toBeGreaterThan(back.z);
    // Depth also reads through a fade on the far side; the near side stays solid.
    expect([front.opacity, side.opacity]).toEqual([1, 1]);
    expect(back.opacity).toBeLessThan(1);
    expect(back.opacity).toBeGreaterThanOrEqual(.6);
    expect(orbitPose(0, 'mobile').opacity).toBe(1);
    expect(orbitPose(90, 'mobile').opacity).toBe(0);
    expect(orbitPose(180, 'mobile').opacity).toBe(0);
    expect(orbitPose(270, 'mobile').opacity).toBe(0);
    expect(ORBIT.centreDepth).toBeGreaterThan(front.z);
    expect(ORBIT.incomingDepth).toBeGreaterThan(ORBIT.centreDepth);
    expect(ORBIT.outgoingDepth).toBeLessThan(ORBIT.centreDepth);
    // The ring opens at its bottom, above the platform: the outgoing medallion
    // drops to the lower-left end, the incoming rises from the lower-right end.
    expect(Math.cos(EXIT_DEG * Math.PI / 180)).toBeGreaterThan(.5);
    expect(Math.cos(ENTRY_DEG * Math.PI / 180)).toBeGreaterThan(.5);
    expect(Math.abs(orbitPose(EXIT_DEG).x - orbitPose(ENTRY_DEG).x)).toBeGreaterThan(ORBIT.coin);
    expect(orbitPose(EXIT_DEG).x).toBeLessThan(0);
    expect(orbitPose(ENTRY_DEG).x).toBeGreaterThan(0);
    expect(orbitPose(EXIT_DEG).z).toBeGreaterThan(orbitPose(ENTRY_DEG).z);
    // Medallions rise on the near side (left) and descend behind.
    expect(orbitPose(60).y).toBeGreaterThan(orbitPose(120).y);
    expect(orbitPose(60).z).toBeGreaterThan(0);
  });

  it('spaces the orbit evenly and never lets two medallions collide on it', () => {
    let minimum = Infinity;
    for (let time = 0; time < MARKET_CYCLE_MS; time += 50) {
      const ring = HERO_INSTRUMENTS.map((_, index) => orbitPoseAt(index, time)).filter(pose => pose.phase === 'orbit');
      for (let a = 0; a < ring.length; a++) for (let b = a + 1; b < ring.length; b++) {
        minimum = Math.min(minimum, Math.hypot(ring[a].x - ring[b].x, ring[a].y - ring[b].y) - ORBIT.coin / 2 * (ring[a].scale + ring[b].scale));
      }
    }
    expect(minimum).toBeGreaterThan(20);
    const rest = HERO_INSTRUMENTS.map((_, index) => restingPose(index));
    expect(rest[0]).toMatchObject({ x: 0, y: 0, scale: 1 });
    for (let a = 1; a < rest.length; a++) expect(Math.hypot(rest[a].x, rest[a].y) - ORBIT.coin / 2 * (1 + rest[a].scale)).toBeGreaterThan(0);
  });

  it('gives every market one turn at the centre per cycle, in manifest order', () => {
    const leaders: string[] = [];
    for (let step = 0; step < HERO_INSTRUMENTS.length; step++) {
      const centre = HERO_INSTRUMENTS.filter((_, index) => orbitPoseAt(index, step * MARKET_STEP_MS + 100).phase === 'centre');
      expect(centre).toHaveLength(1);
      leaders.push(centre[0].symbol);
    }
    expect(leaders).toEqual(HERO_INSTRUMENTS.map(item => item.symbol));
    expect(new Set(HERO_INSTRUMENTS.map((_, index) => initialMarketPose(index))).size).toBe(HERO_INSTRUMENTS.length);
  });

  it('shows one to three helpers on phones, only the near side of the ring', () => {
    for (let time = 0; time < MARKET_CYCLE_MS; time += 50) {
      const helpers = HERO_INSTRUMENTS.map((_, index) => orbitPoseAt(index, time, 'mobile')).filter(pose => pose.phase !== 'centre' && pose.opacity > .05);
      expect(helpers.length).toBeGreaterThanOrEqual(1);
      expect(helpers.length).toBeLessThanOrEqual(3);
      expect(helpers.every(pose => pose.y > -60)).toBe(true);
    }
    expect(marketTileFrames('mobile').filter(frame => frame.opacity === 0).length).toBeGreaterThan(0);
  });
});

type TestAnimation = { currentTime: number; playState: string; play: jest.Mock; pause: jest.Mock; cancel: jest.Mock };

const fixtureMarket = () => ({
  tickers: [{ pair: 'BTC/USDT', price: 76746, change: -.67 }, { pair: 'ETH/USDT', price: 2479.53, change: -1.82 },
    { pair: 'SOL/USDT', price: 99.78, change: -1.94 }, { pair: 'XRP/USDT', price: 2.45, change: 1.15 }, { pair: 'ADA/USDT', price: .37, change: 2.18 }],
  tickersStale: false,
  hero: { pair: 'BTC/USDT', livePrice: undefined as number | undefined, stale: false },
  cfd: { configured: true, tickers: [
    { symbol: 'XAUUSD', price: '4349.19', changePercent24h: '-1.02', status: 'live', stale: false, displayOnly: true, executionAllowed: false },
    { symbol: 'WTIUSD', price: '96.607', changePercent24h: '2.36', status: 'market_closed', stale: false, displayOnly: true, executionAllowed: false },
  ] },
});

function mountHero(options: { reduced?: boolean; animate?: boolean; market?: any } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://voltex.invalid', pretendToBeVisual: true });
  const restored = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    restored.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let hidden = false;
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden });
  const media = new dom.window.EventTarget();
  media.matches = options.reduced ?? false;
  dom.window.matchMedia = () => media;
  const animations: TestAnimation[] = [];
  if (options.animate !== false) dom.window.HTMLElement.prototype.animate = jest.fn(() => {
    const animation: TestAnimation = { currentTime: 0, playState: 'running',
      play: jest.fn(() => { animation.playState = 'running'; }),
      pause: jest.fn(() => { animation.playState = 'paused'; }),
      cancel: jest.fn(() => { animation.playState = 'idle'; }) };
    animations.push(animation);
    return animation;
  });
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
  const disconnect = jest.fn();
  class Observer {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect() { disconnect(); }
  }
  const failWork = jest.fn(() => { throw new Error('Decoration attempted network or frame-loop work'); });
  const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/home/HomeMarketPlatformHero.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: any = {};
  const modules: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    'lucide-react': { ArrowRight: () => null, Pause: () => null, Play: () => null },
    '../../lib/i18n': { useLanguage: () => ({ lang: 'en', t: (key: string) => key }) },
    './heroInstruments': { HERO_INSTRUMENTS, HERO_PLATFORM_ASSET },
    './marketPlatformMotion': motion,
    './home-market-platform.css': {},
  };
  new Function('require', 'exports', 'IntersectionObserver', 'fetch', 'WebSocket', 'setInterval', 'setTimeout', 'requestAnimationFrame', source)(
    (name: string) => { if (!(name in modules)) throw new Error(`Unexpected hero dependency: ${name}`); return modules[name]; },
    output, Observer, failWork, failWork, failWork, failWork, failWork,
  );
  const root = createRoot(dom.window.document.getElementById('root'));
  let mounted = true;
  const detach = () => {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
  };
  const market = options.market ?? fixtureMarket();
  const beforeMarket = JSON.stringify(market);
  act(() => root.render(React.createElement(output.HomeMarketPlatformHero, { market })));
  expect(JSON.stringify(market)).toBe(beforeMarket);
  const scene = dom.window.document.querySelector('[data-market-visual]');
  const button = dom.window.document.querySelector('[data-motion-toggle]');
  const event = (name: string, pointerType = 'mouse') => {
    const e = new dom.window.Event(name, { bubbles: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    act(() => scene.dispatchEvent(e));
  };
  return { dom, scene, button, animations, disconnect, failWork, detach,
    visible(value: boolean) { act(() => intersect([{ isIntersecting: value }])); },
    hidden(value: boolean) { hidden = value; act(() => dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'))); },
    reduce(value: boolean) { media.matches = value; act(() => media.dispatchEvent(new dom.window.Event('change'))); },
    click() { act(() => button.click()); }, event,
    unmount() {
      detach();
      dom.window.close();
      for (const [name, descriptor] of restored) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

describe('mounted market motion lifecycle', () => {
  let hero: ReturnType<typeof mountHero> | undefined;
  afterEach(() => { hero?.unmount(); hero = undefined; });

  it('shows each market as its pre-rendered medallion and badge only, with no quotes, labels or data reads', () => {
    const market = fixtureMarket();
    const before = JSON.stringify(market);
    hero = mountHero({ market });
    const coins = [...hero.scene.querySelectorAll('[data-market-tile]')] as HTMLElement[];
    expect(coins.map(coin => coin.dataset.marketTile)).toEqual(HERO_INSTRUMENTS.map(item => item.symbol));
    coins.forEach((coin, index) => {
      const item = HERO_INSTRUMENTS[index];
      expect(coin.getAttribute('role')).toBe('img');
      expect(coin.getAttribute('aria-label')).toBe(item.displayName);
      expect(coin.dataset.face).toBe(item.face);
      const image = coin.querySelector('img.vm-coin');
      expect(image?.getAttribute('src')).toBe(item.asset);
      expect(image?.getAttribute('alt')).toBe('');
      expect(image?.getAttribute('draggable')).toBe('false');
      expect(coin.querySelectorAll('img')).toHaveLength(1);
      expect(coin.querySelector('.vm-asset-badge')?.textContent ?? null).toBe(item.badge);
      expect(coin.textContent).toBe(item.badge ?? '');
      expect(coin.textContent).not.toMatch(/unavailable|NaN|\d{3},/i);
    });
    expect(hero.scene.querySelector('.vm-card-price, .vm-card-note, .vm-card-change, .vm-card-symbol')).toBeNull();
    const platform = hero.dom.window.document.querySelector('img.vm-orbit-platform');
    expect(platform?.getAttribute('src')).toBe('/hero/medallions/platform.webp');
    expect(hero.dom.window.document.querySelectorAll('img')).toHaveLength(HERO_INSTRUMENTS.length + 1);
    expect(hero.dom.window.document.querySelector('path.vm-ring-main')?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+(?:L[\d.]+ [\d.]+){95}Z$/);
    hero.visible(true); hero.hidden(true); hero.hidden(false); hero.click();
    expect(JSON.stringify(market)).toBe(before);
    expect(hero.failWork).not.toHaveBeenCalled();
  });

  it('freezes the current phase offscreen/hidden and resumes without catch-up or new work', () => {
    hero = mountHero();
    expect(hero.animations).toHaveLength(HERO_INSTRUMENTS.length);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.visible(true);
    hero.animations.forEach((animation, index) => { animation.currentTime = 700 + index * MARKET_STEP_MS; });
    const times = hero.animations.map(animation => animation.currentTime);
    hero.hidden(true);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.hidden(false);
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    hero.visible(false);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.visible(true);
    expect(hero.animations.map(animation => animation.currentTime)).toEqual(times);
    expect(hero.animations).toHaveLength(HERO_INSTRUMENTS.length);
    expect(hero.failWork).not.toHaveBeenCalled();
  });

  it('keeps manual pause across pointer movement, tab return and viewport re-entry', () => {
    hero = mountHero();
    hero.visible(true);
    hero.click();
    expect(hero.button.getAttribute('aria-pressed')).toBe('true');
    expect(hero.button.getAttribute('aria-label')).toBe('home.hero.resumeMotion');
    hero.event('pointerenter'); hero.event('pointerleave');
    hero.hidden(true); hero.hidden(false); hero.visible(false); hero.visible(true);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    expect(hero.scene.dataset.motionReason).toContain('manual');
    hero.click();
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    expect(hero.button.getAttribute('aria-pressed')).toBe('false');
  });

  it('pauses mouse interaction, does not strand touch scrolling, and pauses keyboard focus on its control', () => {
    hero = mountHero();
    hero.visible(true);
    hero.event('pointerenter');
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.event('pointerleave'); hero.event('pointerenter', 'touch');
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    act(() => hero!.button.focus());
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    act(() => hero!.button.blur());
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    expect(hero.dom.window.document.querySelector('[aria-live]')).toBeNull();
    expect(hero.scene.getAttribute('role')).toBe('group');
    expect(hero.scene.getAttribute('aria-label')).toBe('home.hero.sceneAria');
  });

  it('resets reduced motion to a complete static composition and never overrides a manual pause', () => {
    hero = mountHero({ reduced: true });
    hero.visible(true);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    expect(new Set(hero.animations.map(animation => animation.currentTime)).size).toBe(HERO_INSTRUMENTS.length);
    hero.reduce(false);
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    hero.animations.forEach(animation => { animation.currentTime += 700; });
    hero.reduce(true);
    expect(hero.animations.map(animation => animation.currentTime)).toEqual(hero.animations.map((_, index) => initialMarketPose(index) * MARKET_STEP_MS));
    hero.click(); hero.reduce(false);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    expect(hero.scene.dataset.motionReason).toContain('manual');
  });

  it('retains complete content without Web Animations and releases each animation when unmounted', () => {
    hero = mountHero({ animate: false });
    hero.visible(true);
    expect(hero.scene.querySelectorAll('[data-market-tile]')).toHaveLength(HERO_INSTRUMENTS.length);
    expect(hero.dom.window.document.getElementById('home-market-column')).not.toBeNull();
    expect(hero.dom.window.document.getElementById('home-live-terminal')).toBeNull();
    expect(hero.dom.window.document.querySelector('h1')).toBeNull();
    expect(hero.dom.window.document.querySelectorAll('a')).toHaveLength(0);
    expect(hero.button.getAttribute('aria-label')).toBe('home.hero.pauseMotion');
    expect(hero.animations).toHaveLength(0);
    hero.unmount(); hero = mountHero();
    hero.visible(true);
    const running = hero.animations;
    const disconnect = hero.disconnect;
    hero.unmount(); hero = undefined;
    expect(disconnect).toHaveBeenCalledTimes(1);
    for (const animation of running) expect(animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('ignores an already queued observer callback after unmount without restarting cancelled animations', () => {
    hero = mountHero();
    hero.visible(true);
    const animations = hero.animations;
    const plays = animations.map(animation => animation.play.mock.calls.length);
    // Keep the document alive, as when React removes only the home route.
    hero.detach();
    expect(animations.every(animation => animation.playState === 'idle')).toBe(true);
    // IntersectionObserver delivery already queued before disconnect can
    // still reach its captured callback. It must do no animation work.
    hero.visible(true);
    expect(animations.every(animation => animation.playState === 'idle')).toBe(true);
    expect(animations.map(animation => animation.play.mock.calls.length)).toEqual(plays);
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(hero.disconnect).toHaveBeenCalledTimes(1);
    expect(hero.failWork).not.toHaveBeenCalled();
  });
});
