import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import {
  isDynamicImportFailure, attemptChunkRecovery, recoveryAvailable, shellId,
  failedModuleUrl, healThenReload, HEAL_TIMEOUT_MS,
} from '../chunkRecovery';

/**
 * A SHELL THAT OUTLIVED ITS CHUNKS MUST RECOVER ONCE, AND ONLY ONCE.
 *
 * Reproduced in Chromium against two real builds before any of this was
 * written: a tab holding build A's `index.html` and entry chunk, opening
 * `/futures` after build B is live, throws
 *
 *   TypeError: Failed to fetch dynamically imported module: …/FuturesPage-<hash>.js
 *
 * at `Lazy`, which the ErrorBoundary catches and turns into «Что-то пошло не
 * так». The page is fine; the tab is holding an old map. So the rule these
 * cases pin is narrow on purpose:
 *
 *   a dynamic-import failure  -> exactly one automatic reload
 *   the same failure again    -> the ordinary boundary, never a second reload
 *   any other thrown error    -> the ordinary boundary, no reload at all
 *
 * The middle line is the one that matters most. An auto-reload with a guard
 * that can be defeated is worse than no auto-reload: the viewer of a genuine
 * problem gets a tab they cannot read and cannot stop.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');

/** The reload now waits for the cache heal (a promise chain), so a test
 *  lets queued microtasks and zero-delay timers run before counting. */
const flush = () => new Promise(r => setTimeout(r, 0));

function memorySession() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}
/** A document whose entry script is a specific build's, so the guard can be
 *  asked what it does when the shell changes and when it does not. */
const shellDoc = (entry: string) => new JSDOM(
  `<!doctype html><html><head><script type="module" src="/assets/${entry}"></script></head><body></body></html>`,
).window.document;

const importError = (file = 'FuturesPage-Bjwiy2MF.js') =>
  new TypeError(`Failed to fetch dynamically imported module: https://voltextech.net/assets/${file}`);

// ── classification ───────────────────────────────────────────────────────────

