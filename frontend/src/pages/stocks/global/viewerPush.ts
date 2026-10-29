import type { Quote } from './types';

// #613 viewer push. A viewer whose state answer offers the stream (`viewerStream: 'v1'`, only in the isolated push
// profile; the release gateway never offers it) receives the selected instrument's public quote as server-sent events
// read with fetch: the bearer travels in the Authorization header, never in the URL. While the stream delivers, the
// terminal does not poll the state. When it is not offered, refused, ended, silent or told to wait, the terminal's
// ordinary visible 3 s read takes over until the stream is opened again (backoff with jitter, never before Retry-After).
// The stream carries the public quote only; it never feeds the chart (candles keep their own admitted history path).
export type ViewerPushEvent =
  | { kind: 'quote'; instrumentId: string; seq: number; serverTime: number; quote: Quote }
  | { kind: 'unavailable'; instrumentId: string; seq: number; error: string }
  | { kind: 'wait'; seq: number; retryAfterMs: number }
  | { kind: 'revoked' };

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// One event block of the stream ("event: …\ndata: {…}"); null for comments and anything malformed or unknown.
export function parseViewerEvent(block: string): ViewerPushEvent | null {
  let name = '', data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice(7);
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (!name) return null;
  let body: unknown;
  try { body = JSON.parse(data || '{}'); } catch { return null; }
  if (!object(body)) return null;
  if (name === 'revoked') return { kind: 'revoked' };
  const seq = body.seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return null;
  if (name === 'wait') {
    const retryAfterMs = body.retryAfterMs;
    return Number.isSafeInteger(retryAfterMs) && (retryAfterMs as number) >= 0 ? { kind: 'wait', seq: seq as number, retryAfterMs: Math.min(60000, retryAfterMs as number) } : null;
  }
  if (typeof body.instrumentId !== 'string' || !body.instrumentId) return null;
  if (name === 'unavailable') return typeof body.error === 'string' && CODE.test(body.error) ? { kind: 'unavailable', instrumentId: body.instrumentId, seq: seq as number, error: body.error } : null;
  if (name !== 'quote') return null;
  const quote = body.quote;
  if (!object(quote) || quote.instrumentId !== body.instrumentId || !finite(quote.timestamp) || !finite(quote.receivedAt) || !finite(body.serverTime)
    || !object(quote.prices) || !object(quote.status) || (quote.fx !== undefined && !object(quote.fx))) return null;
  // Native candles never ride a push event: the chart's own-source admission stays the only way to candles.
  const { nativeCandles: _ignored, ...publicQuote } = quote;
  return { kind: 'quote', instrumentId: body.instrumentId, seq: seq as number, serverTime: body.serverTime, quote: { fx: {}, ...publicQuote } as unknown as Quote };
}

export type ViewerPushCapture = { headers: Record<string, string>; current: () => boolean };
export type ViewerPushHandlers = {
  quote(instrumentId: string, quote: Quote): void;
  unavailable(instrumentId: string, code: string): void;
  // The stream ended for the session (signed out, revoked, another account, 401): the terminal reads its state again.
  recheck(instrumentId: string): void;
  // The stream is not delivering: the terminal's ordinary reads take over until it is reopened.
  down(instrumentId: string): void;
};
type Timers = { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (timer: unknown) => void };
export type ViewerPushOptions = {
  fetch?: typeof fetch; now?: () => number; random?: () => number; timers?: Timers;
  stallMs?: number; maxBufferBytes?: number; unsupportedRetryMs?: number;
};

export class ViewerPush {
  private generation = 0;
  private controller: AbortController | null = null;
  private retryTimer: unknown = null;
  private stallTimer: unknown = null;
  private wanted: { id: string; capture: () => ViewerPushCapture } | null = null;
  private liveId: string | null = null;
  private shownTimestamp = -Infinity;
  private retryAt = 0;
  private failures = 0;
  readonly metrics = { opened: 0, quotes: 0, discarded: 0, reconnects: 0, refused: 0, revoked: 0 };
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timers: Timers;
  private readonly stallMs: number;
  private readonly maxBufferBytes: number;
  private readonly unsupportedRetryMs: number;

