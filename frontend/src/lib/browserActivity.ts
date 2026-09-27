/** Per-tab lifecycle. No storage, account exemptions, heartbeat or server writes. */
export const BROWSER_IDLE_MS = 300_000;
export const BROWSER_ACTIVITY_EVENT = 'voltex:browser-activity';
export type BrowserPhase = 'active' | 'sleeping' | 'validating' | 'syncing' | 'error';
type Listener = () => void;
let phase: BrowserPhase = 'active';
let started = false;
let idle: ReturnType<typeof setTimeout> | undefined;
let lastActivity = 0;
let lastMove = 0;
let wake: Promise<void> | null = null;
let generation = 0;
let suppressClickUntil = 0;
let validate: () => Promise<void> = async () => {};
let identity: () => string | null = () => null;
const listeners = new Set<Listener>();
const reads = new Map<Promise<unknown>, number>();
let readFailed = false;
const hidden = () => typeof document !== 'undefined' && document.hidden;
export const getBrowserPhase = () => phase;
export const isBrowserInactive = () => hidden() || (started && phase !== 'active' && phase !== 'syncing');
export const onBrowserPhase = (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const activityListeners = new Map<EventListenerOrEventListenerObject, EventListener>();
/** One lifecycle notification; native visibility is a fallback for standalone consumers/tests. */
export function addBrowserActivityListener(listener: EventListenerOrEventListenerObject) {
  if (typeof document === 'undefined' || activityListeners.has(listener)) return;
  const wrapper: EventListener = event => {
    if (event?.type === 'visibilitychange' && started) return;
    if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
  };
  activityListeners.set(listener, wrapper);
  document.addEventListener(BROWSER_ACTIVITY_EVENT, wrapper);
  document.addEventListener('visibilitychange', wrapper);
}
export function removeBrowserActivityListener(listener: EventListenerOrEventListenerObject) {
  const wrapper = activityListeners.get(listener);
  if (!wrapper || typeof document === 'undefined') return;
  document.removeEventListener(BROWSER_ACTIVITY_EVENT, wrapper);
  document.removeEventListener('visibilitychange', wrapper);
  activityListeners.delete(listener);
}
function publish(activity = false) {
  for (const listener of listeners) listener();
  if (activity && typeof document !== 'undefined') document.dispatchEvent(new (document.defaultView?.Event ?? Event)(BROWSER_ACTIVITY_EVENT));
}
function arm() {
  clearTimeout(idle); idle = undefined;
  if (!started || phase !== 'active' || hidden()) return;
  idle = setTimeout(() => {
    if (Date.now() - lastActivity >= BROWSER_IDLE_MS) sleepBrowser(); else arm();
  }, Math.max(1, BROWSER_IDLE_MS - (Date.now() - lastActivity)));
}
export function sleepBrowser() {
  if (!started) return;
  generation++; clearTimeout(idle); idle = undefined;
  phase = 'sleeping'; publish(true);
}
/** Track reads only; a submitted mutation is never aborted, queued or replayed here. */
export function trackBrowserRead<T>(promise: Promise<T>): Promise<T> {
  const epoch = generation;
  reads.set(promise, epoch);
  void promise.then(() => reads.delete(promise), error => {
    reads.delete(promise);
    if (phase === 'syncing' && epoch === generation && error?.name !== 'AbortError') readFailed = true;
  });
  return promise;
}
export function resumeBrowser(): Promise<void> {
  if (!started || hidden() || phase === 'active') return Promise.resolve();
  if (wake) return wake;
  const epoch = ++generation;
  phase = 'validating'; publish();
  const current = async () => {
    try {
      await validate();
      if (epoch !== generation || hidden()) return;
      readFailed = false; phase = 'syncing'; publish(true);
      // Let mounted consumers start their existing reads. No other route is mounted.
      const deadline = Date.now() + 30_000;
      do {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (epoch !== generation || hidden()) return;
        if (Date.now() >= deadline) throw new Error('Resume timed out');
      } while ([...reads.values()].some(value => value === epoch));
      if (readFailed) throw new Error('Resume read failed');
      phase = 'active'; lastActivity = Date.now(); arm(); publish();
    } catch {
      if (epoch !== generation) return;
      phase = 'error'; publish(true);
    }
  };
  wake = current().finally(() => {
    wake = null;
    // A second hide/return can arrive while session validation is still in flight.
    if (epoch !== generation && started && !hidden() && phase === 'sleeping') void resumeBrowser();
  });
  return wake;
}
/** Pending display reads stay dormant without a retry timer. Abort on unmount/session change. */
export async function waitUntilActive(signal?: AbortSignal | null) {
  if (!isBrowserInactive()) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { off(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const off = onBrowserPhase(() => { if (!isBrowserInactive()) { cleanup(); resolve(); } });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
type SharedRead = { task: Promise<Response>; controller: AbortController; consumers: number; settled: boolean };
const wakeReads = new Map<string, SharedRead>();
let nextIntervalId = -1;
const displayIntervals = new Map<number, () => void>();
/** Display-only interval: no ticking while asleep; one refresh when its screen resumes. */
export function browserSetInterval(callback: () => unknown, milliseconds: number): number {
  const id = nextIntervalId--;
  const schedule = typeof window !== 'undefined' && window.setInterval ? window.setInterval.bind(window) : setInterval;
  const cancel = typeof window !== 'undefined' && window.clearInterval ? window.clearInterval.bind(window) : clearInterval;
  let timer: ReturnType<typeof schedule> | undefined;
  const stop = () => { cancel(timer); timer = undefined; };
  const run = () => {
    if (isBrowserInactive()) return;
    const result = callback();
    if (result && typeof (result as Promise<unknown>).then === 'function') void trackBrowserRead(Promise.resolve(result)).catch(() => {});
  };
  const start = () => { stop(); if (!isBrowserInactive()) timer = schedule(run, milliseconds); };
  const changed = () => { start(); if (!isBrowserInactive()) run(); };
  addBrowserActivityListener(changed); start();
  displayIntervals.set(id, () => { stop(); removeBrowserActivityListener(changed); });
  return id;
}
export function browserClearInterval(id: number | null | undefined) {
  if (id == null) return;
  displayIntervals.get(id)?.(); displayIntervals.delete(id);
}
/** Display transport boundary, also covers initial reads requested by late mounted consumers. */
export const browserFetch: typeof fetch = (input, init) => {
  if (!started) return globalThis.fetch(input, init);
  return fetchDisplay(input, init);
};
const fetchDisplay: typeof fetch = async (input, init) => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) return globalThis.fetch(input, init);
  const owner = identity();
  const signal = init?.signal ?? request?.signal;
  await waitUntilActive(signal);
  if (identity() !== owner) throw new DOMException('Session changed', 'AbortError');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // Share only identical reads in this wake. Each consumer owns cancellation;
  // the transport is aborted only after the last interested consumer leaves.
  const headers: [string, string][] = [];
  new Headers(init?.headers ?? request?.headers).forEach((value, name) => headers.push([name, value]));
  headers.sort();
  const epoch = generation;
  const key = JSON.stringify([epoch, method, String(request?.url ?? input), owner, headers,
    init?.credentials ?? request?.credentials, init?.cache ?? request?.cache,
    init?.mode ?? request?.mode, init?.redirect ?? request?.redirect,
    init?.integrity ?? request?.integrity, init?.referrer ?? request?.referrer]);
  let shared = phase === 'syncing' ? wakeReads.get(key) : undefined;
  if (shared?.controller.signal.aborted) shared = undefined;
  if (!shared) {
    const controller = new AbortController();
    const entry: SharedRead = {controller,consumers:0,settled:false,task:Promise.resolve(null as unknown as Response)};
    entry.task = globalThis.fetch(input, {...init,signal:controller.signal}).then(async response => {
      // Consume a clone so the resume indicator also covers the body download.
      await response.clone().arrayBuffer();
      if (identity() !== owner) throw new DOMException('Session changed', 'AbortError');
      if (phase === 'syncing' && epoch === generation && (response.status >= 500 || response.status === 401 || response.status === 403)) readFailed = true;
      return response;
    });
    shared = entry;
    trackBrowserRead(entry.task);
    void entry.task.finally(() => {
      entry.settled = true;
      if (wakeReads.get(key) === entry) wakeReads.delete(key);
    }).catch(() => {});
    if (phase === 'syncing') {
      wakeReads.set(key, entry);
    }
  }
  const entry = shared;
  return new Promise<Response>((resolve,reject) => {
    entry.consumers++;
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;signal?.removeEventListener('abort',abort);
      entry.consumers--;
      if (!entry.consumers && !entry.settled) entry.controller.abort();
      return true;
    };
    const abort = () => { if (release()) reject(new DOMException('Aborted','AbortError')); };
    signal?.addEventListener('abort',abort,{once:true});
    entry.task.then(response => { if (release()) resolve(response.clone()); },error => { if (release()) reject(error); });
    if (signal?.aborted) abort();
  });
};

export function startBrowserActivity(options: { validate: () => Promise<void>; identity: () => string | null }) {
  if (started) return () => {};
  started = true; validate = options.validate; identity = options.identity;
  lastActivity = Date.now(); phase = hidden() ? 'sleeping' : 'active'; arm();
  const input = (event: Event) => {
    if (!event.isTrusted || hidden()) return;
    const key = event as KeyboardEvent;
    // Reload is the user's explicit recovery path, including while asleep.
    if (event.type === 'keydown' && (key.key === 'F5' || ((key.ctrlKey || key.metaKey) && key.key?.toLowerCase() === 'r'))) return;
    const action = ['pointerdown','click','keydown','touchstart','submit'].includes(event.type);
    // Suppress the waking gesture's trailing click, not a new deliberate gesture
    // after synchronization has completed.
    if (phase === 'active' && ['pointerdown','keydown','touchstart'].includes(event.type)) suppressClickUntil = 0;
    if (phase !== 'active' || (event.type === 'click' && Date.now() < suppressClickUntil)) {
      if (action) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = Date.now() + 750; }
      // Errors require deliberate retry, not another mousemove loop.
      if (phase !== 'error' || action) void resumeBrowser();
      return;
    }
    if (event.type === 'pointermove' && Date.now() - lastMove < 1000) return;
    if (event.type === 'pointermove') lastMove = Date.now();
    lastActivity = Date.now(); arm();
  };
  const visible = () => { if (hidden()) sleepBrowser(); else void resumeBrowser(); };
  const focus = () => { if (!hidden() && phase === 'sleeping') void resumeBrowser(); };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted) { sleepBrowser(); void resumeBrowser(); } };
  // Scroll events can also be emitted by script/layout. Wheel, touch and keyboard
  // already capture genuine scrolling without treating an auto-scroll as activity.
  const events = ['pointerdown','click','keydown','wheel','touchstart','touchmove','pointermove','submit'];
  for (const event of events) window.addEventListener(event, input, { capture: true, passive: false });
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', focus);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('pagehide', sleepBrowser);
  return () => {
    started = false; generation++; clearTimeout(idle); idle = undefined;
    for (const event of events) window.removeEventListener(event, input, true);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('focus', focus); window.removeEventListener('pageshow', pageshow);
    window.removeEventListener('pagehide', sleepBrowser);
    phase = 'active'; publish();
  };
}