it('recognises a stale dynamic import in every engine that reports one', () => {
  // The exact Chromium string, measured — not paraphrased.
  expect(isDynamicImportFailure(importError())).toBe(true);
  expect(isDynamicImportFailure(new TypeError(
    'error loading dynamically imported module: https://voltextech.net/assets/FuturesPage-x.js'))).toBe(true);
  expect(isDynamicImportFailure(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isDynamicImportFailure(new TypeError('Unable to load module script'))).toBe(true);
  expect(isDynamicImportFailure(new Error('Unable to preload CSS for /assets/FuturesPage-x.css'))).toBe(true);
  expect(isDynamicImportFailure(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true);
});

it('does NOT mistake an ordinary crash for a stale import', () => {
  // A TypeError is not enough on its own — this is the most common real bug
  // in this codebase's shape, and it must always reach the boundary.
  expect(isDynamicImportFailure(new TypeError("Cannot read properties of undefined (reading 'price')"))).toBe(false);
  expect(isDynamicImportFailure(new TypeError('x is not a function'))).toBe(false);
  expect(isDynamicImportFailure(new Error('Rendered fewer hooks than expected'))).toBe(false);
  expect(isDynamicImportFailure(new RangeError('Maximum call stack size exceeded'))).toBe(false);
  expect(isDynamicImportFailure(null)).toBe(false);
  expect(isDynamicImportFailure(undefined)).toBe(false);
  expect(isDynamicImportFailure({ message: 42 })).toBe(false);
});

// ── the one-shot guard ───────────────────────────────────────────────────────

it('reloads once for a stale chunk, and never twice for the same shell', async () => {
  const session = memorySession();
  const doc = shellDoc('index-BiBUMqqs.js');
  const reloads: number[] = [];
  const env = { session, doc, path: '/futures', reload: () => reloads.push(1), heal: () => undefined };

  expect(attemptChunkRecovery(importError(), env)).toBe(true);
  await flush();
  expect(reloads).toHaveLength(1);

  // The reload returned the SAME stale shell — the HTML was still cached.
  // A second reload would fail identically, so it must not happen.
  expect(recoveryAvailable(env)).toBe(false);
  expect(attemptChunkRecovery(importError(), env)).toBe(false);
  expect(attemptChunkRecovery(importError('Nav-Spdin6iK.js'), env)).toBe(false);
  await flush();
  expect(reloads).toHaveLength(1);
});

it('a fresh shell after the reload starts with its own budget', async () => {
  const session = memorySession();
  const reloads: string[] = [];
  const heal = () => undefined;
  const stale = { session, doc: shellDoc('index-BiBUMqqs.js'), path: '/futures', reload: () => reloads.push('A'), heal };
  expect(attemptChunkRecovery(importError(), stale)).toBe(true);

  // The reload fetched a new index.html, so a DIFFERENT entry is running.
  // That is a new build, not a loop, and it is allowed its own attempt.
  const fresh = { session, doc: shellDoc('index-CAW2vEem.js'), path: '/futures', reload: () => reloads.push('B'), heal };
  expect(recoveryAvailable(fresh)).toBe(true);
  expect(attemptChunkRecovery(importError(), fresh)).toBe(true);
  await flush();
  expect(reloads).toEqual(['A', 'B']);
});

it('the budget is per path, so one broken route cannot spend another route\'s attempt', async () => {
  const session = memorySession();
  const doc = shellDoc('index-BiBUMqqs.js');
  const reloads: string[] = [];
  const heal = () => undefined;
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/futures', reload: () => reloads.push('/futures'), heal })).toBe(true);
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/wallet', reload: () => reloads.push('/wallet'), heal })).toBe(true);
  await flush();
  expect(reloads).toEqual(['/futures', '/wallet']);
  // …and neither route gets a second.
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/futures', reload: () => reloads.push('x'), heal })).toBe(false);
  await flush();
  expect(reloads).toHaveLength(2);
});

it('never reloads for an ordinary render error, however many times it throws', () => {
  const session = memorySession();
  const doc = shellDoc('index-BiBUMqqs.js');
  const reloads: number[] = [];
  const env = { session, doc, path: '/futures', reload: () => reloads.push(1) };
  for (let i = 0; i < 5; i++) {
    expect(attemptChunkRecovery(new TypeError("Cannot read properties of undefined (reading 'mark')"), env)).toBe(false);
  }
  expect(reloads).toHaveLength(0);
  // And the ordinary crash did not quietly consume the chunk budget either.
  expect(recoveryAvailable(env)).toBe(true);
});

it('storage that cannot hold a guard shows the boundary rather than reloading blind', () => {
  // A reload without a guard is the loop. Offline, private mode, a full quota
  // — any of them, and the honest outcome is the fallback the viewer can read.
  const reloads: number[] = [];
  const refuses = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  expect(attemptChunkRecovery(importError(), {
    session: refuses, doc: shellDoc('index-BiBUMqqs.js'), path: '/futures', reload: () => reloads.push(1),
  })).toBe(false);
  expect(reloads).toHaveLength(0);

  expect(attemptChunkRecovery(importError(), {
    session: null, doc: shellDoc('index-BiBUMqqs.js'), path: '/futures', reload: () => reloads.push(1),
  })).toBe(false);
  expect(reloads).toHaveLength(0);
});

it('identifies the shell by its hashed entry, and survives not having one', () => {
  expect(shellId(shellDoc('index-BiBUMqqs.js'))).toBe('index-BiBUMqqs.js');
  expect(shellId(shellDoc('index-CAW2vEem.js'))).toBe('index-CAW2vEem.js');
  expect(shellId(new JSDOM('<!doctype html><html><body></body></html>').window.document)).toBe('dev');
});

// ── the boundary itself, mounted ─────────────────────────────────────────────

/** The real ErrorBoundary, compiled from source and mounted, so these cases
 *  are about the component the app ships rather than a re-implementation. */
function loadBoundaryModule(dom: any = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://voltextech.net/' })) {
  return loadBoundaryExports(dom);
}

function loadBoundary(dom: any) {
  return loadBoundaryExports(dom).ErrorBoundary;
}

function loadBoundaryExports(dom: any) {
  const file = resolve(frontend, 'src/components/ErrorBoundary.tsx');
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} as any };
  const localRequire = (id: string) => {
    if (id === 'react') return React;
    if (id === '../lib/chunkRecovery') return require('../chunkRecovery');
    return req(id);
  };
  // `React` is free in the transpiled JSX — the source imports only named
  // exports, so the classic runtime's React.createElement has nothing to bind
  // to unless it is supplied here.
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'React', 'document', 'window', 'sessionStorage', js)(
    localRequire, module, module.exports, React, dom.window.document, dom.window,
    dom.window.sessionStorage);
  return module.exports;
}