  constructor(private readonly url: (instrumentId: string) => string, private readonly handlers: ViewerPushHandlers, options: ViewerPushOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.timers = options.timers ?? { setTimeout: (run, ms) => globalThis.setTimeout(run, ms), clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>) };
    this.stallMs = options.stallMs ?? 5000;
    this.maxBufferBytes = options.maxBufferBytes ?? 256 * 1024;
    this.unsupportedRetryMs = options.unsupportedRetryMs ?? 60000;
  }

  // The terminal skips its state read while this is true.
  live(instrumentId: string) { return this.liveId === instrumentId; }

  // A state answer offered the stream for this instrument: open it unless it is already open or waiting to reopen.
  want(instrumentId: string, capture: () => ViewerPushCapture) {
    if (this.wanted?.id === instrumentId && (this.controller || this.retryTimer !== null)) return;
    if (this.wanted?.id !== instrumentId) { this.stop(); this.shownTimestamp = -Infinity; this.failures = 0; this.retryAt = 0; }
    this.wanted = { id: instrumentId, capture };
    void this.open();
  }

  // Hidden tab: closed at once; the next visible state read offers it again.
  pause() { this.halt(); }

  // Another instrument, sign-out, another account or unmount: closed at once and forgotten.
  stop() { this.halt(); this.wanted = null; }

  private halt() {
    this.generation++;
    this.controller?.abort(); this.controller = null;
    if (this.retryTimer !== null) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.stallTimer !== null) { this.timers.clearTimeout(this.stallTimer); this.stallTimer = null; }
    this.liveId = null;
  }

  private schedule(ms: number) {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => { this.retryTimer = null; void this.open(); }, Math.max(0, ms));
  }

  // Not delivering: hand over to the ordinary reads and reopen later, never before minMs (Retry-After).
  private retry(instrumentId: string, minMs = 0) {
    this.halt();
    this.failures++; this.metrics.reconnects++;
    const backoff = Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5)), jitter = Math.floor(this.random() * 1000);
    this.retryAt = this.now() + Math.max(minMs, backoff) + jitter;
    this.schedule(this.retryAt - this.now());
    this.handlers.down(instrumentId);
  }

  private armStall(generation: number) {
    if (this.stallTimer !== null) this.timers.clearTimeout(this.stallTimer);
    this.stallTimer = this.timers.setTimeout(() => { this.stallTimer = null; if (generation === this.generation) this.controller?.abort(); }, this.stallMs);
  }

  private async open() {
    const wanted = this.wanted;
    if (!wanted || this.controller) return;
    if (this.retryAt > this.now()) { this.schedule(this.retryAt - this.now()); return; }
    const capture = wanted.capture(), id = wanted.id;
    if (!capture.current() || !capture.headers.Authorization) return;
    const generation = ++this.generation, controller = new AbortController();
    this.controller = controller;
    const current = () => generation === this.generation && capture.current();
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(id), { headers: capture.headers, credentials: 'omit', cache: 'no-store', signal: controller.signal });
    } catch {
      if (current()) this.retry(id); else if (generation === this.generation) this.stop();
      return;
    }
    if (!current()) { controller.abort(); if (generation === this.generation) this.stop(); return; }
    if (response.status === 401) { this.metrics.revoked++; this.stop(); this.handlers.recheck(id); return; }
    if (!response.ok || !response.body || !(response.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
      this.metrics.refused++;
      let retryAfterMs = Number(response.headers.get('retry-after')) * 1000;
      try { const body = await response.json(); if (Number.isSafeInteger(body?.retryAfterMs)) retryAfterMs = Math.max(retryAfterMs || 0, body.retryAfterMs); } catch { /* not JSON */ }
      if (!current()) return;
      // Busy or over quota: reopen after Retry-After; refused for any other reason: the ordinary reads for a while.
      this.retry(id, [429, 503].includes(response.status) ? Math.min(60000, retryAfterMs || 1000) : this.unsupportedRetryMs);
      return;
    }
    this.metrics.opened++;
    this.liveId = id; this.armStall(generation);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', lastSeq = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (!current()) { if (generation === this.generation) this.stop(); return; }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > this.maxBufferBytes) break;
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const event = parseViewerEvent(block);
          if (!event) continue;
          this.armStall(generation);
          if (event.kind === 'revoked') { this.metrics.revoked++; this.stop(); this.handlers.recheck(id); return; }
          // Older than an event already handled (a period cannot repeat), or for another instrument: dropped.
          if (event.seq <= lastSeq) { this.metrics.discarded++; continue; }
          lastSeq = event.seq;
          if (event.kind === 'wait') continue;
          if (event.instrumentId !== id) { this.metrics.discarded++; continue; }
          if (event.kind === 'unavailable') { this.handlers.unavailable(id, event.error); continue; }
          // A quote older than the one shown (an earlier stream, a later poll) never replaces it.
          if (event.quote.timestamp < this.shownTimestamp) { this.metrics.discarded++; continue; }
          this.shownTimestamp = event.quote.timestamp; this.failures = 0; this.metrics.quotes++;
          this.handlers.quote(id, event.quote);
        }
      }
    } catch { /* aborted (stall, stop) or the connection failed */ }
    if (current()) this.retry(id);
  }
}
