import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { readDictionaries } from '../../../test-utils/i18nSource';

/**
 * The last language the user picked is the language they get.
 *
 * Dictionaries arrive over the network, so two can be in flight at once —
 * pick EN, change your mind, pick JA — and they can finish in either order.
 * Before the guard this file exercises, whichever request finished LAST
 * won, which is not the same thing as the language chosen last: a slow EN
 * landing after a fast JA repainted the app in English while
 * `exchange_lang` still said Japanese.
 *
 * These are BEHAVIOURAL tests, not source-string assertions. The real
 * provider is compiled and run, and each locale's resolution is held open
 * until the test releases it, so the completion order is chosen rather than
 * hoped for.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const dicts = readDictionaries();

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Code = 'en' | 'zh' | 'es' | 'hi' | 'ja' | 'ko';
const EXPORT: Record<Code, string> = { en: 'EN', zh: 'ZH', es: 'ES', hi: 'HI', ja: 'JA', ko: 'KO' };

/**
 * Compiles and drives the real LanguageProvider.
 *
 * React is stubbed rather than rendered — the same approach the futures
 * header suite uses — because this repository's Jest runs on `node` with no
 * DOM. Nothing about the provider is reimplemented: its own `useState`,
 * `useEffect` and `useRef` calls run, its effects fire, and its returned
 * element is inspected.
 *
 * The compiler turns `import('./i18n/locales/en')` into
 * `Promise.resolve().then(() => require(...)).then(m => m.EN)`, and a
 * promise returned from `require` is flattened into that chain — which is
 * what lets a test decide exactly when each language finishes loading, and
 * in what order.
 */
function mount(storedLang: string | null) {
  const store = new Map<string, string>();
  if (storedLang) store.set('exchange_lang', storedLang);
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  const pending = new Map<Code, ReturnType<typeof deferred<Record<string, unknown>>>>();
  const loadCount = new Map<Code, number>();

  // ── A minimal React, faithful to the hooks the provider uses ───────
  const hooks: unknown[] = [];
  const effects: { deps: unknown[]; run: () => void }[] = [];
  let cursor = 0;
  let dirty = false;
  const react = {
    ...req('react'),
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        hooks[i],
        (value: unknown) => {
          hooks[i] = typeof value === 'function' ? (value as (v: unknown) => unknown)(hooks[i]) : value;
          dirty = true;
        },
      ];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: initial };
      return hooks[i];
    },
    useEffect(fn: () => void, deps: unknown[]) {
      const i = cursor++;
      const previous = hooks[i] as { deps: unknown[] } | undefined;
      if (!previous || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
        hooks[i] = { deps };
        effects.push({ deps, run: fn });
      }
    },
    createContext: (value: unknown) => ({ Provider: 'Provider', _default: value }),
    useContext: () => null,
  };

  const source = readFileSync(resolve(frontend, 'src/lib/i18n.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const exports: Record<string, any> = {};
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') {
      return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
    }
    const match = /i18n\/locales\/(\w+)$/.exec(name);
    if (match) {
      const codeName = match[1] as Code | 'ru';
      if (codeName === 'ru') return { RU: dicts.ru };
      loadCount.set(codeName, (loadCount.get(codeName) ?? 0) + 1);
      const d = deferred<Record<string, unknown>>();
      pending.set(codeName, d);
      return d.promise;
    }
    if (name.endsWith('/keys')) return {};
    return req(name);
  });

  let tree: any = null;
  function render() {
    do {
      dirty = false;
      cursor = 0;
      tree = exports.LanguageProvider({ children: 'CHILD' });
      const queued = effects.splice(0);
      for (const effect of queued) effect.run();
    } while (dirty);
    return tree;
  }
  render();

  /** The live context value, or null while the shell is held. */
  const context = () => (tree?.props && 'value' in tree.props ? tree.props.value : null);

  async function settle() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    render();
  }

  return {
    get lang() {
      return context()?.lang ?? null;
    },
    /** What is actually returned for rendering: the children, or the shell. */
    get rendered() {
      const value = context();
      return value ? 'CHILD' : 'SHELL';
    },
    /** A real translated string, so a stale dictionary cannot pass unseen. */
    get sample() {
      const value = context();
      return value ? value.t('nav.deposit') : null;
    },
    get stored() {
      return store.get('exchange_lang') ?? null;
    },
    loadsFor: (c: Code) => loadCount.get(c) ?? 0,
    select: (c: string) => {
      context()!.setLang(c);
      render();
    },
    finish: async (c: Code) => {
      // The compiled `import()` calls require on a microtask, so let every
      // in-flight request register before choosing which one to release.
      await Promise.resolve();
      await Promise.resolve();
      const d = pending.get(c);
      if (!d) throw new Error(`no in-flight load for ${c}`);
      d.resolve({ [EXPORT[c]]: dicts[c] });
      await settle();
    },
    fail: async (c: Code) => {
      await Promise.resolve();
      await Promise.resolve();
      const d = pending.get(c);
      if (!d) throw new Error(`no in-flight load for ${c}`);
      d.reject(new Error('chunk load failed'));
      await settle();
    },
    cleanup: () => {},
  };
}