interface Mounted {
  host: HTMLElement;
  reloads: number[];
  warn: jest.SpyInstance;
  text: () => string;
  unmount: () => void;
}

function mountBoundary(error: Error, opts: { session?: 'refuses' } = {}): Mounted {
  const dom = new JSDOM(
    '<!doctype html><html><head><script type="module" src="/assets/index-BiBUMqqs.js"></script></head>'
    + '<body><div id="root"></div></body></html>',
    { url: 'https://voltextech.net/futures', pretendToBeVisual: true });
  const g = global as any;
  const saved = { window: g.window, document: g.document, sessionStorage: g.sessionStorage, location: g.location };
  g.window = dom.window; g.document = dom.window.document;
  g.sessionStorage = opts.session === 'refuses'
    ? { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } }
    : dom.window.sessionStorage;
  const reloads: number[] = [];
  // jsdom's own window.location is not redefinable, and it does not need to
  // be: the recovery module reads the global `location`, so stubbing that is
  // both sufficient and closer to what it actually does at runtime.
  g.location = { pathname: '/futures', origin: 'https://voltextech.net', reload: () => reloads.push(1) };
  const ErrorBoundary = loadBoundary(dom);
  const Boom = () => { throw error; };
  const host = dom.window.document.getElementById('root')!;
  const root = createRoot(host);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  act(() => { root.render(React.createElement(ErrorBoundary, null, React.createElement(Boom))); });
  return {
    host, reloads, warn,
    text: () => host.textContent || '',
    unmount: () => {
      act(() => root.unmount());
      warn.mockRestore(); err.mockRestore();
      Object.assign(g, saved);
    },
  };
}

it('a stale chunk never puts «Что-то пошло не так» on the screen — it reloads', async () => {
  const m = mountBoundary(importError());
  await act(async () => { await flush(); });
  const lines = m.warn.mock.calls.map(c => String(c[0]));
  const text = m.text();
  const status = m.host.querySelector('[data-recovering="true"]');
  m.unmount();
  expect(m.reloads).toHaveLength(1);
  // The viewer of a successful recovery must not see a failure they did not have…
  expect(text).not.toContain('Что-то пошло не так');
  expect(text).not.toContain('Перезагрузить страницу');
  // …and must not see an EMPTY screen either: on the app's dark ground an
  // empty root is a black page for as long as the reload takes.
  expect(status).not.toBeNull();
  expect(text).toContain('Обновляем страницу');
  // Classifiable for QA, with no token, account or URL query in the line.
  expect(lines.some(l => l.startsWith('voltex.bootstrap.chunk_recovery.reloading'))).toBe(true);
  expect(lines.join(' ')).not.toMatch(/token|exchange_token|Bearer|@/i);
});

it('a reload that never arrives ends on the readable card, not a status that waits forever', () => {
  jest.useFakeTimers();
  try {
    const m = mountBoundary(importError());
    expect(m.text()).toContain('Обновляем страницу');
    // The reload was asked for and did not take the page away (blocked,
    // offline, a webview that ignores it).
    const { RECOVERY_STALL_MS } = loadBoundaryModule();
    act(() => { jest.advanceTimersByTime(RECOVERY_STALL_MS); });
    const text = m.text();
    m.unmount();
    expect(text).toContain('Что-то пошло не так');
    expect(text).toContain('Перезагрузить страницу');
  } finally {
    jest.useRealTimers();
  }
});

