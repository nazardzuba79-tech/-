/**
 * RECOVERING FROM A SHELL THAT OUTLIVED ITS OWN CHUNKS.
 *
 * Every route in this app is a lazy import, and every built asset carries a
 * content hash. That combination has one failure mode, and it is the one the
 * owner kept hitting on a cold `/futures` in a new tab:
 *
 *   1. Build A is deployed. The browser keeps its `index.html`, and — because
 *      hashed assets are served `immutable` — keeps Build A's ENTRY chunk in
 *      its own HTTP cache.
 *   2. Build B is deployed. The host serves the newest deployment, so Build
 *      A's chunks are no longer on the origin.
 *   3. A new tab opens `/futures`. The stale shell boots from cache, React
 *      mounts, the ErrorBoundary mounts — and only THEN does the router ask
 *      for `FuturesPage-<old hash>.js`, which is gone.
 *
 * The entry loading from cache is exactly what makes this an ErrorBoundary
 * and not a blank page: React is already running when the failure lands. The
 * thrown value, measured in Chromium against two real builds, is
 *
 *   TypeError: Failed to fetch dynamically imported module: …/FuturesPage-<hash>.js
 *
 * Nothing is wrong with the code. The page the viewer asked for exists and
 * works; their tab is simply holding a map to a building that has been
 * renumbered. A reload fetches a fresh map and everything resolves — which is
 * precisely why the owner's manual «Перезагрузить страницу» always worked.
 *
 * So this does that reload for them, ONCE, and only for this failure.
 */

/**
 * WHICH FAILURES ARE A STALE MAP, AND WHICH ARE A REAL BUG.
 *
 * Getting this wrong in either direction is costly: too narrow and the
 * viewer still meets «Что-то пошло не так» on a deploy, too broad and a
 * genuine render crash turns into a reload the user cannot escape. So the
 * match is on the specific wording each engine uses for a module that could
 * not be loaded, and on nothing else.
 *
 * Chromium  — "Failed to fetch dynamically imported module: <url>"
 * Firefox   — "error loading dynamically imported module: <url>"
 * Safari    — "Importing a module script failed." / "Unable to load module script"
 * Vite      — "Unable to preload CSS for <url>" from its preload helper
 * Bundlers  — a `ChunkLoadError` by name, for anything webpack-shaped
 *
 * A TypeError alone is NOT enough. `undefined is not a function` is a
 * TypeError too, and it is a bug that must reach the boundary.
 */
const IMPORT_FAILURE = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to load module script',
  'unable to preload css for',
];

export function isDynamicImportFailure(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && name === 'ChunkLoadError') return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const text = message.toLowerCase();
  return IMPORT_FAILURE.some(phrase => text.includes(phrase));
}

/**
 * THE IDENTITY OF THE SHELL THAT IS CURRENTLY RUNNING.
 *
 * The entry script's hashed filename. It is the right key for the guard
 * because it is the exact thing that has to change for a reload to help: a
 * reload that returns the SAME shell got the same stale `index.html` and
 * would fail identically, so it must not be attempted twice. A reload that
 * returns a DIFFERENT shell is a different key and starts with a fresh
 * budget, which is correct — that is a new build, not a loop.
 *
 * This is what makes the loop impossible by construction rather than by a
 * counter someone has to reason about.
 */
export function shellId(doc: Pick<Document, 'querySelector'> = document): string {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
  // Dev and test have no hashed entry; a constant is correct there, since
  // there is no deployment to be stale against.
  return src ? src.slice(src.lastIndexOf('/') + 1) : 'dev';
}

const KEY_PREFIX = 'voltex.chunk-recovery';
const key = (shell: string, path: string) => `${KEY_PREFIX}.${shell}.${path}`;

type Session = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** sessionStorage, or null where there is none. A viewer with storage
 *  disabled simply gets the old behaviour — the boundary — rather than an
 *  exception on top of the one they already have. */
export function defaultSession(): Session | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export interface RecoveryEnvironment {
  session?: Session | null;
  doc?: Pick<Document, 'querySelector'>;
  path?: string;
  reload?: () => void;
}

/**
 * Attempt the one reload this shell and path are allowed, and say whether it
 * was taken.
 *
 * The guard is written BEFORE the reload, never after. A reload that never
 * happens — storage full, navigation blocked, the tab closed mid-flight —
 * must still spend the budget, because the alternative is a tab that tries
 * forever. Spending it too eagerly costs one boundary; spending it too late
 * costs a reload loop, and only one of those is recoverable by the viewer.
 */
export function attemptChunkRecovery(error: unknown, env: RecoveryEnvironment = {}): boolean {
  if (!isDynamicImportFailure(error)) return false;
  if (!recoveryAvailable(env)) {
    report('exhausted', error);
    return false;
  }
  const session = env.session === undefined ? defaultSession() : env.session;
  const path = env.path ?? (typeof location === 'undefined' ? '/' : location.pathname);
  try {
    session?.setItem(key(shellId(env.doc ?? document), path), '1');
  } catch {
    // Storage that refuses to be written cannot hold a guard, and a reload
    // without a guard is the loop. Show the boundary instead.
    report('no_guard', error);
    return false;
  }
  report('reloading', error);
  (env.reload ?? (() => location.reload()))();
  return true;
}

/** Whether this shell and path still have their one attempt. */
export function recoveryAvailable(env: RecoveryEnvironment = {}): boolean {
  const session = env.session === undefined ? defaultSession() : env.session;
  if (!session) return false;
  const path = env.path ?? (typeof location === 'undefined' ? '/' : location.pathname);
  try {
    return session.getItem(key(shellId(env.doc ?? document), path)) === null;
  } catch {
    return false;
  }
}

/**
 * ONE STRUCTURED LINE, SO A COLD-OPEN FAILURE CAN BE TOLD APART FROM A BUG.
 *
 * The viewer never reads any of this — they get either a silent reload or
 * the ordinary boundary. It exists so that whoever is looking at a console
 * recording, or at the browser QA output, can say which of the two happened
 * without reproducing it.
 *
 * WHAT IS NOT WRITTEN: no token, no session, no account, no URL query and no
 * storage contents. Only the failing module's FILENAME, which is a build
 * artifact's public name and identifies nobody.
 */
function report(outcome: 'reloading' | 'exhausted' | 'no_guard', error: unknown) {
  const message = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message : '';
  const module = message.match(/[^/\s]+\.(?:js|mjs|css)/)?.[0] ?? 'unknown';
  console.warn(`voltex.bootstrap.chunk_recovery.${outcome} module=${module}`);
}
