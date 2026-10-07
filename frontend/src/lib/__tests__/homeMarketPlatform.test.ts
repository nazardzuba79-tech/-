import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { HERO_INSTRUMENTS } from '../../pages/home/heroInstruments';
import { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_MOVE_MS, MARKET_POSES, MARKET_STEP_MS } from '../../pages/home/marketPlatformMotion';
import { cfdDisplayState, cfdMarketCopy } from '../cfdPresentation';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { act } = React;
const { JSDOM } = req('jsdom');

describe('market platform presentation boundary', () => {
  it('changes only the highlighted asset mount inside the restored Sapphire hero', () => {
    const read = (file: string) => readFileSync(resolve(frontend, 'src/pages/home', file), 'utf8').replace(/\r\n/g, '\n');
    expect(read('HomeHero.tsx')).toBe("export { HomeSapphireHero as HomeHero } from './HomeSapphireHero';\n");
    // Owner revision: preserve original artwork/projection, copy, CTAs,
    // visible terminal and tape byte-for-byte outside this one column.
    const restored = read('HomeSapphireHero.tsx')
      .replace("import { HomeMarketPlatformHero } from './HomeMarketPlatformHero';", "import { HomeHeroAssets } from './HomeHeroAssets';")
      .replace(/<HomeMarketPlatformHero(?: market=\{market\})?\s*\/>/, '<HomeHeroAssets market={market} englishLabels/>');
    expect(createHash('sha256').update(restored).digest('hex')).toBe('a982f2b68e0a2ca9afa2a67b4d18ded4c414e224f2b0095c69f72f7262608db7');
  });

  it('uses the existing BTC/Gold/Oil references plus four confirmed crypto identities', () => {
    expect(HERO_INSTRUMENTS.map(item => item.symbol)).toEqual(['BTC', 'GOLD', 'OIL', 'ETH', 'SOL', 'XRP', 'ADA']);
    expect(new Set(HERO_INSTRUMENTS.map(item => item.instrumentId)).size).toBe(7);
    for (const item of HERO_INSTRUMENTS) {
      expect(Object.keys(item).sort()).toEqual(['instrumentId', 'symbol', 'displayName', 'category', 'logoPath', 'destination', 'enabled'].sort());
      expect(item.enabled).toBe(true);
      expect(['AITH', 'NRX', 'VTA', 'SPX', 'NDX', 'AAPL']).not.toContain(item.symbol);
      const target = new URL(item.destination, 'https://voltex.invalid');
      expect(target.origin).toBe('https://voltex.invalid');
      expect(target.pathname).toBe('/trade');
      if (item.category === 'commodity') {
        expect(['GOLD', 'OIL']).toContain(item.symbol);
        const underlying = item.symbol === 'GOLD' ? 'XAUUSD' : 'WTIUSD';
        expect(item.instrumentId).toBe(`cfd:${underlying}`);
        expect(target.searchParams.get('market')).toBe('cfd');
        expect(target.searchParams.get('symbol')).toBe(underlying);
      } else {
        expect(item.instrumentId).toMatch(/^cg:/);
        expect(item.category).toBe('crypto');
        expect(target.searchParams.get('pair')).toBe(`${item.symbol}/USDT`);
      }
    }
  });

  it('ships small local marks with no per-icon remote image, font or script dependency', () => {
    let bytes = 0;
    const localIcons: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ADA: 'Cardano' };
    for (const item of HERO_INSTRUMENTS) {
      expect(item.logoPath).toMatch(/^\/hero\/instruments\/[a-z]+\.svg$/);
      const icon = readFileSync(resolve(frontend, 'public', item.logoPath.slice(1)), 'utf8');
      expect(icon).toContain('<path ');
      expect(icon).not.toMatch(/<script|<image|<foreignObject|href\s*=|url\(\s*(?!#)/i);
      if (item.symbol === 'XRP') {
        // Preserve the currency mark from the existing provider, not the
        // similarly named green XRP Ledger/site icon in Simple Icons.
        expect(createHash('sha256').update(icon).digest('hex')).toBe('31fe41b6b3a4d98c9b46d7c37d60dea97fa5d9ebbd235ac5bfe23e4fd1eb8361');
        expect(readFileSync(resolve(frontend, 'public/hero/instruments/LICENSE-cryptocurrency-icons.txt'), 'utf8')).toContain('CC0');
      } else if (item.category === 'commodity') {
        // Render the already shipped Gold/Oil source with the same props.
        // Local gradient references are allowed; no new artwork is inferred.
        const original = readFileSync(resolve(frontend, 'src/pages/home/HomeHeroAssets.tsx'), 'utf8');
        const compiled = ts.transpileModule(original, { compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        } }).outputText;
        const icons: any = {};
        new Function('require', 'exports', `${compiled}\nexports.gold = GoldIcon; exports.oil = OilIcon;`)(
          (name: string) => name === 'react/jsx-runtime' ? req(name) : {}, icons,
        );
        const rendered = req('react-dom/server').renderToStaticMarkup(React.createElement(icons[item.symbol.toLowerCase()], { size: 24 }))
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        expect(icon.trim()).toBe(rendered);
      } else {
        const original = readFileSync(resolve(frontend, `node_modules/@icons-pack/react-simple-icons/src/icons/Si${localIcons[item.symbol]}.tsx`), 'utf8');
        expect(icon.match(/<path d="([^"]+)"/)?.[1]).toBe(original.match(/<path d='([^']+)'/)?.[1]);
      }
      bytes += Buffer.byteLength(icon);
    }
    expect(bytes).toBeLessThan(12_000);
    expect(existsSync(resolve(frontend, 'public/hero/instruments/LICENSE.txt'))).toBe(true);
  });
});

describe('market carousel continuity and rhythm', () => {
  const frames = marketTileFrames();
  const at = (time: number) => frames.find(frame => Math.abs(Number(frame.offset) * MARKET_CYCLE_MS - time) < .001)!;
  const pose = (frame: Keyframe) => ({ transform: frame.transform, opacity: frame.opacity, zIndex: frame.zIndex });

  it('holds each composition, then moves once every four seconds without layout animation', () => {
    expect(MARKET_STEP_MS).toBe(4000);
    expect(MARKET_MOVE_MS).toBeGreaterThanOrEqual(800);
    expect(MARKET_MOVE_MS).toBeLessThanOrEqual(1100);
    expect(MARKET_CYCLE_MS).toBe(MARKET_STEP_MS * HERO_INSTRUMENTS.length);
    for (let phase = 0; phase < HERO_INSTRUMENTS.length; phase++) {
      const start = at(phase * MARKET_STEP_MS);
      const held = at((phase + 1) * MARKET_STEP_MS - MARKET_MOVE_MS);
      expect(start).toBeDefined();
      expect(held).toBeDefined();
      expect(pose(held)).toEqual(pose(start));
      expect(Number(held.offset) - Number(start.offset)).toBeGreaterThan(.1);
    }
    let previous = -1;
    for (const frame of frames) {
      expect(Number(frame.offset)).toBeGreaterThan(previous);
      expect(Number(frame.offset)).toBeLessThanOrEqual(1);
      previous = Number(frame.offset);
      expect(Object.keys(frame).some(key => ['width', 'height', 'top', 'left', 'margin', 'padding'].includes(key))).toBe(false);
      expect(frame.easing ?? '').not.toMatch(/steps\(/);
    }
  });

  it('never wraps a visible tile across the stage or snaps at the cycle boundary', () => {
    expect(pose(frames[0])).toEqual(pose(frames[frames.length - 1]));
    const y = (frame: Keyframe) => {
      const transform = String(frame.transform);
      const multiple = transform.match(/calc\((-?\d+) \* var\(--card-step\)\)/);
      return multiple ? Number(multiple[1]) : transform.includes('var(--card-step)') ? 1 : 0;
    };
    const crossings = frames.slice(1).map((frame, index) => [frames[index], frame] as const)
      .filter(([left, right]) => y(right) > y(left));
    expect(crossings).toHaveLength(1);
    for (const [left, right] of crossings) {
      expect(Number(left.opacity)).toBe(0);
      expect(Number(right.opacity)).toBe(0);
    }
    expect(MARKET_POSES.filter(frame => frame.opacity > 0).map(y).sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    expect(MARKET_POSES.filter(frame => frame.opacity === 0).map(y).sort((a, b) => a - b)).toEqual([-3, 3]);
    for (const frame of frames) {
      expect(String(frame.transform)).toMatch(/^translate3d\(0, /);
      const rotation = Number(String(frame.transform).match(/rotateX\((-?[\d.]+)deg\)/)?.[1]);
      expect(Number.isFinite(rotation)).toBe(true);
      expect(Math.abs(rotation)).toBeLessThan(45);
    }
  });

  it('gives every market exactly one turn at the front without duplicate phases', () => {
    const phases = HERO_INSTRUMENTS.map((_, index) => initialMarketPose(index));
    expect(new Set(phases).size).toBe(7);
    const leaders: number[] = [];
    for (let step = 0; step < 7; step++) {
      const atFront = phases.map((phase, index) => ({ index, frame: at(((phase + step) % 7) * MARKET_STEP_MS) }))
        .filter(({ frame }) => frame.transform === MARKET_POSES[0].transform);
      expect(atFront).toHaveLength(1);
      leaders.push(atFront[0].index);
    }
    expect(leaders).toEqual([2, 3, 4, 5, 6, 0, 1]);
    expect(HERO_INSTRUMENTS.filter((_, index) => MARKET_POSES[initialMarketPose(index)].opacity > 0).map(item => item.symbol))
      .toEqual(['BTC', 'GOLD', 'OIL', 'ETH', 'SOL']);
  });
});

type TestAnimation = { currentTime: number; playState: string; play: jest.Mock; pause: jest.Mock; cancel: jest.Mock };

const fixtureMarket = () => ({
  tickers: [{ pair: 'BTC/USDT', price: 76746, change: -.67 }, { pair: 'ETH/USDT', price: 2479.53, change: -1.82 },
    { pair: 'SOL/USDT', price: 99.78, change: -1.94 }, { pair: 'XRP/USDT', price: 2.45, change: 1.15 }, { pair: 'ADA/USDT', price: .37, change: 2.18 }],
  tickersStale: false,
  hero: { pair: 'BTC/USDT', livePrice: undefined as number | undefined },
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
  const oldAssets: any = {};
  const oldAssetsCode = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/home/HomeHeroAssets.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', oldAssetsCode)((name: string) => name === 'react/jsx-runtime' ? req(name) : {}, oldAssets);
  const liveValue: any = {};
  const liveValueCode = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/home/LiveValue.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', liveValueCode)((name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return req(name);
    if (name === './useHomeMarket') return { formatPriceValue: (value: number) => value.toFixed(2) };
    throw new Error(`Unexpected quote rendering dependency: ${name}`);
  }, liveValue);
  const modules: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
    'lucide-react': { ArrowRight: () => null, Pause: () => null, Play: () => null },
    '../../lib/i18n': { useLanguage: () => ({ lang: 'en', t: (key: string) => key }) },
    '../../lib/cfdPresentation': { cfdDisplayState, cfdMarketCopy },
    './LiveValue': liveValue,
    './HomeHeroAssets': oldAssets,
    './heroInstruments': { HERO_INSTRUMENTS },
    './marketPlatformMotion': { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_POSES, MARKET_STEP_MS },
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

  it('renders existing numeric crypto and string CFD snapshots without new requests or data mutation', () => {
    const market = fixtureMarket();
    market.hero.livePrice = 76747.25;
    const before = JSON.stringify(market);
    hero = mountHero({ market });
    const card = (symbol: string) => hero!.scene.querySelector(`[data-market-tile="${symbol}"]`)!;
    expect(card('BTC').querySelector('.vm-card-price')?.textContent).toBe('76,747.25');
    expect(card('BTC').querySelector('.vm-card-change')?.textContent).toBe('-0.67%');
    expect(card('GOLD').querySelector('.vm-card-price')?.textContent).toBe('4,349.19');
    expect(card('GOLD').querySelector('.vm-card-change')?.textContent).toBe('-1.02%');
    expect(card('OIL').querySelector('.vm-card-price')?.textContent).toBe('96.61');
    expect(card('OIL').querySelector('.vm-card-change')?.textContent).toBe('+2.36%');
    hero.visible(true); hero.hidden(true); hero.hidden(false); hero.click();
    expect(JSON.stringify(market)).toBe(before);
    expect(hero.failWork).not.toHaveBeenCalled();
  });

  it('keeps unknown/blank/non-finite quotes unavailable instead of inventing zeros', () => {
    const market: any = fixtureMarket();
    market.tickers = [{ pair: 'BTC/USDT', price: NaN, change: Infinity }];
    market.cfd.tickers[0].price = ' ';
    market.cfd.tickers[0].changePercent24h = '';
    market.cfd.tickers[1].price = null;
    market.cfd.tickers[1].changePercent24h = 'not-a-number';
    hero = mountHero({ market });
    for (const symbol of ['BTC', 'GOLD', 'OIL', 'ETH', 'SOL', 'XRP', 'ADA']) {
      const card = hero.scene.querySelector(`[data-market-tile="${symbol}"]`)!;
      expect(card.querySelector('.vm-card-price')?.textContent).toBe('—');
      expect(card.querySelector('.vm-card-change')?.textContent).toBe('—');
      expect(card.querySelector('.vm-card-note')?.textContent).toBe(cfdMarketCopy('en').priceUnavailable);
      expect(card.textContent).not.toMatch(/NaN|Infinity|0\.00/);
    }
    expect(hero.failWork).not.toHaveBeenCalled();
  });

  it('preserves sampled and stale quote disclosures without changing the shared values', () => {
    const market = fixtureMarket();
    market.tickersStale = true;
    market.cfd.tickers[0].stale = true;
    hero = mountHero({ market });
    for (const symbol of ['BTC', 'GOLD']) {
      const card = hero.scene.querySelector(`[data-market-tile="${symbol}"]`)!;
      expect(card.getAttribute('data-stale')).toBe('true');
      expect(card.querySelector('.vm-card-note')?.textContent).toBe(cfdMarketCopy('en').lastQuote);
    }
    expect(hero.scene.querySelector('[data-market-tile="BTC"] .vm-card-price')?.textContent).toBe('76,746.00');
    expect(hero.scene.querySelector('[data-market-tile="GOLD"] .vm-card-price')?.textContent).toBe('4,349.19');
  });

  it('freezes the current phase offscreen/hidden and resumes without catch-up or new work', () => {
    hero = mountHero();
    expect(hero.animations).toHaveLength(7);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.visible(true);
    hero.animations.forEach((animation, index) => { animation.currentTime = 3750 + index * 4000; });
    const times = hero.animations.map(animation => animation.currentTime);
    hero.hidden(true);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.hidden(false);
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    hero.visible(false);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    hero.visible(true);
    expect(hero.animations.map(animation => animation.currentTime)).toEqual(times);
    expect(hero.animations).toHaveLength(7);
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
    expect(new Set(hero.animations.map(animation => animation.currentTime)).size).toBe(7);
    hero.reduce(false);
    expect(hero.animations.every(animation => animation.playState === 'running')).toBe(true);
    hero.animations.forEach(animation => { animation.currentTime += 3500; });
    hero.reduce(true);
    expect(hero.animations.map(animation => animation.currentTime)).toEqual(HERO_INSTRUMENTS.map((_, index) => initialMarketPose(index) * MARKET_STEP_MS));
    hero.click(); hero.reduce(false);
    expect(hero.animations.every(animation => animation.playState === 'paused')).toBe(true);
    expect(hero.scene.dataset.motionReason).toContain('manual');
  });

  it('retains complete content without Web Animations and releases each animation when unmounted', () => {
    hero = mountHero({ animate: false });
    hero.visible(true);
    expect(hero.scene.querySelectorAll('[data-market-tile]')).toHaveLength(7);
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