it('storage that cannot hold a guard shows the card at once — never an empty recovering screen', async () => {
  const m = mountBoundary(importError(), { session: 'refuses' });
  await act(async () => { await flush(); });
  const text = m.text();
  const status = m.host.querySelector('[data-recovering="true"]');
  m.unmount();
  expect(m.reloads).toHaveLength(0);
  expect(status).toBeNull();
  expect(text).toContain('Что-то пошло не так');
});

it('an ordinary crash still shows the boundary, and reloads nothing', async () => {
  const m = mountBoundary(new TypeError("Cannot read properties of undefined (reading 'price')"));
  await act(async () => { await flush(); });
  const text = m.text();
  m.unmount();
  expect(m.reloads).toHaveLength(0);
  expect(text).toContain('Что-то пошло не так');
  expect(text).toContain('Перезагрузить страницу');   // the MANUAL one
});

it('the card\'s manual reload is a healing reload too', async () => {
  const m = mountBoundary(new TypeError("Cannot read properties of undefined (reading 'price')"));
  const button = m.host.querySelector('button')!;
  await act(async () => { button.click(); await flush(); });
  m.unmount();
  expect(m.reloads).toHaveLength(1);
});

// ── healing the cache before the reload ─────────────────────────────────────

it('names the failed module wherever the engine does', () => {
  expect(failedModuleUrl(importError())).toBe('https://voltextech.net/assets/FuturesPage-Bjwiy2MF.js');
  expect(failedModuleUrl(new TypeError(
    'error loading dynamically imported module: https://voltextech.net/assets/WalletPage-x1.js'))).toBe(
    'https://voltextech.net/assets/WalletPage-x1.js');
  // Safari says nothing about which module; the boot guard then looks at
  // what the page actually loaded.
  expect(failedModuleUrl(new TypeError('Importing a module script failed.'))).toBeNull();
  expect(failedModuleUrl(null)).toBeNull();
});

it('replaces the poisoned copy of the failed chunk BEFORE reloading', async () => {
  // A missing /assets file on Pages is an immutable copy of index.html; a
  // plain reload would read that copy from the HTTP cache again.
  const order: string[] = [];
  const env = {
    session: memorySession(), doc: shellDoc('index-BiBUMqqs.js'), path: '/futures',
    heal: async (urls: string[]) => { order.push(`heal ${urls.join(',')}`); },
    reload: () => order.push('reload'),
  };
  expect(attemptChunkRecovery(importError(), env)).toBe(true);
  await flush();
  expect(order).toEqual(['heal https://voltextech.net/assets/FuturesPage-Bjwiy2MF.js', 'reload']);
});

it('reloads anyway when the heal fails or never finishes', async () => {
  const reloads: string[] = [];
  healThenReload(['x'], { heal: () => Promise.reject(new Error('offline')), reload: () => reloads.push('rejected') });
  await flush();
  expect(reloads).toEqual(['rejected']);

  jest.useFakeTimers();
  try {
    healThenReload(['x'], { heal: () => new Promise(() => {}), reload: () => reloads.push('hung') });
    jest.advanceTimersByTime(HEAL_TIMEOUT_MS - 1);
    expect(reloads).toEqual(['rejected']);
    jest.advanceTimersByTime(1);
    expect(reloads).toEqual(['rejected', 'hung']);
  } finally {
    jest.useRealTimers();
  }
});

// ── the boot guard in index.html (runs before, and without, the app) ────────

function bootGuardSource(): string {
  const html = readFileSync(resolve(frontend, 'index.html'), 'utf8');
  const match = html.match(/<script>\s*([\s\S]*?voltex\.boot-heal[\s\S]*?)<\/script>/);
  if (!match) throw new Error('boot guard not found in index.html');
  return match[1];
}