describe('last user choice wins', () => {
  it('CASE A — JA resolves first, EN later: JA stays active', async () => {
    const app = mount(null);
    expect(app.lang).toBe('ru');

    app.select('en');
    app.select('ja');

    await app.finish('ja');
    expect(app.lang).toBe('ja');

    // The superseded EN request now lands. It must not repaint the app.
    await app.finish('en');
    expect(app.lang).toBe('ja');
    expect(app.sample).toBe(dicts.ja['nav.deposit']);
    expect(app.stored).toBe('ja');
    app.cleanup();
  });

  it('CASE B — EN resolves first, JA later: JA still wins', async () => {
    const app = mount(null);
    app.select('en');
    app.select('ja');

    // The abandoned language finishes first; it must be ignored outright,
    // not shown and then replaced.
    await app.finish('en');
    expect(app.lang).toBe('ru');
    expect(app.sample).toBe(dicts.ru['nav.deposit']);

    await app.finish('ja');
    expect(app.lang).toBe('ja');
    expect(app.stored).toBe('ja');
    app.cleanup();
  });

  it('CASE C — an older request FAILS after a newer one succeeded', async () => {
    const app = mount(null);
    app.select('en');
    app.select('ja');

    await app.finish('ja');
    expect(app.lang).toBe('ja');

    await app.fail('en');
    // A stale failure must not disturb the language the user is reading.
    expect(app.lang).toBe('ja');
    expect(app.sample).toBe(dicts.ja['nav.deposit']);
    app.cleanup();
  });

  it('CASE D — a stale success still populates the cache', async () => {
    const app = mount(null);
    app.select('en');
    app.select('ja');

    await app.finish('ja');
    await app.finish('en'); // superseded, but cached
    expect(app.lang).toBe('ja');
    expect(app.loadsFor('en')).toBe(1);

    // Choosing it now must be instant and must not fetch again.
    app.select('en');
    expect(app.lang).toBe('en');
    expect(app.sample).toBe(dicts.en['nav.deposit']);
    expect(app.loadsFor('en')).toBe(1);
    app.cleanup();
  });

  it('CASE E — an in-flight load must not beat a later CACHED selection', async () => {
    const app = mount(null);
    expect(app.lang).toBe('ru'); // Russian is static, so already cached

    app.select('en');
    app.select('ru'); // commits synchronously from cache
    expect(app.lang).toBe('ru');

    await app.finish('en');
    // The older EN request lands last in wall-clock time and must lose.
    expect(app.lang).toBe('ru');
    expect(app.sample).toBe(dicts.ru['nav.deposit']);
    expect(app.stored).toBe('ru');
    app.cleanup();
  });
});

describe('the guard does not break normal behaviour', () => {
  it('a plain uncached switch still works, and fetches once', async () => {
    const app = mount(null);
    app.select('en');
    expect(app.lang).toBe('ru'); // nothing shown until the dictionary is ready
    await app.finish('en');
    expect(app.lang).toBe('en');
    expect(app.sample).toBe(dicts.en['nav.deposit']);
    expect(app.loadsFor('en')).toBe(1);
    app.cleanup();
  });

  it('a persisted non-Russian language paints only once it is ready', async () => {
    const app = mount('ja');
    // No wrong-language flash: nothing is rendered rather than Russian.
    expect(app.rendered).toBe('SHELL');
    await app.finish('ja');
    expect(app.lang).toBe('ja');
    expect(app.sample).toBe(dicts.ja['nav.deposit']);
    app.cleanup();
  });

  it('a persisted language that fails to load falls back to Russian honestly', async () => {
    const app = mount('zh');
    await app.fail('zh');
    expect(app.lang).toBe('ru');
    expect(app.sample).toBe(dicts.ru['nav.deposit']);
    // The stored preference is kept, so a later reload retries their choice.
    expect(app.stored).toBe('zh');
    app.cleanup();
  });

  it('a mid-session switch that fails leaves the last valid language visible', async () => {
    const app = mount(null);
    app.select('en');
    await app.finish('en');
    expect(app.lang).toBe('en');

    app.select('ko');
    await app.fail('ko');
    expect(app.lang).toBe('en');
    expect(app.sample).toBe(dicts.en['nav.deposit']);
    app.cleanup();
  });

  it('switching back and forth between cached languages costs no new load', async () => {
    const app = mount(null);
    app.select('en');
    await app.finish('en');
    app.select('ru');
    app.select('en');
    app.select('ru');
    app.select('en');
    expect(app.lang).toBe('en');
    expect(app.loadsFor('en')).toBe(1);
    app.cleanup();
  });
});
