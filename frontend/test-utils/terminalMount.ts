import { readFileSync } from 'fs';
import { browserReadModules } from './browserReadModules';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Mount a real terminal component without a bundler, a DOM or a network.
 *
 * The pattern is the one `futuresOrderPanel.test.ts` established: transpile
 * the component's own source, run it with a hand-written React whose hooks
 * are a flat array, and hand it stubbed modules at the require boundary. It
 * is extracted here because the Futures pro-terminal suite drives four
 * different components the same way, and a fourth copy of a 150-line
 * harness is a place for four copies to drift apart.
 *
 * What it is NOT is a rendering library. There is no reconciliation and no
 * real DOM: `render()` calls the component function, flushes the effects it
 * queued, and returns the element tree for inspection. That is enough to
 * assert what a component DOES — which callback it calls with which
 * payload, what it refuses to call — which is the only kind of claim these
 * suites make.
 */

export interface MountOptions {
  /** Stubbed `api` methods. Anything unlisted returns a never-settling promise. */
  api?: Record<string, unknown>;
  /** Replaces the shared account store's state for this component. */
  account?: unknown;
  /** Overrides on top of the REAL engine's execution object. */
  execution?: Record<string, unknown>;
  /** Extra require stubs, keyed by the exact specifier the component uses. */
  modules?: Record<string, unknown>;
  /** `window.confirm`, for components that ask one. */
  confirm?: () => boolean;
}

export interface Mounted {
  /** Stub components created for child imports, by their export name. */
  components: Record<string, any>;
  /** Every `execution.refresh` / `refreshFuturesAccount` call, in order. */
  refreshes: string[][];
  render(props?: Record<string, unknown>): any;
}

const frontend = resolve(__dirname, '..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const never = () => new Promise<never>(() => {});

/**
 * Sibling modules loaded for real rather than stubbed.
 *
 * Deliberately short. Anything under `src/lib` that transitively reaches
 * `lib/api` pulls in `import.meta.env`, which ts-node cannot compile under
 * CommonJS — so a module joins this list only when it is pure arithmetic
 * with no transport in it.
 */
const REAL_LIB = new Set(['../lib/futuresMath', '../lib/terminalPresentation', '../lib/formatNumber', '../lib/futuresPositionActions']);

/** Six microtask turns — enough for the promise chains these components use. */
export const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

export const readSource = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');

export function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}

export const byClass = (tree: any, cls: string) =>
  nodes(tree).filter((n) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(cls));

/** Elements carrying a `data-*` hook, which is how these tests find controls. */
export const byData = (tree: any, attribute: string) =>
  nodes(tree).filter((n) => n.props?.[attribute] !== undefined);

