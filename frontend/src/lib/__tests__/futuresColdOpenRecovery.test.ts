import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import {
  isDynamicImportFailure, attemptChunkRecovery, recoveryAvailable, shellId,
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

it('reloads once for a stale chunk, and never twice for the same shell', () => {
  const session = memorySession();
  const doc = shellDoc('index-BiBUMqqs.js');
  const reloads: number[] = [];
  const env = { session, doc, path: '/futures', reload: () => reloads.push(1) };

  expect(attemptChunkRecovery(importError(), env)).toBe(true);
  expect(reloads).toHaveLength(1);

  // The reload returned the SAME stale shell — the HTML was still cached.
  // A second reload would fail identically, so it must not happen.
  expect(recoveryAvailable(env)).toBe(false);
  expect(attemptChunkRecovery(importError(), env)).toBe(false);
  expect(attemptChunkRecovery(importError('Nav-Spdin6iK.js'), env)).toBe(false);
  expect(reloads).toHaveLength(1);
});

it('a fresh shell after the reload starts with its own budget', () => {
  const session = memorySession();
  const reloads: string[] = [];
  const stale = { session, doc: shellDoc('index-BiBUMqqs.js'), path: '/futures', reload: () => reloads.push('A') };
  expect(attemptChunkRecovery(importError(), stale)).toBe(true);

  // The reload fetched a new index.html, so a DIFFERENT entry is running.
  // That is a new build, not a loop, and it is allowed its own attempt.
  const fresh = { session, doc: shellDoc('index-CAW2vEem.js'), path: '/futures', reload: () => reloads.push('B') };
  expect(recoveryAvailable(fresh)).toBe(true);
  expect(attemptChunkRecovery(importError(), fresh)).toBe(true);
  expect(reloads).toEqual(['A', 'B']);
});

it('the budget is per path, so one broken route cannot spend another route\'s attempt', () => {
  const session = memorySession();
  const doc = shellDoc('index-BiBUMqqs.js');
  const reloads: string[] = [];
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/futures', reload: () => reloads.push('/futures') })).toBe(true);
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/wallet', reload: () => reloads.push('/wallet') })).toBe(true);
  expect(reloads).toEqual(['/futures', '/wallet']);
  // …and neither route gets a second.
  expect(attemptChunkRecovery(importError(), { session, doc, path: '/futures', reload: () => reloads.push('x') })).toBe(false);
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
function loadBoundary(dom: any) {
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
  return module.exports.ErrorBoundary;
}

function mountThrowing(error: Error) {
  const dom = new JSDOM(
    '<!doctype html><html><head><script type="module" src="/assets/index-BiBUMqqs.js"></script></head>'
    + '<body><div id="root"></div></body></html>',
    { url: 'https://voltextech.net/futures', pretendToBeVisual: true });
  const g = global as any;
  const saved = { window: g.window, document: g.document, sessionStorage: g.sessionStorage, location: g.location };
  g.window = dom.window; g.document = dom.window.document; g.sessionStorage = dom.window.sessionStorage;
  const reloads: number[] = [];
  // jsdom's own window.location is not redefinable, and it does not need to
  // be: the recovery module reads the global `location`, so stubbing that is
  // both sufficient and closer to what it actually does at runtime.
  g.location = { pathname: '/futures', reload: () => reloads.push(1) };
  const ErrorBoundary = loadBoundary(dom);
  const Boom = () => { throw error; };
  const host = dom.window.document.getElementById('root')!;
  const root = createRoot(host);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  act(() => { root.render(React.createElement(ErrorBoundary, null, React.createElement(Boom))); });
  const text = host.textContent || '';
  const lines = warn.mock.calls.map(c => String(c[0]));
  warn.mockRestore(); err.mockRestore();
  act(() => root.unmount());
  Object.assign(g, saved);
  return { text, reloads, lines, session: dom.window.sessionStorage };
}

it('a stale chunk never puts «Что-то пошло не так» on the screen — it reloads', () => {
  const { text, reloads, lines } = mountThrowing(importError());
  expect(reloads).toHaveLength(1);
  // The viewer of a successful recovery must not see a failure they did not have.
  expect(text).not.toContain('Что-то пошло не так');
  expect(text).not.toContain('Перезагрузить страницу');
  // Classifiable for QA, with no token, account or URL query in the line.
  expect(lines.some(l => l.startsWith('voltex.bootstrap.chunk_recovery.reloading'))).toBe(true);
  expect(lines.join(' ')).not.toMatch(/token|exchange_token|Bearer|@/i);
});

it('an ordinary crash still shows the boundary, and reloads nothing', () => {
  const { text, reloads } = mountThrowing(new TypeError("Cannot read properties of undefined (reading 'price')"));
  expect(reloads).toHaveLength(0);
  expect(text).toContain('Что-то пошло не так');
  expect(text).toContain('Перезагрузить страницу');   // the MANUAL one, unchanged
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