interface BootHarness {
  dom: any;
  reloads: () => number;
  fetches: { url: string; cache?: string }[];
  screen: () => { kind: string | null; text: string; button: boolean };
  entry: () => HTMLScriptElement;
}

function bootGuard(options: { cached?: Record<string, string>; started?: boolean; storage?: 'refuses' } = {}): BootHarness {
  const { VirtualConsole } = req('jsdom');
  const virtualConsole = new VirtualConsole();
  let navigations = 0;
  virtualConsole.on('jsdomError', (e: Error) => { if (/navigation/i.test(e.message)) navigations++; });
  const dom = new JSDOM(
    '<!doctype html><html><head><script type="module" src="/assets/index-CgiZAc1a.js"></script></head>'
    + '<body><div id="root"></div></body></html>',
    { url: 'https://voltextech.net/futures', runScripts: 'outside-only', virtualConsole });
  const w = dom.window;
  const fetches: { url: string; cache?: string }[] = [];
  w.fetch = (url: string, init: { cache?: string } = {}) => {
    fetches.push({ url, cache: init.cache });
    if (init.cache === 'only-if-cached') {
      const type = options.cached?.[url];
      if (!type) return Promise.reject(new TypeError('not cached'));
      return Promise.resolve({ ok: true, headers: { get: () => type } });
    }
    return Promise.resolve({ ok: true, headers: { get: () => 'text/javascript' } });
  };
  if (options.storage === 'refuses') {
    Object.defineProperty(w, 'sessionStorage', { value: { getItem: () => null, setItem: () => { throw new Error('denied'); } } });
  }
  w.console.warn = () => {};
  if (options.started) w.document.documentElement.setAttribute('data-app-started', '');
  w.eval(bootGuardSource());
  return {
    dom, fetches,
    reloads: () => navigations,
    entry: () => w.document.querySelector('script[type="module"]'),
    screen: () => {
      const el = w.document.getElementById('boot-recovery');
      return { kind: el?.getAttribute('data-kind') ?? null, text: el?.textContent ?? '', button: !!el?.querySelector('button') };
    },
  };
}

const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

it('boot guard: a poisoned ENTRY chunk is re-fetched past the cache and reloaded once — never a black page', async () => {
  const g = bootGuard();
  g.entry().dispatchEvent(new g.dom.window.Event('error'));
  await settle(550);
  // Busy screen, not an empty one, while the heal runs.
  expect(g.screen().kind).toBe('busy');
  expect(g.fetches).toContainEqual({ url: 'https://voltextech.net/assets/index-CgiZAc1a.js', cache: 'reload' });
  expect(g.reloads()).toBe(1);
  expect(g.dom.window.sessionStorage.getItem('voltex.boot-heal.index-CgiZAc1a.js')).toBe('1');
  g.dom.window.close();
});

it('boot guard: the same shell failing again gets a readable screen with a button, not a second reload', async () => {
  const g = bootGuard();
  g.dom.window.sessionStorage.setItem('voltex.boot-heal.index-CgiZAc1a.js', '1');
  g.entry().dispatchEvent(new g.dom.window.Event('error'));
  await settle(550);
  expect(g.reloads()).toBe(0);
  expect(g.screen()).toEqual({ kind: 'failed', text: expect.stringContaining('Не удалось загрузить страницу'), button: true });
  g.dom.window.close();
});

it('boot guard: without storage for a guard it never reloads on its own', async () => {
  const g = bootGuard({ storage: 'refuses' });
  g.entry().dispatchEvent(new g.dom.window.Event('error'));
  await settle(550);
  expect(g.reloads()).toBe(0);
  expect(g.screen().kind).toBe('failed');
  g.dom.window.close();
});