export function mountComponent(file: string, options: MountOptions = {}): Mounted {
  let index = 0;
  const hooks: any[] = [];
  let effects: (() => void)[] = [];
  const components: Record<string, any> = {};
  const refreshes: string[][] = [];
  const api = new Proxy(options.api ?? {}, { get: (target: any, key: string) => target[key] ?? never });

  let sharedConfig: any = null;
  const configFetch = (options.api ?? {}).getFuturesConfig as undefined | (() => Promise<unknown>);
  if (configFetch) void Promise.resolve(configFetch()).then((c) => { sharedConfig = c; }).catch(() => {});

  const react = {
    ...React,
    memo: (fn: any) => fn,
    useId: () => 'test-id',
    useState(initial: any) {
      const i = index++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
    },
    useRef(initial: any) { const i = index++; return hooks[i] ?? (hooks[i] = { current: initial }); },
    useMemo(fn: any) { return fn(); },
    useCallback(fn: any, deps: any[]) {
      const i = index++;
      const previous = hooks[i];
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) hooks[i] = { deps, fn };
      return hooks[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = index++;
      const previous = hooks[i];
      if (!previous || deps === undefined || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps, cleanup: undefined };
        effects.push(() => { previous?.cleanup?.(); hooks[i].cleanup = fn(); });
      }
    },
  };

  const compiled = ts.transpileModule(readSource(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const output: any = {};
  const readModules = browserReadModules(react, api);
  new Function('require', 'exports', 'window', 'document', compiled)(
    (name: string) => {
      if (options.modules && name in options.modules) return options.modules[name];
      if (name === 'react') return react;
      if (name === '../lib/api') return { api, ApiError: Error };
      if (name === '../lib/useFuturesMark') return readModules.mark;
      if (name === '../lib/visibleRead') return readModules.visible;
      if (name === '../lib/useFuturesAccount') {
        return {
          useFuturesAccount: () => options.account,
          refreshFuturesAccount: (keys?: string[]) => { refreshes.push(keys ?? ['*']); },
        };
      }
      if (name === '../lib/i18n') {
        // The key IS the text here, so an assertion about what a panel says
        // is an assertion about which string it chose — not about a
        // translation, which has its own suite.
        return { useLanguage: () => ({ t: (key: string, p?: any) => (p ? `${key}:${JSON.stringify(p)}` : key) }) };
      }
      if (name === '../lib/toast') return { useToast: () => ({ success: () => {}, error: () => {} }) };
      if (name === '../lib/futuresOrderErrors') {
        return { futuresOrderErrorMessage: (_e: unknown, _t: unknown, fallback: string) => fallback };
      }
      if (name === '../lib/futuresExecution') {
        const real = {
          engine: 'REAL', ready: true, account: null, marginType: null,
          defaultMarginType: 'ISOLATED', candle: null, contract: null,
          account_aggregate: null, activation: null, entryProtection: false,
          placeOrder: (p: any) => api.placeFuturesOrder(p),
          cancelOrder: (id: string) => api.cancelFuturesOrder(id),
          closePosition: (id: string) => api.closeFuturesPosition(id),
          setProtection: (id: string, b: any) => api.setFuturesPositionProtection(id, b),
          clearProtection: (id: string) => api.clearFuturesPositionProtection(id),
          refresh: (keys?: string[]) => { refreshes.push(keys ?? ['*']); },
        };
        const value = { ...real, ...(options.execution ?? {}) };
        return {
          REAL_FUTURES_EXECUTION: real,
          useFuturesExecution: () => value,
          FuturesExecutionProvider: ({ children }: any) => children,
        };
      }
      if (name === '../lib/futuresAccountSource') {
        return { FuturesAccountSourceContext: { Provider: ({ children }: any) => children } };
      }
      if (name === '../lib/futuresConfigStore') {
        // /futures/config comes through the one shared store. Resolved from
        // the same `getFuturesConfig` the caller stubbed, on the tick the
        // old mount effect settled on, so a component sees exactly the
        // config it would have seen.
        const module = {
          useFuturesConfig: () => ({
            config: sharedConfig,
            loading: sharedConfig === null,
            failed: false,
            loaded: sharedConfig !== null,
          }),
          futuresConfigStore: {
            getState: () => module.useFuturesConfig(),
            ensure: () => {},
            load: () => Promise.resolve(sharedConfig),
            refresh: () => Promise.resolve(sharedConfig),
            subscribe: () => () => {},
          },
        };
        return module;
      }
      if (name.endsWith('.css')) return {};
      // A short allowlist of PURE sibling modules, loaded for real: they are
      // the arithmetic under test, and a stub would leave these suites
      // asserting against a mock of the thing they check. Everything else
      // under ../lib/ is stubbed above, because the rest of that directory
      // reaches `import.meta.env` through lib/api and cannot be required
      // outside the bundler.
      if (REAL_LIB.has(name)) return req(resolve(frontend, 'src', name.replace('../', '')));
      // Child components become inert stubs, so each suite tests one unit.
      if (name.startsWith('./') || name.startsWith('../components/')) {
        const label = name.split('/').pop()!.replace(/\.tsx?$/, '');
        const component = components[label] ?? (components[label] = () => null);
        return new Proxy({}, { get: (_t, key: string) => (key === label ? component : component) });
      }
      return req(name);
    },
    output,
    {
      confirm: options.confirm ?? (() => true),
      setTimeout, clearTimeout, setInterval, clearInterval,
      addEventListener: () => {}, removeEventListener: () => {},
    },
    { addEventListener: () => {}, removeEventListener: () => {} },
  );

  const Component = output[Object.keys(output)[0]];
  return {
    components,
    refreshes,
    render(props: Record<string, unknown> = {}) {
      index = 0;
      const tree = Component(props);
      const queued = effects;
      effects = [];
      queued.forEach((fn) => fn());
      return tree;
    },
  };
}
