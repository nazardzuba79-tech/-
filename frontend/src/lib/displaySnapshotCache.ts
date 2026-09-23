export const DISPLAY_REFRESH_MS = 60_000;
export const SLOW_DISPLAY_REFRESH_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = 'voltex.public-display.v1';
type Entry = { at: number; expiresAt: number; ttl: number; value: any };
type Pending = { promise: Promise<any>; controller: AbortController; users: number; done: boolean };
const cache = new Map<string, Entry>();
const pending = new Map<string, Pending>();
const cooldown = new Map<string, number>();
let hydrated = false;
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function hydrate() {
  if (hydrated) return; hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw || raw.length > 2_000_000) return;
    const items: unknown = JSON.parse(raw); if (!Array.isArray(items)) return;
    for (const item of items.slice(-20)) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [key, value] = item;
      if (typeof key !== 'string' || !key.includes('/cfd/display/') || !value || value.ttl !== SLOW_DISPLAY_REFRESH_MS ||
        !Number.isFinite(value.at) || value.at > Date.now() + 5000 || !Number.isFinite(value.expiresAt) || Date.now() >= value.expiresAt || value.expiresAt - value.at > value.ttl) continue;
      cache.set(key, value);
    }
  } catch { /* Storage is an optional presentation optimization. */ }
}
function persist() {
  try {
    const entries = [...cache].filter(([key, item]) => key.includes('/cfd/display/') && item.ttl === SLOW_DISPLAY_REFRESH_MS).slice(-20);
    let raw = JSON.stringify(entries);
    while (raw.length > 2_000_000 && entries.length) { entries.shift(); raw = JSON.stringify(entries); }
    localStorage.setItem(STORAGE_KEY, raw);
  } catch { /* Private browsing/quota must not break display. */ }
}
function abortError() { return new DOMException('Aborted', 'AbortError'); }
/** Cached GETs are limited to public display routes; never bearer tokens or account bodies.
 * Returning a stored observation never advances its acquisition time.
 */
export function readDisplayJson<T = any>(url: string, ttl: number, signal?: AbortSignal): Promise<T> {
  if (!url.includes('/market/display') && !url.includes('/cfd/display/')) return Promise.reject(new Error('Not a public display route'));
  if (![DISPLAY_REFRESH_MS, SLOW_DISPLAY_REFRESH_MS].includes(ttl)) return Promise.reject(new Error('Invalid display interval'));
  if (signal?.aborted) return Promise.reject(abortError());
  hydrate();
  const hit = cache.get(url);
  if (hit && hit.ttl === ttl && Date.now() >= hit.at && Date.now() < hit.expiresAt) return Promise.resolve(clone(hit.value));
  if (Date.now() < (cooldown.get(url) ?? 0)) return Promise.reject(new Error('Display refresh cooling down'));
  let work = pending.get(url);
  if (work?.controller.signal.aborted) { pending.delete(url); work = undefined; }
  if (!work) {
    if (pending.size >= 16) return Promise.reject(new Error('Display queue full'));
    const controller = new AbortController();
    const entry: Pending = { controller, users: 0, done: false, promise: Promise.resolve() };
    const timeout = setTimeout(() => controller.abort(), 15_000);
    entry.promise = fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(`Display HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('Display snapshot too large');
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || !value._display || value._display.mode !== 'snapshot' ||
          value._display.refreshMs !== ttl || !Number.isFinite(value._display.capturedAt)) throw new Error('Invalid display snapshot');
        // Acquire time is local; provider/capture timestamps remain untouched in value.
        const at = Date.now();
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
        const age = Number(response.headers.get('age') ?? 0);
        const remaining = maxAge ? Math.max(0, Number(maxAge[1]) - (Number.isFinite(age) ? age : 0)) * 1000 : ttl;
        cache.delete(url); cache.set(url, { at, expiresAt: at + Math.min(ttl, remaining), ttl, value });
        while (cache.size > 32) cache.delete(cache.keys().next().value!);
        cooldown.delete(url);
        if (ttl === SLOW_DISPLAY_REFRESH_MS) persist();
        return value;
      }).catch(error => {
        // An explicit consumer cancellation is not a provider failure.
        if (!controller.signal.aborted) {
          cooldown.set(url, Date.now() + DISPLAY_REFRESH_MS);
          if (cooldown.size > 64) cooldown.delete(cooldown.keys().next().value!);
        }
        throw error;
      }).finally(() => { clearTimeout(timeout); entry.done = true; if (pending.get(url) === entry) pending.delete(url); });
    pending.set(url, entry); work = entry;
  }
  const shared = work; shared.users++;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const release = () => { if (settled) return false; settled = true; signal?.removeEventListener('abort', onAbort); shared.users--; if (!shared.users && !shared.done) { if (pending.get(url) === shared) pending.delete(url); shared.controller.abort(); } return true; };
    const onAbort = () => { if (release()) reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(value => { if (release()) resolve(clone(value)); }, error => { if (release()) reject(error); });
    if (signal?.aborted) onAbort();
  });
}

/** EventSource-shaped adapter, but performs one bounded GET/minute and opens NO stream. */
export class SampledMarketSource {
  onerror: EventSource['onerror'] = null;
  private callbacks = new Map<string, Set<any>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private closed = false;
  private lastAttempt = -Infinity;
  constructor(private url: string) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility);
    void Promise.resolve().then(() => this.load());
  }
  addEventListener(type: string, listener: any): void {
    if (!this.callbacks.has(type)) this.callbacks.set(type, new Set()); this.callbacks.get(type)!.add(listener);
  }
  private visibility = () => {
    if (this.closed) return;
    if (document.hidden) { if (this.timer) clearTimeout(this.timer); this.timer = null; this.controller?.abort(); return; }
    this.schedule(Math.max(0, DISPLAY_REFRESH_MS - (Date.now() - this.lastAttempt)));
  };
  private schedule(ms: number) {
    if (this.closed || (typeof document !== 'undefined' && document.hidden)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.load(); }, ms);
  }
  private async load() {
    if (this.closed || this.controller || (typeof document !== 'undefined' && document.hidden)) return;
    const controller = new AbortController(); this.controller = controller; this.lastAttempt = Date.now();
    try {
      const body = await readDisplayJson(this.url, DISPLAY_REFRESH_MS, controller.signal);
      if (this.closed || controller.signal.aborted) return;
      const event = new MessageEvent('snapshot', { data: JSON.stringify(body) });
      for (const cb of this.callbacks.get('snapshot') ?? []) {
        if (typeof cb === 'function') cb(event); else cb?.handleEvent?.(event);
      }
    } catch {
      if (!this.closed && !controller.signal.aborted) this.onerror?.call(this as unknown as EventSource, new Event('error'));
    } finally { if (this.controller === controller) this.controller = null; this.schedule(DISPLAY_REFRESH_MS); }
  }
  close(): void {
    this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.controller?.abort(); this.controller = null; this.callbacks.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
  }
}