it('boot guard: only poisoned cached copies are re-fetched, healthy ones are left alone', async () => {
  const g = bootGuard({ cached: {
    'https://voltextech.net/assets/index-CgiZAc1a.js': 'text/html; charset=utf-8',
    'https://voltextech.net/assets/index-T1OFY5Ol.css': 'text/css',
  } });
  const w = g.dom.window;
  // A healthy stylesheet the page also loaded.
  const css = w.document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/assets/index-T1OFY5Ol.css';
  w.document.head.appendChild(css);
  const boot = (w as any).__voltexBoot;
  await boot.heal([]);
  const reloadFetches = g.fetches.filter(f => f.cache === 'reload').map(f => f.url);
  expect(reloadFetches).toContain('https://voltextech.net/assets/index-CgiZAc1a.js');
  expect(reloadFetches).not.toContain('https://voltextech.net/assets/index-T1OFY5Ol.css');
  w.close();
});

it('boot guard: once the app has started it never reloads — a lazy failure is the boundary\'s', async () => {
  const g = bootGuard({ started: true });
  g.entry().dispatchEvent(new g.dom.window.Event('error'));
  await settle(550);
  expect(g.reloads()).toBe(0);
  expect(g.screen().kind).toBeNull();
  g.dom.window.close();
});

it('boot guard: ignores failures of anything that is not a hashed app asset', async () => {
  const g = bootGuard();
  const w = g.dom.window;
  const img = w.document.createElement('img');
  img.src = 'https://fonts.gstatic.com/x.png';
  w.document.body.appendChild(img);
  img.dispatchEvent(new w.Event('error'));
  await settle(550);
  expect(g.reloads()).toBe(0);
  expect(g.fetches).toHaveLength(0);
  w.close();
});

it('boot guard sits before the entry chunk, and the app tells it when React owns #root', () => {
  const html = readFileSync(resolve(frontend, 'index.html'), 'utf8');
  expect(html.indexOf('voltex.boot-heal')).toBeGreaterThan(-1);
  expect(html.indexOf('voltex.boot-heal')).toBeLessThan(html.indexOf('<script type="module"'));
  const main = readFileSync(resolve(frontend, 'src/main.tsx'), 'utf8');
  expect(main).toMatch(/setAttribute\('data-app-started'/);
});

// ── the deployment contract ──────────────────────────────────────────────────

it('the Cloudflare Pages cache contract ships, and says the right thing in the right order', () => {
  // nginx.conf is copied into an image by frontend/Dockerfile and is NOT part
  // of the build output, so the Pages project serving voltextech.net never
  // reads it. This file is the supported equivalent, and Vite copies
  // frontend/public/ verbatim into the published dist/.
  const headers = readFileSync(resolve(frontend, 'public/_headers'), 'utf8');
  const rules = headers.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

  const star = rules.findIndex(l => l.trim() === '/*');
  const assets = rules.findIndex(l => l.trim() === '/assets/*');
  expect(star).toBeGreaterThanOrEqual(0);
  expect(assets).toBeGreaterThanOrEqual(0);
  // Pages lets a LATER rule override an earlier one, and `/*` matches the
  // hashed assets too. If the asset rule came first, everything would end up
  // no-cache — including the files whose caching makes a repeat visit fast.
  expect(assets).toBeGreaterThan(star);

  expect(rules[star + 1]).toMatch(/Cache-Control:\s*no-cache/);
  expect(rules[assets + 1]).toMatch(/Cache-Control:\s*public, max-age=31536000, immutable/);
  // The hashed assets must NEVER be no-cache: that is the opposite mistake,
  // and it would trade a rare stale shell for a slow every single load.
  expect(rules[assets + 1]).not.toMatch(/no-cache|no-store/);
});

it('route code-splitting is still in place — the fix is recovery, not a bigger bundle', () => {
  // Removing the lazy boundary would "fix" the crash by making the initial
  // download carry the whole terminal. That is not the trade being made here.
  const app = readFileSync(resolve(frontend, 'src/App.tsx'), 'utf8');
  expect(app).toMatch(/const FuturesPage = lazy\(/);
  expect(app).toMatch(/const WalletPage = lazy\(/);
  expect(app).toMatch(/const CopyTradingPage = lazy\(/);
});
